import type { Pool } from "mysql2/promise";
import { listKothParticipantsWithGatesAndClan, getGateCoord } from "../db/koth.js";
import { parseGateCoordTriple } from "./runner.js";
import { runWebRconCommand } from "../rcon/webrcon.js";
import { quoteForRconArg } from "../rcon/quote.js";

function formatParenXyz(xyz: [number, number, number]): string {
  return `(${xyz[0].toFixed(2)},${xyz[1].toFixed(2)},${xyz[2].toFixed(2)})`;
}

/** `zones.createcustomzone "Zone name" (x,y,z) 0 Box (5,5,5) 1 0 100 0 0` */
export function buildCreateKothGateZoneCommand(zoneName: string, xyz: [number, number, number]): string {
  const q = `"${quoteForRconArg(zoneName)}"`;
  return `zones.createcustomzone ${q} ${formatParenXyz(xyz)} 0 Box (5,5,5) 1 0 100 0 0`;
}

/** `zones.deletecustomzone "Zone name"` */
export function buildDeleteKothGateZoneCommand(zoneName: string): string {
  return `zones.deletecustomzone "${quoteForRconArg(zoneName)}"`;
}

/**
 * Create one zone per assigned gate (gate has a clan in this event),
 * only if that gate has a saved `/manage-positions` coord.
 *
 * Zone name is the clan name (as requested).
 */
export async function createKothGateZones(opts: {
  pool: Pool;
  guildRowId: number;
  rustServerId: number;
  eventId: number;
  host: string;
  port: number;
  password: string;
}): Promise<string[]> {
  const { pool, guildRowId, rustServerId, eventId, host, port, password } = opts;

  const participants = await listKothParticipantsWithGatesAndClan(pool, guildRowId, eventId);
  const byGate = new Map<number, { gateNumber: number; clanName: string }>();
  for (const p of participants) {
    if (!byGate.has(p.gateNumber)) {
      byGate.set(p.gateNumber, { gateNumber: p.gateNumber, clanName: p.clanName });
    }
  }

  const gates = [...byGate.values()].sort((a, b) => a.gateNumber - b.gateNumber);
  const created: string[] = [];

  for (const g of gates) {
    const coordStr = await getGateCoord(pool, guildRowId, rustServerId, g.gateNumber);
    if (!coordStr) continue;
    const xyz = parseGateCoordTriple(coordStr);
    if (!xyz) continue;

    const zoneName = g.clanName;
    const cmd = buildCreateKothGateZoneCommand(zoneName, xyz);
    const res = await runWebRconCommand(rustServerId, host, port, password, cmd);
    if (!res.ok) {
      console.error(`[koth] create zone failed (${zoneName}) gate ${g.gateNumber}: ${res.error}`);
      continue;
    }
    created.push(zoneName);
  }

  return created;
}

export async function deleteKothGateZones(opts: {
  rustServerId: number;
  host: string;
  port: number;
  password: string;
  zoneNames: string[];
}): Promise<void> {
  const { rustServerId, host, port, password, zoneNames } = opts;
  await Promise.all(
    zoneNames.map(async (zn) => {
      const res = await runWebRconCommand(rustServerId, host, port, password, buildDeleteKothGateZoneCommand(zn));
      if (!res.ok) console.error(`[koth] delete zone failed (${zn}): ${res.error}`);
    })
  );
}

