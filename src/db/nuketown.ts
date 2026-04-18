import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";

export type NuketownConfig = {
  rustServerId: number;
  announcementChannelId: string;
  announcementRoleId: string | null;
  gates: number;
  gateFrequency: number;
  teamLimit: number;
  kitName: string;
  messageId: string | null;
};

export async function upsertNuketownConfig(
  pool: Pool,
  guildRowId: number,
  rustServerId: number,
  announcementChannelId: string,
  announcementRoleId: string | null,
  gates: number,
  gateFrequency: number,
  teamLimit: number,
  kitName: string,
  messageId: string | null
): Promise<void> {
  await pool.query<ResultSetHeader>(
    `
    INSERT INTO nuketown_configs
      (guild_id, rust_server_id, announcement_channel_id, announcement_role_id, gates, gate_frequency, team_limit, kit_name, message_id)
    VALUES
      (:gid, :sid, :chan, :role, :gates, :freq, :tlimit, :kit, :msg)
    ON DUPLICATE KEY UPDATE
      announcement_channel_id = VALUES(announcement_channel_id),
      announcement_role_id = VALUES(announcement_role_id),
      gates = VALUES(gates),
      gate_frequency = VALUES(gate_frequency),
      team_limit = VALUES(team_limit),
      kit_name = VALUES(kit_name),
      message_id = VALUES(message_id)
  `,
    {
      gid: guildRowId,
      sid: rustServerId,
      chan: announcementChannelId,
      role: announcementRoleId,
      gates,
      freq: gateFrequency,
      tlimit: teamLimit,
      kit: kitName,
      msg: messageId,
    }
  );
}

export async function getNuketownConfig(
  pool: Pool,
  guildRowId: number,
  rustServerId: number
): Promise<NuketownConfig | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT rust_server_id as rustServerId,
            CAST(announcement_channel_id AS CHAR) as announcementChannelId,
            CAST(announcement_role_id AS CHAR) as announcementRoleId,
            gates, gate_frequency as gateFrequency,
            team_limit as teamLimit,
            kit_name as kitName,
            CAST(message_id AS CHAR) as messageId
     FROM nuketown_configs WHERE guild_id = :gid AND rust_server_id = :sid LIMIT 1`,
    { gid: guildRowId, sid: rustServerId }
  );
  return (rows[0] as NuketownConfig | undefined) ?? null;
}

export type NuketownEventMeta = {
  id: number;
  status: "lobby" | "running" | "finished";
  lobbyEndsAtMs: number | null;
  teamLimit: number | null;
  kitName: string | null;
  bracketJson: unknown | null;
};

export async function getActiveNuketownEventMeta(
  pool: Pool,
  guildRowId: number,
  rustServerId: number
): Promise<NuketownEventMeta | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id, status,
            CASE WHEN lobby_ends_at IS NULL THEN NULL ELSE UNIX_TIMESTAMP(lobby_ends_at) * 1000 END AS lobbyEndsAtMs,
            team_limit as teamLimit,
            kit_name as kitName,
            bracket_json as bracketJson
     FROM nuketown_events
     WHERE guild_id = :gid AND rust_server_id = :sid AND status IN ('lobby','running')
     ORDER BY id DESC LIMIT 1`,
    { gid: guildRowId, sid: rustServerId }
  );
  const r = rows[0] as
    | {
        id: number;
        status: "lobby" | "running" | "finished";
        lobbyEndsAtMs: number | null;
        teamLimit: number | null;
        kitName: string | null;
        bracketJson: any;
      }
    | undefined;
  if (!r) return null;
  return {
    id: Number(r.id),
    status: r.status,
    lobbyEndsAtMs: r.lobbyEndsAtMs != null ? Number(r.lobbyEndsAtMs) : null,
    teamLimit: r.teamLimit != null ? Number(r.teamLimit) : null,
    kitName: r.kitName != null ? String(r.kitName) : null,
    bracketJson: r.bracketJson ?? null,
  };
}

export async function getActiveNuketownEvent(
  pool: Pool,
  guildRowId: number,
  rustServerId: number
): Promise<{ id: number; status: "lobby" | "running" } | null> {
  const meta = await getActiveNuketownEventMeta(pool, guildRowId, rustServerId);
  if (!meta) return null;
  if (meta.status === "lobby" || meta.status === "running") return { id: meta.id, status: meta.status };
  return null;
}

export type LobbyForJoinResult = { ok: true; eventId: number } | { ok: false; reason: "running" };

export async function ensureLobbyNuketownForJoin(
  pool: Pool,
  guildRowId: number,
  rustServerId: number,
  lobbyMinutes: number
): Promise<LobbyForJoinResult> {
  const active = await getActiveNuketownEvent(pool, guildRowId, rustServerId);
  if (active?.status === "running") return { ok: false, reason: "running" };
  if (active?.status === "lobby") return { ok: true, eventId: active.id };

  const [res] = await pool.query<ResultSetHeader>(
    `INSERT INTO nuketown_events (guild_id, rust_server_id, status, lobby_ends_at)
     VALUES (:gid, :sid, 'lobby', DATE_ADD(CURRENT_TIMESTAMP, INTERVAL :mins MINUTE))`,
    { gid: guildRowId, sid: rustServerId, mins: lobbyMinutes }
  );
  return { ok: true, eventId: Number(res.insertId) };
}

export async function setNuketownLobbyEndsAtNow(pool: Pool, eventId: number): Promise<void> {
  await pool.query<ResultSetHeader>(`UPDATE nuketown_events SET lobby_ends_at = CURRENT_TIMESTAMP WHERE id = :eid`, {
    eid: eventId,
  });
}

export async function startNuketownEvent(
  pool: Pool,
  eventId: number,
  kitName: string,
  teamLimit: number,
  bracketJson: unknown
): Promise<boolean> {
  const [res] = await pool.query<ResultSetHeader>(
    `UPDATE nuketown_events SET
       status = 'running',
       kit_name = :kit,
       team_limit = :tlimit,
       started_at = CURRENT_TIMESTAMP,
       bracket_json = :bracket
     WHERE id = :eid AND status = 'lobby'`,
    { eid: eventId, kit: kitName, tlimit: teamLimit, bracket: JSON.stringify(bracketJson) }
  );
  return res.affectedRows > 0;
}

export async function finishNuketownEvent(pool: Pool, eventId: number): Promise<void> {
  await pool.query<ResultSetHeader>(`UPDATE nuketown_events SET status = 'finished' WHERE id = :eid`, { eid: eventId });
}

export async function updateNuketownBracketJson(pool: Pool, eventId: number, bracketJson: unknown): Promise<void> {
  await pool.query<ResultSetHeader>(`UPDATE nuketown_events SET bracket_json = :b WHERE id = :eid`, {
    eid: eventId,
    b: JSON.stringify(bracketJson),
  });
}

export async function deleteNuketownEventAndClearConfig(
  pool: Pool,
  guildRowId: number,
  rustServerId: number,
  eventId: number
): Promise<void> {
  await pool.query<ResultSetHeader>(
    `DELETE FROM nuketown_events WHERE id = :eid AND guild_id = :gid`,
    { eid: eventId, gid: guildRowId }
  );
  await pool.query<ResultSetHeader>(
    `DELETE FROM nuketown_configs WHERE guild_id = :gid AND rust_server_id = :sid`,
    { gid: guildRowId, sid: rustServerId }
  );
}

export async function deleteNuketownEventOnly(pool: Pool, eventId: number): Promise<void> {
  await pool.query<ResultSetHeader>(`DELETE FROM nuketown_events WHERE id = :eid`, { eid: eventId });
}

export async function countNuketownMembers(pool: Pool, eventId: number): Promise<number> {
  const [rows] = await pool.query<RowDataPacket[]>(`SELECT COUNT(*) AS c FROM nuketown_event_members WHERE event_id = :eid`, {
    eid: eventId,
  });
  return Number((rows[0] as { c: number }).c);
}

export async function countNuketownTeams(pool: Pool, eventId: number): Promise<number> {
  const [rows] = await pool.query<RowDataPacket[]>(`SELECT COUNT(*) AS c FROM nuketown_event_teams WHERE event_id = :eid`, {
    eid: eventId,
  });
  return Number((rows[0] as { c: number }).c);
}

export async function listNuketownTeams(pool: Pool, eventId: number): Promise<{ slot: number; clanId: number }[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT slot, clan_id AS clanId FROM nuketown_event_teams WHERE event_id = :eid ORDER BY slot ASC`,
    { eid: eventId }
  );
  return rows.map((r) => ({ slot: Number((r as any).slot), clanId: Number((r as any).clanId) }));
}

export async function getNuketownTeamSlot(
  pool: Pool,
  eventId: number,
  clanId: number
): Promise<number | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT slot FROM nuketown_event_teams WHERE event_id = :eid AND clan_id = :cid LIMIT 1`,
    { eid: eventId, cid: clanId }
  );
  const r = rows[0] as { slot: number } | undefined;
  return r ? Number(r.slot) : null;
}

export async function assignNuketownTeamSlot(
  pool: Pool,
  eventId: number,
  slot: number,
  clanId: number
): Promise<void> {
  await pool.query<ResultSetHeader>(
    `INSERT INTO nuketown_event_teams (event_id, slot, clan_id) VALUES (:eid, :slot, :cid)`,
    { eid: eventId, slot, cid: clanId }
  );
}

export type AddMemberResult = "ok" | "already_joined" | "team_full";

export async function addNuketownEventMember(
  pool: Pool,
  eventId: number,
  clanId: number,
  discordUserId: string,
  teamLimit: number
): Promise<AddMemberResult> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS c FROM nuketown_event_members WHERE event_id = :eid AND clan_id = :cid`,
    { eid: eventId, cid: clanId }
  );
  const c = Number((rows[0] as any).c);
  if (c >= teamLimit) return "team_full";

  const [res] = await pool.query<ResultSetHeader>(
    `INSERT IGNORE INTO nuketown_event_members (event_id, clan_id, discord_user_id)
     VALUES (:eid, :cid, :uid)`,
    { eid: eventId, cid: clanId, uid: String(discordUserId) }
  );
  if (res.affectedRows === 0) return "already_joined";
  return "ok";
}

export async function removeNuketownEventMember(
  pool: Pool,
  eventId: number,
  discordUserId: string
): Promise<boolean> {
  const [res] = await pool.query<ResultSetHeader>(
    `DELETE FROM nuketown_event_members WHERE event_id = :eid AND discord_user_id = :uid`,
    { eid: eventId, uid: String(discordUserId) }
  );
  return res.affectedRows > 0;
}

export async function removeNuketownTeamIfEmpty(pool: Pool, eventId: number, clanId: number): Promise<void> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS c FROM nuketown_event_members WHERE event_id = :eid AND clan_id = :cid`,
    { eid: eventId, cid: clanId }
  );
  const c = Number((rows[0] as any).c);
  if (c > 0) return;
  await pool.query<ResultSetHeader>(
    `DELETE FROM nuketown_event_teams WHERE event_id = :eid AND clan_id = :cid`,
    { eid: eventId, cid: clanId }
  );
}

export async function listNuketownParticipants(
  pool: Pool,
  guildRowId: number,
  eventId: number
): Promise<{
  discordUserId: string;
  ingameName: string;
  clanId: number;
  clanName: string;
  clanTag: string;
  clanColor: string | null;
}[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT CAST(m.discord_user_id AS CHAR) AS discordUserId,
            l.ingame_name AS ingameName,
            c.id AS clanId,
            c.name AS clanName,
            c.tag AS clanTag,
            c.color AS clanColor
     FROM nuketown_event_members m
     INNER JOIN clans c ON c.id = m.clan_id
     INNER JOIN discord_links l ON l.guild_id = :gid AND CAST(l.discord_user_id AS CHAR) = CAST(m.discord_user_id AS CHAR)
     WHERE m.event_id = :eid
     ORDER BY c.id ASC, l.ingame_name ASC`,
    { gid: guildRowId, eid: eventId }
  );
  return rows.map((r) => ({
    discordUserId: String((r as any).discordUserId),
    ingameName: String((r as any).ingameName),
    clanId: Number((r as any).clanId),
    clanName: String((r as any).clanName),
    clanTag: String((r as any).clanTag),
    clanColor: (r as any).clanColor != null ? String((r as any).clanColor) : null,
  }));
}

export async function upsertNuketownGateCoord(
  pool: Pool,
  guildRowId: number,
  rustServerId: number,
  gate: number,
  coord: string
): Promise<void> {
  await pool.query<ResultSetHeader>(
    `INSERT INTO nuketown_gate_coords (guild_id, rust_server_id, gate_number, coord)
     VALUES (:gid, :sid, :gate, :coord)
     ON DUPLICATE KEY UPDATE coord = VALUES(coord)`,
    { gid: guildRowId, sid: rustServerId, gate, coord }
  );
}

export async function getNuketownGateCoord(
  pool: Pool,
  guildRowId: number,
  rustServerId: number,
  gate: number
): Promise<string | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT coord FROM nuketown_gate_coords WHERE guild_id = :gid AND rust_server_id = :sid AND gate_number = :gate LIMIT 1`,
    { gid: guildRowId, sid: rustServerId, gate }
  );
  const r = rows[0] as { coord: string } | undefined;
  return r ? String(r.coord) : null;
}

