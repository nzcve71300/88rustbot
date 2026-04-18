import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";

export type OneV1ConfigRow = {
  announcementChannelId: string;
  enabled: boolean;
  kitName: string;
  gateFrequency: number;
};

export async function getOneV1Config(
  pool: Pool,
  guildRowId: number,
  rustServerId: number
): Promise<OneV1ConfigRow | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT announcement_channel_id AS announcementChannelId, enabled, kit_name AS kitName, gate_frequency AS gateFrequency
     FROM one_v_one_configs WHERE guild_id = :gid AND rust_server_id = :sid LIMIT 1`,
    { gid: guildRowId, sid: rustServerId }
  );
  const r = rows[0] as
    | {
        announcementChannelId: string;
        enabled: number;
        kitName: string;
        gateFrequency: number;
      }
    | undefined;
  if (!r) return null;
  return {
    announcementChannelId: String(r.announcementChannelId),
    enabled: r.enabled === 1,
    kitName: String(r.kitName),
    gateFrequency: Number(r.gateFrequency),
  };
}

export async function upsertOneV1Config(
  pool: Pool,
  guildRowId: number,
  rustServerId: number,
  announcementChannelId: string,
  enabled: boolean,
  kitName: string,
  gateFrequency: number
): Promise<void> {
  await pool.query<ResultSetHeader>(
    `INSERT INTO one_v_one_configs (guild_id, rust_server_id, announcement_channel_id, enabled, kit_name, gate_frequency)
     VALUES (:gid, :sid, :ch, :en, :kit, :freq)
     ON DUPLICATE KEY UPDATE
       announcement_channel_id = VALUES(announcement_channel_id),
       enabled = VALUES(enabled),
       kit_name = VALUES(kit_name),
       gate_frequency = VALUES(gate_frequency)`,
    {
      gid: guildRowId,
      sid: rustServerId,
      ch: announcementChannelId,
      en: enabled ? 1 : 0,
      kit: kitName.trim(),
      freq: gateFrequency,
    }
  );
}

export async function upsertOneV1GateCoord(
  pool: Pool,
  guildRowId: number,
  rustServerId: number,
  gateNumber: 1 | 2,
  coord: string
): Promise<void> {
  await pool.query<ResultSetHeader>(
    `INSERT INTO one_v_one_gate_coords (guild_id, rust_server_id, gate_number, coord)
     VALUES (:gid, :sid, :gn, :coord)
     ON DUPLICATE KEY UPDATE coord = VALUES(coord)`,
    { gid: guildRowId, sid: rustServerId, gn: gateNumber, coord }
  );
}

export async function getOneV1GateCoord(
  pool: Pool,
  guildRowId: number,
  rustServerId: number,
  gateNumber: 1 | 2
): Promise<string | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT coord FROM one_v_one_gate_coords WHERE guild_id = :gid AND rust_server_id = :sid AND gate_number = :gn LIMIT 1`,
    { gid: guildRowId, sid: rustServerId, gn: gateNumber }
  );
  const c = (rows[0] as { coord: string } | undefined)?.coord;
  return c ? String(c) : null;
}

export type OneV1MatchRow = {
  id: number;
  guildId: number;
  rustServerId: number;
  challengerDiscordId: string;
  opponentDiscordId: string;
  status: "pending" | "active";
  channelId: string;
  messageId: string | null;
  stateJson: unknown | null;
};

export async function insertPendingMatch(
  pool: Pool,
  guildRowId: number,
  rustServerId: number,
  challengerDiscordId: string,
  opponentDiscordId: string,
  channelId: string,
  messageId: string | null
): Promise<number> {
  const [res] = await pool.query<ResultSetHeader>(
    `INSERT INTO one_v_one_matches (guild_id, rust_server_id, challenger_discord_id, opponent_discord_id, status, channel_id, message_id)
     VALUES (:gid, :sid, :chal, :opp, 'pending', :chid, :mid)`,
    {
      gid: guildRowId,
      sid: rustServerId,
      chal: challengerDiscordId,
      opp: opponentDiscordId,
      chid: channelId,
      mid: messageId,
    }
  );
  return Number(res.insertId);
}

export async function updateMatchMessageId(pool: Pool, matchId: number, messageId: string): Promise<void> {
  await pool.query<ResultSetHeader>(
    `UPDATE one_v_one_matches SET message_id = :mid WHERE id = :id`,
    { mid: messageId, id: matchId }
  );
}

export async function setMatchActive(pool: Pool, matchId: number): Promise<void> {
  await pool.query<ResultSetHeader>(`UPDATE one_v_one_matches SET status = 'active' WHERE id = :id`, { id: matchId });
}

export async function updateMatchStateJson(pool: Pool, matchId: number, state: unknown): Promise<void> {
  await pool.query<ResultSetHeader>(
    `UPDATE one_v_one_matches SET state_json = :j WHERE id = :id`,
    { j: JSON.stringify(state), id: matchId }
  );
}

export async function deleteMatch(pool: Pool, matchId: number): Promise<void> {
  await pool.query<ResultSetHeader>(`DELETE FROM one_v_one_matches WHERE id = :id`, { id: matchId });
}

export async function getMatchById(pool: Pool, matchId: number): Promise<OneV1MatchRow | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id, guild_id AS guildId, rust_server_id AS rustServerId,
            CAST(challenger_discord_id AS CHAR) AS challengerDiscordId,
            CAST(opponent_discord_id AS CHAR) AS opponentDiscordId,
            status, CAST(channel_id AS CHAR) AS channelId,
            CAST(message_id AS CHAR) AS messageId, state_json AS stateJson
     FROM one_v_one_matches WHERE id = :id LIMIT 1`,
    { id: matchId }
  );
  const r = rows[0] as
    | {
        id: number;
        guildId: number;
        rustServerId: number;
        challengerDiscordId: string;
        opponentDiscordId: string;
        status: string;
        channelId: string;
        messageId: string | null;
        stateJson: unknown;
      }
    | undefined;
  if (!r) return null;
  let sj = r.stateJson;
  if (typeof sj === "string") {
    try {
      sj = JSON.parse(sj) as unknown;
    } catch {
      sj = null;
    }
  }
  return {
    id: r.id,
    guildId: r.guildId,
    rustServerId: Number(r.rustServerId),
    challengerDiscordId: String(r.challengerDiscordId),
    opponentDiscordId: String(r.opponentDiscordId),
    status: r.status === "active" ? "active" : "pending",
    channelId: String(r.channelId),
    messageId: r.messageId ? String(r.messageId) : null,
    stateJson: sj,
  };
}

export async function hasActiveOrPendingMatch(pool: Pool, rustServerId: number): Promise<boolean> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS c FROM one_v_one_matches WHERE rust_server_id = :sid AND status IN ('pending','active')`,
    { sid: rustServerId }
  );
  return Number((rows[0] as { c: number }).c) > 0;
}

export async function getMatchForServer(
  pool: Pool,
  rustServerId: number
): Promise<OneV1MatchRow | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id, guild_id AS guildId, rust_server_id AS rustServerId,
            CAST(challenger_discord_id AS CHAR) AS challengerDiscordId,
            CAST(opponent_discord_id AS CHAR) AS opponentDiscordId,
            status, CAST(channel_id AS CHAR) AS channelId,
            CAST(message_id AS CHAR) AS messageId, state_json AS stateJson
     FROM one_v_one_matches WHERE rust_server_id = :sid AND status IN ('pending','active') ORDER BY id DESC LIMIT 1`,
    { sid: rustServerId }
  );
  const r = rows[0] as
    | {
        id: number;
        guildId: number;
        rustServerId: number;
        challengerDiscordId: string;
        opponentDiscordId: string;
        status: string;
        channelId: string;
        messageId: string | null;
        stateJson: unknown;
      }
    | undefined;
  if (!r) return null;
  let sj = r.stateJson;
  if (typeof sj === "string") {
    try {
      sj = JSON.parse(sj) as unknown;
    } catch {
      sj = null;
    }
  }
  return {
    id: r.id,
    guildId: r.guildId,
    rustServerId: Number(r.rustServerId),
    challengerDiscordId: String(r.challengerDiscordId),
    opponentDiscordId: String(r.opponentDiscordId),
    status: r.status === "active" ? "active" : "pending",
    channelId: String(r.channelId),
    messageId: r.messageId ? String(r.messageId) : null,
    stateJson: sj,
  };
}
