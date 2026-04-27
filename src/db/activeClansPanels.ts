import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";

export type ActiveClansPanelRow = {
  rustServerId: number;
  channelId: string;
  messageId: string;
  /** Continuation Discord message IDs (same channel), when roster exceeds one message. */
  extraMessageIds: string[];
};

function parseExtraMessageIds(raw: unknown): string[] {
  if (raw == null) return [];
  if (Array.isArray(raw)) return raw.map((x) => String(x));
  if (typeof raw === "string") {
    try {
      const j = JSON.parse(raw) as unknown;
      if (Array.isArray(j)) return j.map((x) => String(x));
    } catch {
      return [];
    }
  }
  return [];
}

export async function upsertActiveClansPanel(
  pool: Pool,
  guildRowId: number,
  rustServerId: number,
  channelId: string,
  messageId: string,
  extraMessageIds: string[] | null = null
): Promise<void> {
  const extraJson =
    extraMessageIds != null && extraMessageIds.length > 0 ? JSON.stringify(extraMessageIds) : null;
  await pool.query<ResultSetHeader>(
    `
    INSERT INTO active_clans_panels (guild_id, rust_server_id, channel_id, message_id, extra_message_ids)
    VALUES (:gid, :sid, :chid, :mid, :extra)
    ON DUPLICATE KEY UPDATE
      channel_id = VALUES(channel_id),
      message_id = VALUES(message_id),
      extra_message_ids = VALUES(extra_message_ids),
      updated_at = CURRENT_TIMESTAMP
    `,
    { gid: guildRowId, sid: rustServerId, chid: channelId, mid: messageId, extra: extraJson }
  );
}

export async function listActiveClansPanelsForGuild(
  pool: Pool,
  guildRowId: number
): Promise<ActiveClansPanelRow[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT rust_server_id AS rustServerId,
            CAST(channel_id AS CHAR) AS channelId,
            CAST(message_id AS CHAR) AS messageId,
            extra_message_ids AS extraMessageIds
     FROM active_clans_panels
     WHERE guild_id = :gid`,
    { gid: guildRowId }
  );
  return ((rows as unknown as RowDataPacket[]) ?? []).map((r) => ({
    rustServerId: Number(r.rustServerId),
    channelId: String(r.channelId ?? ""),
    messageId: String(r.messageId ?? ""),
    extraMessageIds: parseExtraMessageIds(r.extraMessageIds),
  }));
}

export async function getActiveClansPanel(
  pool: Pool,
  guildRowId: number,
  rustServerId: number
): Promise<ActiveClansPanelRow | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT rust_server_id AS rustServerId,
            CAST(channel_id AS CHAR) AS channelId,
            CAST(message_id AS CHAR) AS messageId,
            extra_message_ids AS extraMessageIds
     FROM active_clans_panels
     WHERE guild_id = :gid AND rust_server_id = :sid
     LIMIT 1`,
    { gid: guildRowId, sid: rustServerId }
  );
  const r = (rows as unknown as RowDataPacket[])[0];
  if (!r) return null;
  return {
    rustServerId: Number(r.rustServerId),
    channelId: String(r.channelId ?? ""),
    messageId: String(r.messageId ?? ""),
    extraMessageIds: parseExtraMessageIds(r.extraMessageIds),
  };
}
