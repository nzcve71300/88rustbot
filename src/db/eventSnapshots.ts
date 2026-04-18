import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";

export type EventSnapshotType = "koth" | "maze" | "nuketown" | "onev1";

export type EventSnapshotRow = {
  id: number;
  guildRowId: number;
  rustServerId: number;
  type: EventSnapshotType;
  createdAtMs: number;
  expiresAtMs: number;
  payload: unknown;
};

const SNAPSHOT_TTL_MS = 10 * 60_000;

export async function insertEventSnapshot(opts: {
  pool: Pool;
  guildRowId: number;
  rustServerId: number;
  type: EventSnapshotType;
  payload: unknown;
}): Promise<void> {
  const { pool, guildRowId, rustServerId, type, payload } = opts;
  const json = JSON.stringify(payload);
  await pool.query<ResultSetHeader>(
    `INSERT INTO event_snapshots (guild_id, rust_server_id, type, payload_json, expires_at)
     VALUES (:gid, :sid, :type, :json, DATE_ADD(CURRENT_TIMESTAMP, INTERVAL 10 MINUTE))`,
    { gid: guildRowId, sid: rustServerId, type, json }
  );
}

export async function getLatestUnexpiredSnapshot(
  pool: Pool,
  guildRowId: number,
  rustServerId: number,
  type: EventSnapshotType
): Promise<EventSnapshotRow | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id,
            guild_id AS guildRowId,
            rust_server_id AS rustServerId,
            type,
            UNIX_TIMESTAMP(created_at) * 1000 AS createdAtMs,
            UNIX_TIMESTAMP(expires_at) * 1000 AS expiresAtMs,
            payload_json AS payloadJson
     FROM event_snapshots
     WHERE guild_id = :gid AND rust_server_id = :sid AND type = :type
       AND expires_at > CURRENT_TIMESTAMP
     ORDER BY id DESC
     LIMIT 1`,
    { gid: guildRowId, sid: rustServerId, type }
  );
  const r =
    (rows[0] as {
      id: number;
      guildRowId: number;
      rustServerId: number;
      type: EventSnapshotType;
      createdAtMs: number;
      expiresAtMs: number;
      payloadJson: string;
    }) ?? null;
  if (!r) return null;
  let payload: unknown = null;
  try {
    payload = JSON.parse(String(r.payloadJson)) as unknown;
  } catch {
    payload = null;
  }
  return {
    id: Number(r.id),
    guildRowId: Number(r.guildRowId),
    rustServerId: Number(r.rustServerId),
    type: r.type,
    createdAtMs: Number(r.createdAtMs),
    expiresAtMs: Number(r.expiresAtMs),
    payload,
  };
}

export async function deleteExpiredSnapshots(pool: Pool): Promise<number> {
  const [res] = await pool.query<ResultSetHeader>(
    `DELETE FROM event_snapshots WHERE expires_at <= CURRENT_TIMESTAMP`
  );
  return Number(res.affectedRows ?? 0);
}

export function getSnapshotTtlMs(): number {
  return SNAPSHOT_TTL_MS;
}

