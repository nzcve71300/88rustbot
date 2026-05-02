import { runWebRconCommand } from "../rcon/webrcon.js";
import { quoteForRconArg } from "../rcon/quote.js";
import type { Pool } from "mysql2/promise";
import {
  type EventZoneProfile,
  type EventZoneType,
  getEventZoneConfig,
  hashZoneConfigForApply,
  markEventZoneApplied,
} from "../db/eventZones.js";

function formatParenXyz(xyz: { x: number; y: number; z: number }): string {
  return `(${Number(xyz.x).toFixed(2)},${Number(xyz.y).toFixed(2)},${Number(xyz.z).toFixed(2)})`;
}

function createZoneCmd(c: {
  zoneName: string;
  pos: { x: number; y: number; z: number };
  rotation: number;
  size: number;
  allowPvpDamage01: 0 | 1;
  allowNpcDamage01: 0 | 1;
  radiationDamage: number;
  allowBuildingDamage01: 0 | 1;
  allowBuilding01: 0 | 1;
}): string {
  const name = `"${quoteForRconArg(c.zoneName)}"`;
  const pos = formatParenXyz(c.pos);
  const rot = Number(c.rotation).toFixed(0);
  const size = Math.floor(c.size);
  const pvp = c.allowPvpDamage01;
  const npc = c.allowNpcDamage01;
  const rad = Math.floor(c.radiationDamage);
  const bdmg = c.allowBuildingDamage01;
  const bld = c.allowBuilding01;
  return `zones.createcustomzone ${name} ${pos} ${rot} Sphere ${size} ${pvp} ${npc} ${rad} ${bdmg} ${bld}`;
}

function deleteZoneCmd(zoneName: string): string {
  return `zones.deletecustomzone "${quoteForRconArg(zoneName)}"`;
}

function editZoneCmd(zoneName: string, setting: string, value: string): string {
  return `zones.editcustomzone "${quoteForRconArg(zoneName)}" "${setting}" "${quoteForRconArg(value)}"`;
}

function diffEdits(prevHash: string | null, cfgHash: string): boolean {
  return prevHash !== cfgHash;
}

export async function applyEventZoneConfigIfPresent(opts: {
  pool: Pool;
  guildRowId: number;
  rustServerId: number;
  eventType: EventZoneType;
  desired: EventZoneProfile;
  rcon: { host: string; port: number; password: string };
}): Promise<void> {
  const { pool, guildRowId, rustServerId, eventType, desired, rcon } = opts;
  const want = await getEventZoneConfig(pool, guildRowId, rustServerId, eventType, desired);
  if (!want) return;

  const other: EventZoneProfile = desired === "active" ? "inactive" : "active";
  const otherCfg = await getEventZoneConfig(pool, guildRowId, rustServerId, eventType, other);

  // Switch-over semantics required: delete the opposite zone, then spawn the desired zone.
  // IMPORTANT: if both profiles use the same zone name, do NOT delete — we should edit in place.
  const wantName = want.zoneName.trim();
  const otherName = otherCfg?.zoneName?.trim() ?? "";
  const switchingProfiles = Boolean(otherName && otherName !== wantName);
  if (switchingProfiles && otherCfg) {
    await runWebRconCommand(rustServerId, rcon.host, rcon.port, rcon.password, deleteZoneCmd(otherCfg.zoneName)).catch(() => {});
  }

  const applyHash = hashZoneConfigForApply({
    eventType: want.eventType,
    profile: want.profile,
    zoneName: want.zoneName,
    pos: want.pos,
    rotation: want.rotation,
    size: want.size,
    allowPvpDamage01: want.allowPvpDamage01,
    allowNpcDamage01: want.allowNpcDamage01,
    radiationDamage: want.radiationDamage,
    allowBuildingDamage01: want.allowBuildingDamage01,
    allowBuilding01: want.allowBuilding01,
    showChatMessage01: (want as any).showChatMessage01 ?? 1,
    showArea01: (want as any).showArea01 ?? 0,
    colorRgb: want.colorRgb,
    enterMessage: want.enterMessage,
    leaveMessage: want.leaveMessage,
  });

  const needsEdits = diffEdits(want.lastAppliedHash, applyHash);

  // If we're switching profiles (active<->inactive), we must ensure the desired zone exists right now.
  // DB "created" is best-effort and may drift if zones were manually deleted or the server restarted.
  if (!want.created || switchingProfiles) {
    const cmd = createZoneCmd(want);
    const res = await runWebRconCommand(rustServerId, rcon.host, rcon.port, rcon.password, cmd);
    if (!res.ok) {
      // If zone already exists (server restart mismatch), fall through to edits as best-effort.
      console.error(`[zones] create failed (${eventType}/${desired}) cmd=${cmd} err=${res.error}`);
    }
  }

  if (want.created && !needsEdits && !switchingProfiles) {
    // Still mark as applied so the DB tracks which profile is currently active on the server.
    await markEventZoneApplied(pool, guildRowId, rustServerId, eventType, desired, true, applyHash);
    return;
  }

  // Edit settings only when values changed.
  const edits: Array<[string, string]> = [
    ["enabled", "1"],
    ["position", formatParenXyz(want.pos)],
    ["rotation", String(Math.floor(Number(want.rotation) || 0))],
    ["size", String(Math.floor(want.size))],
    ["allowpvpdamage", String(want.allowPvpDamage01)],
    ["allownpcdamage", String(want.allowNpcDamage01)],
    ["radiationdamage", String(Math.floor(want.radiationDamage))],
    ["allowbuildingdamage", String(want.allowBuildingDamage01)],
    ["allowbuilding", String(want.allowBuilding01)],
    ["showchatmessage", String((want as any).showChatMessage01 ?? 1)],
    ["showarea", String((want as any).showArea01 ?? 0)],
  ];

  for (const [setting, value] of edits) {
    const res = await runWebRconCommand(rustServerId, rcon.host, rcon.port, rcon.password, editZoneCmd(want.zoneName, setting, value));
    if (!res.ok) console.error(`[zones] edit ${setting} failed (${eventType}/${desired}): ${res.error}`);
  }

  if (want.colorRgb) {
    const res = await runWebRconCommand(rustServerId, rcon.host, rcon.port, rcon.password, editZoneCmd(want.zoneName, "color", want.colorRgb));
    if (!res.ok) console.error(`[zones] edit color failed (${eventType}/${desired}): ${res.error}`);
  }
  if (want.enterMessage) {
    const res = await runWebRconCommand(rustServerId, rcon.host, rcon.port, rcon.password, editZoneCmd(want.zoneName, "entermessage", want.enterMessage));
    if (!res.ok) console.error(`[zones] edit entermessage failed (${eventType}/${desired}): ${res.error}`);
  }
  if (want.leaveMessage) {
    const res = await runWebRconCommand(rustServerId, rcon.host, rcon.port, rcon.password, editZoneCmd(want.zoneName, "leavemessage", want.leaveMessage));
    if (!res.ok) console.error(`[zones] edit leavemessage failed (${eventType}/${desired}): ${res.error}`);
  }

  await markEventZoneApplied(pool, guildRowId, rustServerId, eventType, desired, true, applyHash);
}

