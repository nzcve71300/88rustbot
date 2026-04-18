import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";

export const MAZE_MAX_PLAYERS = 10;
export const MAZE_MAX_SPAWN_POINTS = 10;

export type MazeConfig = {
  rustServerId: number;
  announcementChannelId: string;
  announcementRoleId: string | null;
  spawnPoints: number;
  messageId: string | null;
};

export async function upsertMazeConfig(
  pool: Pool,
  guildRowId: number,
  rustServerId: number,
  announcementChannelId: string,
  announcementRoleId: string | null,
  spawnPoints: number,
  messageId: string | null
): Promise<void> {
  await pool.query<ResultSetHeader>(
    `INSERT INTO maze_configs (guild_id, rust_server_id, announcement_channel_id, announcement_role_id, spawn_points, message_id)
     VALUES (:gid, :sid, :chan, :role, :sp, :msg)
     ON DUPLICATE KEY UPDATE
       announcement_channel_id = VALUES(announcement_channel_id),
       announcement_role_id = VALUES(announcement_role_id),
       spawn_points = VALUES(spawn_points),
       message_id = VALUES(message_id)`,
    { gid: guildRowId, sid: rustServerId, chan: announcementChannelId, role: announcementRoleId, sp: spawnPoints, msg: messageId }
  );
}

export async function getMazeConfig(pool: Pool, guildRowId: number, rustServerId: number): Promise<MazeConfig | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT rust_server_id AS rustServerId,
            CAST(announcement_channel_id AS CHAR) AS announcementChannelId,
            CAST(announcement_role_id AS CHAR) AS announcementRoleId,
            spawn_points AS spawnPoints,
            CAST(message_id AS CHAR) AS messageId
     FROM maze_configs WHERE guild_id = :gid AND rust_server_id = :sid LIMIT 1`,
    { gid: guildRowId, sid: rustServerId }
  );
  const r = rows[0] as MazeConfig | undefined;
  return r
    ? {
        rustServerId: Number(r.rustServerId),
        announcementChannelId: String(r.announcementChannelId),
        announcementRoleId: r.announcementRoleId ? String(r.announcementRoleId) : null,
        spawnPoints: Number(r.spawnPoints),
        messageId: r.messageId ? String(r.messageId) : null,
      }
    : null;
}

export async function getActiveMazeEvent(
  pool: Pool,
  guildRowId: number,
  rustServerId: number
): Promise<{ id: number; status: string } | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id, status FROM maze_events
     WHERE guild_id = :gid AND rust_server_id = :sid AND status IN ('lobby','running')
     ORDER BY id DESC LIMIT 1`,
    { gid: guildRowId, sid: rustServerId }
  );
  const r = rows[0] as { id: number; status: string } | undefined;
  return r ? { id: Number(r.id), status: String(r.status) } : null;
}

export type ActiveMazeEventMeta = {
  id: number;
  status: "lobby" | "running";
  durationMinutes: number | null;
  startedAtMs: number | null;
};

export async function getActiveMazeEventMeta(
  pool: Pool,
  guildRowId: number,
  rustServerId: number
): Promise<ActiveMazeEventMeta | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id, status,
            duration_minutes AS durationMinutes,
            CASE WHEN started_at IS NULL THEN NULL ELSE UNIX_TIMESTAMP(started_at) * 1000 END AS startedAtMs
     FROM maze_events
     WHERE guild_id = :gid AND rust_server_id = :sid AND status IN ('lobby','running')
     ORDER BY id DESC LIMIT 1`,
    { gid: guildRowId, sid: rustServerId }
  );

  const r = rows[0] as
    | {
        id: number;
        status: "lobby" | "running";
        durationMinutes: number | null;
        startedAtMs: number | null;
      }
    | undefined;
  if (!r) return null;

  return {
    id: Number(r.id),
    status: r.status,
    durationMinutes: r.durationMinutes != null ? Number(r.durationMinutes) : null,
    startedAtMs: r.startedAtMs != null ? Number(r.startedAtMs) : null,
  };
}

export type LobbyMazeJoinResult =
  | { ok: true; eventId: number }
  | { ok: false; reason: "running" };

export async function ensureLobbyMazeForJoin(
  pool: Pool,
  guildRowId: number,
  rustServerId: number
): Promise<LobbyMazeJoinResult> {
  const active = await getActiveMazeEvent(pool, guildRowId, rustServerId);
  if (active?.status === "running") {
    return { ok: false, reason: "running" };
  }
  if (active?.status === "lobby") {
    return { ok: true, eventId: active.id };
  }
  const [res] = await pool.query<ResultSetHeader>(
    `INSERT INTO maze_events (guild_id, rust_server_id, status) VALUES (:gid, :sid, 'lobby')`,
    { gid: guildRowId, sid: rustServerId }
  );
  return { ok: true, eventId: Number(res.insertId) };
}

export async function countMazeEventMembers(pool: Pool, eventId: number): Promise<number> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS c FROM maze_event_members WHERE event_id = :eid`,
    { eid: eventId }
  );
  return Number((rows[0] as { c: number }).c);
}

export async function startMazeEvent(
  pool: Pool,
  eventId: number,
  durationMinutes: number,
  kitName: string,
  respawnEnabled: boolean
): Promise<boolean> {
  const [res] = await pool.query<ResultSetHeader>(
    `UPDATE maze_events SET
       status = 'running',
       duration_minutes = :dm,
       kit_name = :kit,
       respawn_enabled = :re,
       started_at = CURRENT_TIMESTAMP
     WHERE id = :eid AND status = 'lobby'`,
    { eid: eventId, dm: durationMinutes, kit: kitName, re: respawnEnabled ? 1 : 0 }
  );
  return res.affectedRows > 0;
}

export async function finishMazeEvent(pool: Pool, eventId: number): Promise<void> {
  await pool.query<ResultSetHeader>(
    `UPDATE maze_events SET status = 'finished' WHERE id = :eid`,
    { eid: eventId }
  );
}

export async function deleteMazeEventAndClearConfig(
  pool: Pool,
  guildRowId: number,
  rustServerId: number,
  eventId: number
): Promise<void> {
  await pool.query<ResultSetHeader>(
    `DELETE FROM maze_events WHERE id = :eid AND guild_id = :gid`,
    { eid: eventId, gid: guildRowId }
  );
  await pool.query<ResultSetHeader>(
    `DELETE FROM maze_configs WHERE guild_id = :gid AND rust_server_id = :sid`,
    { gid: guildRowId, sid: rustServerId }
  );
}

export async function getMazeEventRespawnEnabled(pool: Pool, eventId: number): Promise<boolean> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT respawn_enabled AS r FROM maze_events WHERE id = :eid LIMIT 1`,
    { eid: eventId }
  );
  const r = rows[0] as { r: number } | undefined;
  return r ? r.r === 1 : false;
}

async function getUsedSpawns(pool: Pool, eventId: number): Promise<Set<number>> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT spawn_number AS n FROM maze_event_members WHERE event_id = :eid`,
    { eid: eventId }
  );
  return new Set((rows as { n: number }[]).map((x) => Number(x.n)));
}

/** First free spawn slot in 1..maxSpawn inclusive, or null if full. */
export async function findFreeMazeSpawn(pool: Pool, eventId: number, maxSpawn: number): Promise<number | null> {
  const used = await getUsedSpawns(pool, eventId);
  const cap = Math.min(maxSpawn, MAZE_MAX_PLAYERS, MAZE_MAX_SPAWN_POINTS);
  for (let i = 1; i <= cap; i++) {
    if (!used.has(i)) return i;
  }
  return null;
}

export async function addMazeEventMember(
  pool: Pool,
  eventId: number,
  clanId: number,
  discordUserId: string,
  spawnNumber: number
): Promise<"added" | "already_joined"> {
  try {
    await pool.query<ResultSetHeader>(
      `INSERT INTO maze_event_members (event_id, clan_id, discord_user_id, spawn_number)
       VALUES (:eid, :cid, :uid, :sn)`,
      { eid: eventId, cid: clanId, uid: discordUserId, sn: spawnNumber }
    );
    return "added";
  } catch (e: unknown) {
    const code = typeof e === "object" && e && "code" in e ? String((e as { code: string }).code) : "";
    if (code === "ER_DUP_ENTRY") return "already_joined";
    throw e;
  }
}

export async function removeMazeEventMember(pool: Pool, eventId: number, discordUserId: string): Promise<boolean> {
  const [res] = await pool.query<ResultSetHeader>(
    `DELETE FROM maze_event_members WHERE event_id = :eid AND discord_user_id = :uid`,
    { eid: eventId, uid: discordUserId }
  );
  return res.affectedRows > 0;
}

export type MazeSpawnView = {
  spawnNumber: number;
  clanName: string;
  ingameName: string;
  discordUserId: string;
};

export async function listMazeSpawnViews(pool: Pool, guildRowId: number, eventId: number): Promise<MazeSpawnView[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT m.spawn_number AS spawnNumber, c.name AS clanName,
            l.ingame_name AS ingameName,
            CAST(m.discord_user_id AS CHAR) AS discordUserId
     FROM maze_event_members m
     JOIN clans c ON c.id = m.clan_id
     JOIN discord_links l ON l.guild_id = :gid AND l.discord_user_id = m.discord_user_id
     WHERE m.event_id = :eid
     ORDER BY m.spawn_number ASC`,
    { gid: guildRowId, eid: eventId }
  );
  return (rows as MazeSpawnView[]).map((r) => ({
    spawnNumber: Number(r.spawnNumber),
    clanName: String(r.clanName),
    ingameName: String(r.ingameName),
    discordUserId: String(r.discordUserId),
  }));
}

export type MazeParticipantTeleport = {
  ingameName: string;
  spawnNumber: number;
};

export async function listMazeParticipantsForTeleport(
  pool: Pool,
  guildRowId: number,
  eventId: number
): Promise<MazeParticipantTeleport[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT l.ingame_name AS ingameName, m.spawn_number AS spawnNumber
     FROM maze_event_members m
     JOIN discord_links l ON l.guild_id = :gid AND l.discord_user_id = m.discord_user_id
     WHERE m.event_id = :eid
     ORDER BY m.spawn_number ASC`,
    { gid: guildRowId, eid: eventId }
  );
  return (rows as MazeParticipantTeleport[]).map((r) => ({
    ingameName: String(r.ingameName),
    spawnNumber: Number(r.spawnNumber),
  }));
}

export type MazeRosterKillRow = {
  discordUserId: string;
  clanId: number;
  ingameName: string;
};

export async function listMazeEventRosterForKills(
  pool: Pool,
  guildRowId: number,
  eventId: number
): Promise<MazeRosterKillRow[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT CAST(m.discord_user_id AS CHAR) AS discordUserId,
            m.clan_id AS clanId,
            l.ingame_name AS ingameName
     FROM maze_event_members m
     INNER JOIN discord_links l ON l.guild_id = :gid AND l.discord_user_id = m.discord_user_id
     WHERE m.event_id = :eid`,
    { gid: guildRowId, eid: eventId }
  );
  return (rows as MazeRosterKillRow[]).map((r) => ({
    discordUserId: String(r.discordUserId),
    clanId: Number(r.clanId),
    ingameName: String(r.ingameName),
  }));
}

export async function getMazeSpawnCoord(
  pool: Pool,
  guildRowId: number,
  rustServerId: number,
  spawnNumber: number
): Promise<string | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT coord FROM maze_spawn_coords WHERE guild_id = :gid AND rust_server_id = :sid AND spawn_number = :sn LIMIT 1`,
    { gid: guildRowId, sid: rustServerId, sn: spawnNumber }
  );
  const r = rows[0] as { coord: string } | undefined;
  return r?.coord ? String(r.coord) : null;
}

export async function upsertMazeSpawnCoord(
  pool: Pool,
  guildRowId: number,
  rustServerId: number,
  spawnNumber: number,
  coord: string
): Promise<void> {
  await pool.query<ResultSetHeader>(
    `INSERT INTO maze_spawn_coords (guild_id, rust_server_id, spawn_number, coord)
     VALUES (:gid, :sid, :sn, :coord)
     ON DUPLICATE KEY UPDATE coord = VALUES(coord)`,
    { gid: guildRowId, sid: rustServerId, sn: spawnNumber, coord }
  );
}

/** Spawn slots `1..spawnPointsInclusive` with no saved coord (for `/maze-start` gate). */
export async function listMissingMazeSpawnCoords(
  pool: Pool,
  guildRowId: number,
  rustServerId: number,
  spawnPointsInclusive: number
): Promise<number[]> {
  const missing: number[] = [];
  const cap = Math.min(Math.max(1, spawnPointsInclusive), MAZE_MAX_SPAWN_POINTS);
  for (let i = 1; i <= cap; i++) {
    const c = await getMazeSpawnCoord(pool, guildRowId, rustServerId, i);
    if (!c || !String(c).trim()) missing.push(i);
  }
  return missing;
}

export async function incrementMazeKill(
  pool: Pool,
  eventId: number,
  clanId: number,
  discordUserId: string
): Promise<void> {
  await pool.query<ResultSetHeader>(
    `INSERT INTO maze_kills (event_id, clan_id, discord_user_id, kills)
     VALUES (:eid, :cid, :uid, 1)
     ON DUPLICATE KEY UPDATE kills = kills + 1`,
    { eid: eventId, cid: clanId, uid: discordUserId }
  );
}

export type MazeKillLogRow = {
  killerDiscordUserId: string;
  victimDiscordUserId: string | null;
  killerLabel: string;
  victimLabel: string;
};

export async function insertMazeKillLog(
  pool: Pool,
  guildRowId: number,
  eventId: number,
  killerDiscordUserId: string,
  victimDiscordUserId: string | null,
  killerLabel: string,
  victimLabel: string
): Promise<void> {
  await pool.query<ResultSetHeader>(
    `INSERT INTO maze_kill_log (guild_id, event_id, killer_discord_user_id, victim_discord_user_id, killer_label, victim_label)
     VALUES (:gid, :eid, :kid, :vid, :kl, :vl)`,
    {
      gid: guildRowId,
      eid: eventId,
      kid: killerDiscordUserId,
      vid: victimDiscordUserId,
      kl: killerLabel.slice(0, 128),
      vl: victimLabel.slice(0, 128),
    }
  );
}

export async function listMazeKillLogForEvent(
  pool: Pool,
  guildRowId: number,
  eventId: number
): Promise<MazeKillLogRow[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT CAST(killer_discord_user_id AS CHAR) AS killerDiscordUserId,
            CAST(victim_discord_user_id AS CHAR) AS victimDiscordUserId,
            killer_label AS killerLabel,
            victim_label AS victimLabel
     FROM maze_kill_log
     WHERE guild_id = :gid AND event_id = :eid
     ORDER BY id ASC`,
    { gid: guildRowId, eid: eventId }
  );
  return (rows as MazeKillLogRow[]).map((r) => ({
    killerDiscordUserId: String(r.killerDiscordUserId),
    victimDiscordUserId:
      r.victimDiscordUserId != null && String(r.victimDiscordUserId).length > 0
        ? String(r.victimDiscordUserId)
        : null,
    killerLabel: String(r.killerLabel),
    victimLabel: String(r.victimLabel),
  }));
}

export type MazeKillPlayerRow = {
  discordUserId: string;
  kills: number;
  clanName: string;
};

export async function listMazeKillsDetailedForEvent(pool: Pool, eventId: number): Promise<MazeKillPlayerRow[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT CAST(k.discord_user_id AS CHAR) AS discordUserId,
            k.kills AS kills,
            COALESCE(c.name, CONCAT('Clan ', k.clan_id)) AS clanName
     FROM maze_kills k
     LEFT JOIN clans c ON c.id = k.clan_id
     WHERE k.event_id = :eid
     ORDER BY k.kills DESC, clanName ASC`,
    { eid: eventId }
  );
  return (rows as MazeKillPlayerRow[]).map((r) => ({
    discordUserId: String(r.discordUserId),
    kills: Number(r.kills),
    clanName: String(r.clanName),
  }));
}

export type MazeTopKillerRow = { clanName: string; ingameName: string };

/** Highest kill count for the maze event; linked in-game name + clan. Null if no kills recorded. */
export async function getMazeEventTopKillerWithLink(
  pool: Pool,
  guildRowId: number,
  eventId: number
): Promise<MazeTopKillerRow | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT COALESCE(c.name, CONCAT('Clan ', k.clan_id)) AS clanName,
            l.ingame_name AS ingameName,
            k.kills AS kills
     FROM maze_kills k
     LEFT JOIN clans c ON c.id = k.clan_id
     INNER JOIN discord_links l ON l.guild_id = :gid AND l.discord_user_id = k.discord_user_id
     WHERE k.event_id = :eid
     ORDER BY k.kills DESC, clanName ASC, l.ingame_name ASC
     LIMIT 1`,
    { gid: guildRowId, eid: eventId }
  );
  const r = rows[0] as { clanName: string; ingameName: string; kills: number } | undefined;
  if (!r || Number(r.kills) < 1) return null;
  return { clanName: String(r.clanName), ingameName: String(r.ingameName) };
}

export async function sumMazeTotalKillsForEvent(pool: Pool, eventId: number): Promise<number> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT COALESCE(SUM(kills), 0) AS t FROM maze_kills WHERE event_id = :eid`,
    { eid: eventId }
  );
  return Number((rows[0] as { t: number }).t);
}

export async function isMazeMember(pool: Pool, eventId: number, discordUserId: string): Promise<boolean> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT 1 FROM maze_event_members WHERE event_id = :eid AND CAST(discord_user_id AS CHAR) = :uid LIMIT 1`,
    { eid: eventId, uid: String(discordUserId) }
  );
  return rows.length > 0;
}

/** Lobby or running maze roster for this Rust server (blocks joining KOTH on same server). */
export async function isDiscordUserInActiveMazeOnServer(
  pool: Pool,
  guildRowId: number,
  rustServerId: number,
  discordUserId: string
): Promise<boolean> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT 1
     FROM maze_event_members m
     INNER JOIN maze_events e ON e.id = m.event_id
     WHERE e.guild_id = :gid AND e.rust_server_id = :sid
       AND e.status IN ('lobby','running')
       AND CAST(m.discord_user_id AS CHAR) = :uid
     LIMIT 1`,
    { gid: guildRowId, sid: rustServerId, uid: String(discordUserId) }
  );
  return rows.length > 0;
}
