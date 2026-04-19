import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";

export type DockedCargoAutomationPhase = "docked" | "between";

export type DockedCargoConfigRow = {
  guildId: number;
  rustServerId: number;
  coordX: number | null;
  coordY: number | null;
  coordZ: number | null;
  howOftenHours: number | null;
  inGameMessage: string | null;
  sayEnabled: boolean;
  leaveMessage: string | null;
  lockedCrates: number | null;
  timeDockedMinutes: number | null;
  announcementChannelId: string | null;
  announcementRoleId: string | null;
  automationStarted: boolean;
  /** Persisted schedule state for cron-driven automation (null = spawn on next tick or retry backoff). */
  automationPhase: DockedCargoAutomationPhase | null;
  phaseDeadlineMs: number | null;
};

function rowToConfig(r: Record<string, unknown>): DockedCargoConfigRow {
  return {
    guildId: Number(r.guild_id),
    rustServerId: Number(r.rust_server_id),
    coordX: r.coord_x != null ? Number(r.coord_x) : null,
    coordY: r.coord_y != null ? Number(r.coord_y) : null,
    coordZ: r.coord_z != null ? Number(r.coord_z) : null,
    howOftenHours: r.how_often_hours != null ? Number(r.how_often_hours) : null,
    inGameMessage: r.in_game_message != null ? String(r.in_game_message) : null,
    sayEnabled: Number(r.say_enabled) === 1,
    leaveMessage: r.leave_message != null ? String(r.leave_message) : null,
    lockedCrates: r.locked_crates != null ? Number(r.locked_crates) : null,
    timeDockedMinutes: r.time_docked_minutes != null ? Number(r.time_docked_minutes) : null,
    announcementChannelId: r.announcement_channel_id != null ? String(r.announcement_channel_id) : null,
    announcementRoleId: r.announcement_role_id != null ? String(r.announcement_role_id) : null,
    automationStarted: Number(r.automation_started) === 1,
    automationPhase:
      r.automation_phase === "docked" || r.automation_phase === "between"
        ? (r.automation_phase as DockedCargoAutomationPhase)
        : null,
    phaseDeadlineMs: r.phase_deadline_ms != null ? Number(r.phase_deadline_ms) : null,
  };
}

export async function getDockedCargoConfig(
  pool: Pool,
  guildRowId: number,
  rustServerId: number
): Promise<DockedCargoConfigRow | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT guild_id, rust_server_id, coord_x, coord_y, coord_z, how_often_hours, in_game_message,
            say_enabled, leave_message, locked_crates, time_docked_minutes, announcement_channel_id, announcement_role_id,
            automation_started, automation_phase, phase_deadline_ms
     FROM docked_cargo_configs WHERE guild_id = :gid AND rust_server_id = :sid LIMIT 1`,
    { gid: guildRowId, sid: rustServerId }
  );
  const r = rows[0];
  return r ? rowToConfig(r as Record<string, unknown>) : null;
}

export type DockedCargoPatch = Partial<{
  coordX: number | null;
  coordY: number | null;
  coordZ: number | null;
  howOftenHours: number | null;
  inGameMessage: string | null;
  sayEnabled: boolean;
  leaveMessage: string | null;
  lockedCrates: number | null;
  timeDockedMinutes: number | null;
  announcementChannelId: string | null;
  announcementRoleId: string | null;
  automationStarted: boolean;
  automationPhase: DockedCargoAutomationPhase | null;
  phaseDeadlineMs: number | null;
}>;

export async function mergeDockedCargoConfig(
  pool: Pool,
  guildRowId: number,
  rustServerId: number,
  patch: DockedCargoPatch
): Promise<DockedCargoConfigRow> {
  const cur = await getDockedCargoConfig(pool, guildRowId, rustServerId);
  const merged: DockedCargoConfigRow = {
    guildId: guildRowId,
    rustServerId,
    coordX: patch.coordX !== undefined ? patch.coordX : cur?.coordX ?? null,
    coordY: patch.coordY !== undefined ? patch.coordY : cur?.coordY ?? null,
    coordZ: patch.coordZ !== undefined ? patch.coordZ : cur?.coordZ ?? null,
    howOftenHours: patch.howOftenHours !== undefined ? patch.howOftenHours : cur?.howOftenHours ?? null,
    inGameMessage: patch.inGameMessage !== undefined ? patch.inGameMessage : cur?.inGameMessage ?? null,
    sayEnabled: patch.sayEnabled !== undefined ? patch.sayEnabled : cur?.sayEnabled ?? true,
    leaveMessage: patch.leaveMessage !== undefined ? patch.leaveMessage : cur?.leaveMessage ?? null,
    lockedCrates: patch.lockedCrates !== undefined ? patch.lockedCrates : cur?.lockedCrates ?? null,
    timeDockedMinutes: patch.timeDockedMinutes !== undefined ? patch.timeDockedMinutes : cur?.timeDockedMinutes ?? null,
    announcementChannelId:
      patch.announcementChannelId !== undefined ? patch.announcementChannelId : cur?.announcementChannelId ?? null,
    announcementRoleId:
      patch.announcementRoleId !== undefined ? patch.announcementRoleId : cur?.announcementRoleId ?? null,
    automationStarted: patch.automationStarted !== undefined ? patch.automationStarted : cur?.automationStarted ?? false,
    automationPhase: patch.automationPhase !== undefined ? patch.automationPhase : cur?.automationPhase ?? null,
    phaseDeadlineMs: patch.phaseDeadlineMs !== undefined ? patch.phaseDeadlineMs : cur?.phaseDeadlineMs ?? null,
  };

  if (!merged.automationStarted) {
    merged.automationPhase = null;
    merged.phaseDeadlineMs = null;
  }

  await pool.query<ResultSetHeader>(
    `INSERT INTO docked_cargo_configs
      (guild_id, rust_server_id, coord_x, coord_y, coord_z, how_often_hours, in_game_message, say_enabled,
       leave_message, locked_crates, time_docked_minutes, announcement_channel_id, announcement_role_id, automation_started,
       automation_phase, phase_deadline_ms)
     VALUES (:gid, :sid, :cx, :cy, :cz, :hoh, :igm, :say, :lm, :lc, :tdm, :ach, :arole, :ast, :aphase, :pdead)
     ON DUPLICATE KEY UPDATE
       coord_x = VALUES(coord_x),
       coord_y = VALUES(coord_y),
       coord_z = VALUES(coord_z),
       how_often_hours = VALUES(how_often_hours),
       in_game_message = VALUES(in_game_message),
       say_enabled = VALUES(say_enabled),
       leave_message = VALUES(leave_message),
       locked_crates = VALUES(locked_crates),
       time_docked_minutes = VALUES(time_docked_minutes),
       announcement_channel_id = VALUES(announcement_channel_id),
       announcement_role_id = VALUES(announcement_role_id),
       automation_started = VALUES(automation_started),
       automation_phase = VALUES(automation_phase),
       phase_deadline_ms = VALUES(phase_deadline_ms)`,
    {
      gid: merged.guildId,
      sid: merged.rustServerId,
      cx: merged.coordX,
      cy: merged.coordY,
      cz: merged.coordZ,
      hoh: merged.howOftenHours,
      igm: merged.inGameMessage,
      say: merged.sayEnabled ? 1 : 0,
      lm: merged.leaveMessage,
      lc: merged.lockedCrates,
      tdm: merged.timeDockedMinutes,
      ach: merged.announcementChannelId,
      arole: merged.announcementRoleId,
      ast: merged.automationStarted ? 1 : 0,
      aphase: merged.automationPhase,
      pdead: merged.phaseDeadlineMs,
    }
  );
  return merged;
}

export function isDockedCargoConfigComplete(c: DockedCargoConfigRow | null): boolean {
  if (!c) return false;
  if (c.coordX == null || c.coordY == null || c.coordZ == null) return false;
  if (c.howOftenHours == null || c.howOftenHours <= 0) return false;
  if (c.lockedCrates == null || c.lockedCrates < 1 || c.lockedCrates > 5) return false;
  if (c.timeDockedMinutes == null || c.timeDockedMinutes < 1) return false;
  if (!c.announcementChannelId) return false;
  if (!c.announcementRoleId) return false;
  if (c.sayEnabled) {
    if (!c.inGameMessage?.trim() || !c.leaveMessage?.trim()) return false;
  }
  return true;
}

export async function listDockedCargoAutomationServers(
  pool: Pool
): Promise<{ guildRowId: number; rustServerId: number }[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT guild_id AS guildRowId, rust_server_id AS rustServerId
     FROM docked_cargo_configs WHERE automation_started = 1`
  );
  return (rows as { guildRowId: number; rustServerId: number }[]).map((r) => ({
    guildRowId: Number(r.guildRowId),
    rustServerId: Number(r.rustServerId),
  }));
}

