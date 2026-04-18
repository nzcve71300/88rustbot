import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";

export type SiteInboxRow = {
  id: number;
  kind: string;
  title: string;
  body: string;
  payload: unknown;
  createdAtMs: number;
};

export async function insertSiteInboxMessage(
  pool: Pool,
  targetDiscordUserId: string,
  kind: string,
  title: string,
  body: string,
  payload?: unknown
): Promise<number> {
  const [res] = await pool.query<ResultSetHeader>(
    `INSERT INTO site_inbox (target_discord_user_id, kind, title, body, payload_json)
     VALUES (:uid, :kind, :title, :body, :payload)`,
    {
      uid: targetDiscordUserId,
      kind,
      title,
      body,
      payload: payload === undefined ? null : JSON.stringify(payload ?? null),
    }
  );
  return Number(res.insertId);
}

export async function listUnreadSiteInboxForUser(
  pool: Pool,
  targetDiscordUserId: string,
  limit: number
): Promise<SiteInboxRow[]> {
  const lim = Math.min(Math.max(1, limit), 50);
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id, kind, title, body, payload_json AS payloadJson, UNIX_TIMESTAMP(created_at) * 1000 AS createdAtMs
     FROM site_inbox
     WHERE CAST(target_discord_user_id AS CHAR) = :uid AND read_at IS NULL
     ORDER BY id DESC
     LIMIT ${lim}`,
    { uid: String(targetDiscordUserId) }
  );
  return (rows as { id: number; kind: string; title: string; body: string; payloadJson: unknown; createdAtMs: number }[]).map(
    (r) => {
      let payload: unknown = r.payloadJson;
      if (typeof payload === "string") {
        try {
          payload = JSON.parse(payload) as unknown;
        } catch {
          payload = null;
        }
      }
      return {
        id: Number(r.id),
        kind: String(r.kind),
        title: String(r.title),
        body: String(r.body),
        payload,
        createdAtMs: Number(r.createdAtMs),
      };
    }
  );
}

export async function markSiteInboxRead(
  pool: Pool,
  targetDiscordUserId: string,
  ids: number[]
): Promise<void> {
  if (!ids.length) return;
  const placeholders = ids.map(() => "?").join(",");
  await pool.query<ResultSetHeader>(
    `UPDATE site_inbox SET read_at = CURRENT_TIMESTAMP
     WHERE CAST(target_discord_user_id AS CHAR) = ? AND read_at IS NULL AND id IN (${placeholders})`,
    [String(targetDiscordUserId), ...ids]
  );
}
