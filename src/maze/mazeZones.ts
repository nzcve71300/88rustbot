import type { Pool } from "mysql2/promise";
import { getMazeSpawnCoord } from "../db/maze.js";
import { parseGateCoordTriple } from "../koth/runner.js";
import { runWebRconCommand } from "../rcon/webrcon.js";
import { quoteForRconArg } from "../rcon/quote.js";

/** Zone name tied to a maze spawn slot (matches user-facing "spawn point 1", …). */
export function mazeSpawnZoneName(spawnNumber: number): string {
  return `spawn point ${spawnNumber}`;
}

function formatParenXyz(xyz: [number, number, number]): string {
  return `(${xyz[0].toFixed(2)},${xyz[1].toFixed(2)},${xyz[2].toFixed(2)})`;
}

/** `zones.createcustomzone "spawn point 1" (x,y,z) 45 sphere 2 0 0 0 0 0` */
export function buildCreateMazeZoneCommand(zoneName: string, xyz: [number, number, number]): string {
  const q = `"${quoteForRconArg(zoneName)}"`;
  return `zones.createcustomzone ${q} ${formatParenXyz(xyz)} 45 sphere 2 0 0 0 0 0`;
}

/** `zones.deletecustomzone "spawn point 1"` */
export function buildDeleteMazeZoneCommand(zoneName: string): string {
  return `zones.deletecustomzone "${quoteForRconArg(zoneName)}"`;
}

function teleportPosRotCommand(xyz: [number, number, number], ingameName: string): string {
  const pos = formatParenXyz(xyz);
  const inner = quoteForRconArg(ingameName.trim());
  // IMPORTANT: last arg must be "0" for our Rust server command behavior.
  return `global.teleportposrot ${pos} "${inner}" "0"`;
}

function parseMsEnv(name: string, fallback: number): number {
  const v = process.env[name]?.trim();
  if (v === undefined || v === "") return fallback;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/** After initial teleports, keep zones before delete (was 5000ms). */
const MAZE_INITIAL_ZONE_HOLD_MS = parseMsEnv("MAZE_INITIAL_ZONE_HOLD_MS", 3000);
/** After respawn teleport, before deleting protection zone (was 5000ms). */
const MAZE_RESPAWN_ZONE_HOLD_MS = parseMsEnv("MAZE_RESPAWN_ZONE_HOLD_MS", 2500);
/** Pace players so WebRCON is not flooded (parallel kit/TP caused dropped commands on busy hosts). */
const MAZE_INTER_PLAYER_MS = parseMsEnv("MAZE_INTER_PLAYER_MS", 220);
/** After fast retries fail, wait this long and try again (RCON saturation). */
const MAZE_SLOW_DELAY_MS = parseMsEnv("MAZE_SLOW_DELAY_MS", 5000);
const MAZE_SLOW_ROUNDS = parseMsEnv("MAZE_SLOW_ROUNDS", 3);

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function sleepAbortable(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) throw new Error("Maze aborted");
  const started = Date.now();
  while (Date.now() - started < ms) {
    if (signal.aborted) throw new Error("Maze aborted");
    await sleep(200);
  }
}

/**
 * Fast attempts with short delay, then **slow** rounds (default 5s apart) when RCON is backlogged.
 */
async function runRconWithRetries(
  rustServerId: number,
  host: string,
  port: number,
  password: string,
  cmd: string,
  attempts: number,
  retryDelayMs: number,
  signal: AbortSignal
): Promise<{ ok: boolean; error?: string }> {
  const max = Math.max(1, Math.floor(attempts));
  let lastErr = "";
  for (let i = 1; i <= max; i++) {
    if (signal.aborted) return { ok: false, error: "aborted" };
    const r = await runWebRconCommand(rustServerId, host, port, password, cmd);
    if (r.ok) return { ok: true };
    lastErr = r.error ?? "unknown";
    if (i < max) await sleepAbortable(retryDelayMs, signal);
  }
  const slowMax = Math.max(0, Math.floor(MAZE_SLOW_ROUNDS));
  for (let s = 1; s <= slowMax; s++) {
    if (signal.aborted) return { ok: false, error: "aborted" };
    await sleepAbortable(MAZE_SLOW_DELAY_MS, signal);
    const r = await runWebRconCommand(rustServerId, host, port, password, cmd);
    if (r.ok) return { ok: true };
    lastErr = r.error ?? "unknown";
  }
  return { ok: false, error: lastErr || "unknown" };
}

export type MazeInitialSpawnOpts = {
  pool: Pool;
  guildRowId: number;
  rustServerId: number;
  kitName: string;
  host: string;
  port: number;
  password: string;
  signal: AbortSignal;
  participants: { ingameName: string; spawnNumber: number }[];
};

/**
 * For each participant: create protection zone at their spawn, kit, teleportposrot (**sequential** with pacing).
 * Parallel RCON previously saturated the host and players missed teleports.
 */
export async function runMazeInitialSpawnWithZones(opts: MazeInitialSpawnOpts): Promise<void> {
  const { pool, guildRowId, rustServerId, kitName, host, port, password, signal, participants } = opts;
  const kit = kitName.trim();

  const zoneNames: string[] = [];
  for (let i = 0; i < participants.length; i++) {
    const p = participants[i]!;
    if (signal.aborted) throw new Error("Maze aborted");
    if (i > 0 && MAZE_INTER_PLAYER_MS > 0) {
      await sleepAbortable(MAZE_INTER_PLAYER_MS, signal);
    }

    const coordStr = await getMazeSpawnCoord(pool, guildRowId, rustServerId, p.spawnNumber);
    if (!coordStr) {
      console.warn(`[maze] initial spawn: missing coord for spawn ${p.spawnNumber} (${p.ingameName})`);
      continue;
    }
    const xyz = parseGateCoordTriple(coordStr);
    if (!xyz) {
      console.warn(`[maze] initial spawn: bad coord for spawn ${p.spawnNumber}: ${coordStr}`);
      continue;
    }

    const zn = mazeSpawnZoneName(p.spawnNumber);

    const createRes = await runWebRconCommand(rustServerId, host, port, password, buildCreateMazeZoneCommand(zn, xyz));
    if (!createRes.ok) {
      console.error(`[maze] create zone ${zn}: ${createRes.error}`);
    }

    const name = quoteForRconArg(p.ingameName);
    const kitCmd = `kit givetoplayer "${quoteForRconArg(kit)}" "${name}"`;
    const kitRes = await runRconWithRetries(rustServerId, host, port, password, kitCmd, 3, 250, signal);
    if (!kitRes.ok) {
      console.error(`[maze] kit failed for ${p.ingameName}: ${kitRes.error}`);
    }

    const tpCmd = teleportPosRotCommand(xyz, p.ingameName);
    const tpRes = await runRconWithRetries(rustServerId, host, port, password, tpCmd, 3, 250, signal);
    if (!tpRes.ok) {
      console.error(`[maze] teleportposrot failed for ${p.ingameName}: ${tpRes.error}`);
    } else {
      console.log(`[maze] initial teleport ok: ${p.ingameName} → ${zn}`);
    }

    zoneNames.push(zn);
  }

  await sleepAbortable(MAZE_INITIAL_ZONE_HOLD_MS, signal);

  await Promise.all(
    zoneNames.map(async (zn) => {
      if (signal.aborted) throw new Error("Maze aborted");
      const delRes = await runWebRconCommand(rustServerId, host, port, password, buildDeleteMazeZoneCommand(zn));
      if (!delRes.ok) {
        console.error(`[maze] delete zone ${zn}: ${delRes.error}`);
      }
    })
  );
}

export type MazeRespawnOpts = {
  pool: Pool;
  guildRowId: number;
  rustServerId: number;
  host: string;
  port: number;
  password: string;
  /** Same kit as /maze-start — given again on every respawn teleport. */
  kitName: string;
  ingameName: string;
  spawnPointCount: number;
  /** Last maze-respawn slot used for this player; pick a different random slot when possible. */
  avoidSpawnSlot: number | null;
  signal: AbortSignal;
};

/** Random in 1..n, excluding `avoid` when n > 1 so players do not respawn to the same point twice in a row. */
export function pickMazeRespawnSpawnSlot(spawnPointCount: number, avoid: number | null): number {
  if (spawnPointCount < 1) return 1;
  if (spawnPointCount === 1) return 1;
  if (avoid == null || avoid < 1 || avoid > spawnPointCount) {
    return 1 + Math.floor(Math.random() * spawnPointCount);
  }
  const choices: number[] = [];
  for (let i = 1; i <= spawnPointCount; i++) {
    if (i !== avoid) choices.push(i);
  }
  return choices[Math.floor(Math.random() * choices.length)]!;
}

/** Random spawn slot, zone → kit → teleportposrot → 5s → delete zone (matches initial maze flow). */
export async function runMazeRespawnWithZone(opts: MazeRespawnOpts): Promise<number | null> {
  const {
    pool,
    guildRowId,
    rustServerId,
    host,
    port,
    password,
    kitName,
    ingameName,
    spawnPointCount,
    avoidSpawnSlot,
    signal,
  } = opts;
  if (spawnPointCount < 1) return null;

  const slot = pickMazeRespawnSpawnSlot(spawnPointCount, avoidSpawnSlot);
  const coordStr = await getMazeSpawnCoord(pool, guildRowId, rustServerId, slot);
  if (!coordStr) {
    console.warn(`[maze] respawn: no coord for spawn point ${slot}`);
    return null;
  }
  const xyz = parseGateCoordTriple(coordStr);
  if (!xyz) {
    console.warn(`[maze] respawn: bad coord for spawn ${slot}: ${coordStr}`);
    return null;
  }

  const zn = mazeSpawnZoneName(slot);
  if (signal.aborted) return null;

  const createRes = await runWebRconCommand(rustServerId, host, port, password, buildCreateMazeZoneCommand(zn, xyz));
  if (!createRes.ok) {
    console.error(`[maze] respawn create zone ${zn}: ${createRes.error}`);
  }

  const kit = kitName.trim();
  const nameQ = quoteForRconArg(ingameName.trim());
  const kitCmd = `kit givetoplayer "${quoteForRconArg(kit)}" "${nameQ}"`;
  const kitRes = await runRconWithRetries(rustServerId, host, port, password, kitCmd, 3, 250, signal);
  if (!kitRes.ok) {
    console.error(`[maze] respawn kit failed for ${ingameName}: ${kitRes.error}`);
  }

  const tpRes = await runRconWithRetries(
    rustServerId,
    host,
    port,
    password,
    teleportPosRotCommand(xyz, ingameName),
    3,
    250,
    signal
  );
  if (!tpRes.ok) {
    console.error(`[maze] respawn teleport failed for ${ingameName}: ${tpRes.error}`);
  } else {
    console.log(`[maze] respawn ok: ${ingameName} → ${zn} (kit + teleport)`);
  }

  await sleepAbortable(MAZE_RESPAWN_ZONE_HOLD_MS, signal);

  const delRes = await runWebRconCommand(rustServerId, host, port, password, buildDeleteMazeZoneCommand(zn));
  if (!delRes.ok) {
    console.error(`[maze] respawn delete zone ${zn}: ${delRes.error}`);
  }

  return slot;
}
