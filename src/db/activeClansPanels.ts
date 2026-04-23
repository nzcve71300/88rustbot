import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";

export type ActiveClansPanelRow = {
  rustServerId: number;
  channelId: string;
  messageId: string;
};

export async function upsertActiveClansPanel(
  pool: Pool,
  guildRowId: number,
  rustServerId: number,
  channelId: string,
  messageId: string
): Promise<void> {
  await pool.query<ResultSetHeader>(
    `
    INSERT INTO active_clans_panels (guild_id, rust_server_id, channel_id, message_id)
    VALUES (:gid, :sid, :chid, :mid)
    ON DUPLICATE KEY UPDATE
      channel_id = VALUES(channel_id),
      message_id = VALUES(message_id),
      updated_at = CURRENT_TIMESTAMP
    `,
    { gid: guildRowId, sid: rustServerId, chid: channelId, mid: messageId }
  );
}

export async function listActiveClansPanelsForGuild(
  pool: Pool,
  guildRowId: number
): Promise<ActiveClansPanelRow[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT rust_server_id AS rustServerId,
            CAST(channel_id AS CHAR) AS channelId,
            CAST(message_id AS CHAR) AS messageId
     FROM active_clans_panels
     WHERE guild_id = :gid`,
    { gid: guildRowId }
  );
  return (rows as unknown as ActiveClansPanelRow[]) ?? [];
}

export async function getActiveClansPanel(
  pool: Pool,
  guildRowId: number,
  rustServerId: number
): Promise<ActiveClansPanelRow | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT rust_server_id AS rustServerId,
            CAST(channel_id AS CHAR) AS channelId,
            CAST(message_id AS CHAR) AS messageId
     FROM active_clans_panels
     WHERE guild_id = :gid AND rust_server_id = :sid
     LIMIT 1`,
    { gid: guildRowId, sid: rustServerId }
  );
  const row = (rows as unknown as ActiveClansPanelRow[])[0];
  return row ?? null;
}

