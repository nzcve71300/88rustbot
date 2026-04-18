import type { Pool, RowDataPacket } from "mysql2/promise";

/** Max samples per Rust server — oldest rows are deleted when this is exceeded (charts show at most this many timestamps). */
export const MAX_SERVER_METRIC_SAMPLES = 16;

export type ServerMetricRow = {
  id: number;
  capturedAtMs: number;
  serverTimeMs: number | null;
  entityCount: number;
  framerate: number;
  memoryMb: number;
  players: number;
};

export async function insertServerMetricSample(
  pool: Pool,
  rustServerId: number,
  capturedAt: Date,
  serverTime: Date | null,
  entityCount: number,
  framerate: number,
  memoryMb: number,
  players: number
): Promise<void> {
  await pool.query(
    `INSERT INTO server_metrics_samples
      (rust_server_id, captured_at, server_time, entity_count, framerate, memory_mb, players)
     VALUES (:sid, :captured, :serverTime, :ec, :fps, :mem, :pl)`,
    {
      sid: rustServerId,
      captured: capturedAt,
      serverTime,
      ec: entityCount,
      fps: framerate,
      mem: memoryMb,
      pl: players,
    }
  );
}

/**
 * Keep only the `keep` newest samples per server (by server_time / captured_at).
 * Deletes older rows so charts never accumulate unbounded timestamps.
 */
export async function trimServerMetricsToLastN(pool: Pool, rustServerId: number, keep: number): Promise<void> {
  const k = Math.max(1, Math.floor(keep));
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id FROM server_metrics_samples
     WHERE rust_server_id = :sid
     ORDER BY COALESCE(server_time, captured_at) DESC, id DESC`,
    { sid: rustServerId }
  );
  if (rows.length <= k) return;
  const drop = rows.slice(k).map((r) => Number((r as { id: unknown }).id));
  if (drop.length === 0) return;
  const placeholders = drop.map(() => "?").join(",");
  await pool.query(`DELETE FROM server_metrics_samples WHERE rust_server_id = ? AND id IN (${placeholders})`, [
    rustServerId,
    ...drop,
  ]);
}

export async function listServerMetricsForServer(
  pool: Pool,
  rustServerId: number
): Promise<ServerMetricRow[]> {
  const limit = MAX_SERVER_METRIC_SAMPLES;
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id,
            UNIX_TIMESTAMP(captured_at) * 1000 AS captured_at_ms,
            CASE WHEN server_time IS NULL THEN NULL ELSE UNIX_TIMESTAMP(server_time) * 1000 END AS server_time_ms,
            entity_count,
            framerate,
            memory_mb,
            players
     FROM (
       SELECT id, captured_at, server_time, entity_count, framerate, memory_mb, players
       FROM server_metrics_samples
       WHERE rust_server_id = :sid
       ORDER BY COALESCE(server_time, captured_at) DESC, id DESC
       LIMIT ${limit}
     ) AS newest
     ORDER BY COALESCE(server_time, captured_at) ASC, id ASC`,
    { sid: rustServerId }
  );
  return rows.map((r) => {
    const row = r as Record<string, unknown>;
    return {
      id: Number(row.id),
      capturedAtMs: Number(row.captured_at_ms),
      serverTimeMs: row.server_time_ms != null ? Number(row.server_time_ms) : null,
      entityCount: Number(row.entity_count),
      framerate: Number(row.framerate),
      memoryMb: Number(row.memory_mb),
      players: Number(row.players),
    };
  });
}
