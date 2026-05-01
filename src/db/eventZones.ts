import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import crypto from "node:crypto";

export type EventZoneType = "koth" | "maze" | "nuketown" | "onev1";
export type EventZoneProfile = "active" | "inactive";

export type EventZoneConfig = {
  eventType: EventZoneType;
  profile: EventZoneProfile;
  zoneName: string;
  pos: { x: number; y: number; z: number };
  rotation: number;
  size: number;
  allowPvpDamage01: 0 | 1;
  allowNpcDamage01: 0 | 1;
  radiationDamage: number;
  allowBuildingDamage01: 0 | 1;
  allowBuilding01: 0 | 1;
  showChatMessage01: 0 | 1;
  showArea01: 0 | 1;
  colorRgb: string | null;
  enterMessage: string | null;
  leaveMessage: string | null;
  created: boolean;
  lastAppliedHash: string | null;
  updatedAtMs: number | null;
};

export function hashZoneConfigForApply(c: Omit<EventZoneConfig, "created" | "lastAppliedHash" | "updatedAtMs">): string {
  const payload = {
    eventType: c.eventType,
    profile: c.profile,
    zoneName: c.zoneName,
    pos: c.pos,
    rotation: c.rotation,
    size: c.size,
    allowPvpDamage01: c.allowPvpDamage01,
    allowNpcDamage01: c.allowNpcDamage01,
    radiationDamage: c.radiationDamage,
    allowBuildingDamage01: c.allowBuildingDamage01,
    allowBuilding01: c.allowBuilding01,
    showChatMessage01: c.showChatMessage01,
    showArea01: c.showArea01,
    colorRgb: c.colorRgb,
    enterMessage: c.enterMessage,
    leaveMessage: c.leaveMessage,
  };
  return crypto.createHash("sha256").update(JSON.stringify(payload), "utf8").digest("hex");
}

function rowToConfig(r: any): EventZoneConfig {
  return {
    eventType: String(r.eventType) as EventZoneType,
    profile: String(r.profile) as EventZoneProfile,
    zoneName: String(r.zoneName),
    pos: { x: Number(r.posX), y: Number(r.posY), z: Number(r.posZ) },
    rotation: Number(r.rotation),
    size: Number(r.size),
    allowPvpDamage01: Number(r.allowPvpDamage01) === 1 ? 1 : 0,
    allowNpcDamage01: Number(r.allowNpcDamage01) === 1 ? 1 : 0,
    radiationDamage: Number(r.radiationDamage),
    allowBuildingDamage01: Number(r.allowBuildingDamage01) === 1 ? 1 : 0,
    allowBuilding01: Number(r.allowBuilding01) === 1 ? 1 : 0,
    showChatMessage01: Number(r.showChatMessage01) === 1 ? 1 : 0,
    showArea01: Number(r.showArea01) === 1 ? 1 : 0,
    colorRgb: r.colorRgb != null && String(r.colorRgb).trim() ? String(r.colorRgb) : null,
    enterMessage: r.enterMessage != null && String(r.enterMessage).trim() ? String(r.enterMessage) : null,
    leaveMessage: r.leaveMessage != null && String(r.leaveMessage).trim() ? String(r.leaveMessage) : null,
    created: Number(r.created) === 1,
    lastAppliedHash: r.lastAppliedHash != null && String(r.lastAppliedHash).trim() ? String(r.lastAppliedHash) : null,
    updatedAtMs: r.updatedAtMs != null ? Number(r.updatedAtMs) : null,
  };
}

export async function getEventZoneConfig(
  pool: Pool,
  guildRowId: number,
  rustServerId: number,
  eventType: EventZoneType,
  profile: EventZoneProfile
): Promise<EventZoneConfig | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT
       event_type AS eventType,
       profile,
       zone_name AS zoneName,
       pos_x AS posX,
       pos_y AS posY,
       pos_z AS posZ,
       rotation,
       size,
       allow_pvpdamage AS allowPvpDamage01,
       allow_npcdamage AS allowNpcDamage01,
       radiation_damage AS radiationDamage,
       allow_buildingdamage AS allowBuildingDamage01,
       allow_building AS allowBuilding01,
       show_chat_message AS showChatMessage01,
       show_area AS showArea01,
       color_rgb AS colorRgb,
       enter_message AS enterMessage,
       leave_message AS leaveMessage,
       created,
       last_applied_hash AS lastAppliedHash,
       UNIX_TIMESTAMP(updated_at) * 1000 AS updatedAtMs
     FROM event_zone_configs
     WHERE guild_id = :gid AND rust_server_id = :sid AND event_type = :etype AND profile = :profile
     LIMIT 1`,
    { gid: guildRowId, sid: rustServerId, etype: eventType, profile }
  );
  const r = rows[0] as any;
  return r ? rowToConfig(r) : null;
}

export async function upsertEventZoneConfig(
  pool: Pool,
  guildRowId: number,
  rustServerId: number,
  cfg: Omit<EventZoneConfig, "created" | "lastAppliedHash" | "updatedAtMs">,
  keepCreatedAndHash = true
): Promise<void> {
  const existing = keepCreatedAndHash ? await getEventZoneConfig(pool, guildRowId, rustServerId, cfg.eventType, cfg.profile) : null;
  const created = existing?.created ? 1 : 0;
  const lastAppliedHash = existing?.lastAppliedHash ?? null;
  await pool.query<ResultSetHeader>(
    `INSERT INTO event_zone_configs (
       guild_id, rust_server_id, event_type, profile,
       zone_name, pos_x, pos_y, pos_z, rotation, size,
       allow_pvpdamage, allow_npcdamage, radiation_damage, allow_buildingdamage, allow_building,
       show_chat_message, show_area,
       color_rgb, enter_message, leave_message,
       created, last_applied_hash
     )
     VALUES (
       :gid, :sid, :etype, :profile,
       :name, :x, :y, :z, :rot, :size,
       :pvp, :npc, :rad, :bdmg, :bld,
       :chat, :area,
       :color, :enter, :leave,
       :created, :hash
     )
     ON DUPLICATE KEY UPDATE
       zone_name = VALUES(zone_name),
       pos_x = VALUES(pos_x),
       pos_y = VALUES(pos_y),
       pos_z = VALUES(pos_z),
       rotation = VALUES(rotation),
       size = VALUES(size),
       allow_pvpdamage = VALUES(allow_pvpdamage),
       allow_npcdamage = VALUES(allow_npcdamage),
       radiation_damage = VALUES(radiation_damage),
       allow_buildingdamage = VALUES(allow_buildingdamage),
       allow_building = VALUES(allow_building),
       show_chat_message = VALUES(show_chat_message),
       show_area = VALUES(show_area),
       color_rgb = VALUES(color_rgb),
       enter_message = VALUES(enter_message),
       leave_message = VALUES(leave_message),
       created = :created,
       last_applied_hash = :hash`,
    {
      gid: guildRowId,
      sid: rustServerId,
      etype: cfg.eventType,
      profile: cfg.profile,
      name: cfg.zoneName,
      x: cfg.pos.x,
      y: cfg.pos.y,
      z: cfg.pos.z,
      rot: cfg.rotation,
      size: cfg.size,
      pvp: cfg.allowPvpDamage01,
      npc: cfg.allowNpcDamage01,
      rad: cfg.radiationDamage,
      bdmg: cfg.allowBuildingDamage01,
      bld: cfg.allowBuilding01,
      chat: cfg.showChatMessage01,
      area: cfg.showArea01,
      color: cfg.colorRgb,
      enter: cfg.enterMessage,
      leave: cfg.leaveMessage,
      created,
      hash: lastAppliedHash,
    }
  );
}

export async function markEventZoneApplied(
  pool: Pool,
  guildRowId: number,
  rustServerId: number,
  eventType: EventZoneType,
  profile: EventZoneProfile,
  created: boolean,
  lastAppliedHash: string
): Promise<void> {
  await pool.query<ResultSetHeader>(
    `UPDATE event_zone_configs
     SET created = :created, last_applied_hash = :hash
     WHERE guild_id = :gid AND rust_server_id = :sid AND event_type = :etype AND profile = :profile`,
    { gid: guildRowId, sid: rustServerId, etype: eventType, profile, created: created ? 1 : 0, hash: lastAppliedHash }
  );
}

