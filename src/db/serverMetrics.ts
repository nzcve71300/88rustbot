import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";

const RETENTION_MINUTES = 10;

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

/** Prune rolling window for all servers (after each poll wave). */
export async function pruneAllServerMetrics(pool: Pool, minutes = RETENTION_MINUTES): Promise<void> {
  const m = Math.max(1, Math.floor(minutes));
  await pool.query<ResultSetHeader>(
    `DELETE FROM server_metrics_samples WHERE captured_at < DATE_SUB(NOW(), INTERVAL ${m} MINUTE)`
  );
}

export async function listServerMetricsForServer(
  pool: Pool,
  rustServerId: number
): Promise<ServerMetricRow[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id,
            UNIX_TIMESTAMP(captured_at) * 1000 AS captured_at_ms,
            CASE WHEN server_time IS NULL THEN NULL ELSE UNIX_TIMESTAMP(server_time) * 1000 END AS server_time_ms,
            entity_count,
            framerate,
            memory_mb,
            players
     FROM server_metrics_samples
     WHERE rust_server_id = :sid
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
