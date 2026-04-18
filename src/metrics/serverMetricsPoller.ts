import type { Pool } from "mysql2/promise";
import { config } from "../config.js";
import { decryptSecret } from "../crypto/passwordVault.js";
import { insertServerMetricSample, pruneAllServerMetrics } from "../db/serverMetrics.js";
import { listAllRustServers } from "../db/rustServers.js";
import { parseServerinfoRconMessage } from "../rcon/serverinfoMessage.js";
import { runWebRconCommand } from "../rcon/webrcon.js";

const POLL_MS = 30_000;
const CONCURRENCY = 3;

async function mapPool<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let idx = 0;
  const workers = Array.from({ length: Math.min(limit, Math.max(1, items.length)) }, async () => {
    while (idx < items.length) {
      const j = idx++;
      out[j] = await fn(items[j]!);
    }
  });
  await Promise.all(workers);
  return out;
}

async function pollOneServer(
  pool: Pool,
  row: { id: number; server_ip: string; rcon_port: number; rcon_password_encrypted: Buffer }
): Promise<void> {
  let password: string;
  try {
    password = decryptSecret(row.rcon_password_encrypted, config.encryptionKeyHex);
  } catch {
    return;
  }

  const rGlobal = await runWebRconCommand(row.id, row.server_ip, row.rcon_port, password, "global.serverinfo");
  let r = rGlobal;
  if (!rGlobal.ok) {
    r = await runWebRconCommand(row.id, row.server_ip, row.rcon_port, password, "serverinfo");
  } else {
    const probe = parseServerinfoRconMessage(rGlobal.message);
    if (!probe.metrics) {
      r = await runWebRconCommand(row.id, row.server_ip, row.rcon_port, password, "serverinfo");
    }
  }

  if (!r.ok) return;

  const { serverTime, metrics } = parseServerinfoRconMessage(r.message);
  if (!metrics) return;

  const captured = new Date();
  await insertServerMetricSample(
    pool,
    row.id,
    captured,
    serverTime,
    metrics.EntityCount,
    metrics.Framerate,
    metrics.Memory,
    metrics.Players
  );
}

export function startServerMetricsPoller(pool: Pool): void {
  const tick = async (): Promise<void> => {
    try {
      const rows = await listAllRustServers(pool);
      await mapPool(rows, CONCURRENCY, (row) => pollOneServer(pool, row));
      await pruneAllServerMetrics(pool, 10);
    } catch (e) {
      console.error("[server-metrics] poll failed:", e);
    }
  };

  void tick();
  setInterval(() => {
    void tick();
  }, POLL_MS);
}
