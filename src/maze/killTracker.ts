import type { Pool } from "mysql2/promise";
import { pool } from "../db/pool.js";
import {
  incrementMazeKill,
  insertMazeKillLog,
  listMazeEventRosterForKills,
  removeMazeEventMember,
  type MazeRosterKillRow,
} from "../db/maze.js";
import { lineMightBeRustKill, parseAnyKillLine, parseRustPlayerEnteredGame } from "../koth/killParse.js";
import { runMazeRespawnWithZone } from "./mazeZones.js";

/** Ignore "entered the game" for this long after a death line (ordering quirks; was 5000ms). */
const RESPAWN_ENTER_GAME_DELAY_MS = parseRespawnEnterDelayMs();
/**
 * If `has entered the game` appears slightly before `was killed by` on the wire, we buffer it briefly.
 * Must stay short: the maze join line also looks like "entered the game" and must not be used as respawn.
 */
const ENTER_REORDER_MAX_MS = 12_000;
/** Zentro-style: after a maze death, accept `has entered the game` within this window even if pending state was lost. */
const MAZE_DEATH_CLOCK_MS = 25_000;

/** Accepts 1, true, yes, on (trimmed, case-insensitive). Strict `=== "1"` was easy to miss in .env. */
function mazeRespawnDebug(): boolean {
  const v = process.env.MAZE_RESPAWN_DEBUG?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

if (mazeRespawnDebug()) {
  console.log(
    "[maze] MAZE_RESPAWN_DEBUG is on — you will see [maze respawn debug] lines for kill/respawn-looking console text (and when no maze is active, why lines are ignored)."
  );
}

/** MySQL / WebSocket paths may use number or numeric string; Map keys use Rust server id. */
function rustSid(id: number): number {
  return Number(id);
}

function parseRespawnEnterDelayMs(): number {
  const v = process.env.MAZE_RESPAWN_ENTER_IGNORE_MS?.trim();
  if (v === undefined || v === "") return 3500;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) && n >= 0 ? n : 3500;
}

/** Let the player entity finish spawning after the "has entered the game" line before `global.teleportposrot`. */
function parseRespawnTeleportDelayMs(): number {
  const v = process.env.MAZE_RESPAWN_TELEPORT_DELAY_MS?.trim();
  if (v === undefined || v === "") return 1500;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) && n >= 0 ? n : 1500;
}

async function sleepAbortable(ms: number, signal: AbortSignal): Promise<void> {
  if (ms <= 0) return;
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (signal.aborted) return;
    await new Promise<void>((r) => setTimeout(r, Math.min(250, end - Date.now())));
  }
}

function stripKillLogNoise(name: string): string {
  return name
    .replace(/^[\s}\]]+/, "")
    .replace(/\s*\(sleeping\)\s*$/i, "")
    .replace(/\s*\[sleeping\]\s*$/i, "")
    .replace(/\s*\(wounded\)\s*$/i, "")
    .replace(/[!?.]+$/g, "")
    .trim();
}

function normRustName(s: string): string {
  let x = stripKillLogNoise(s.replace(/\u200b/g, "").trim());
  try {
    x = x.normalize("NFKC");
  } catch {
    /* ignore */
  }
  for (let i = 0; i < 4; i++) {
    const t = x.replace(/\s*\[[^\]]+\]\s*$/, "").trim();
    if (t === x) break;
    x = t;
  }
  x = x.replace(/\s*\[[0-9]+\]\s*$/, "").trim();
  return x.toLowerCase();
}

function matchRosterConsole(consoleName: string, roster: MazeRosterKillRow[]): MazeRosterKillRow | null {
  const n = normRustName(consoleName);
  if (!n) return null;
  const exact = roster.filter((r) => normRustName(r.ingameName) === n);
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return null;
  const prefix = roster.filter((r) => {
    const ln = normRustName(r.ingameName);
    return ln.length >= 2 && n.startsWith(ln);
  });
  if (prefix.length === 1) return prefix[0];
  const rev = roster.filter((r) => {
    const ln = normRustName(r.ingameName);
    return n.length >= 2 && ln.startsWith(n);
  });
  if (rev.length === 1) return rev[0];
  const contains = roster.filter((r) => {
    const ln = normRustName(r.ingameName);
    return ln.length >= 3 && n.includes(ln);
  });
  if (contains.length === 1) return contains[0];
  return null;
}

/** `has entered the game` lines sometimes differ slightly from /link names — first-token match. */
function matchEnterGameToRoster(enterRaw: string, roster: MazeRosterKillRow[]): MazeRosterKillRow | null {
  const m = matchRosterConsole(enterRaw, roster);
  if (m) return m;
  const nt = normRustName(enterRaw).split(/\s+/)[0] ?? "";
  if (nt.length < 1) return null;
  const hits = roster.filter((r) => {
    const rt = normRustName(r.ingameName).split(/\s+/)[0] ?? "";
    return rt === nt || (nt.length >= 2 && rt.length >= 2 && (nt.startsWith(rt) || rt.startsWith(nt)));
  });
  if (hits.length === 1) return hits[0];
  return null;
}

const victimOptional = (): boolean => process.env.MAZE_VICTIM_STRICT !== "1";

type ServerCtx = {
  guildRowId: number;
  eventId: number;
  rustServerId: number;
  respawnEnabled: boolean;
  spawnPointCount: number;
  /** Same kit as /maze-start — re-given on each respawn teleport. */
  kitName: string;
  roster: MazeRosterKillRow[] | null;
  rcon: { host: string; port: number; password: string };
  abortSignal: AbortSignal;
};

class MazeKillTracker {
  private byServer = new Map<number, ServerCtx>();
  private flushByServer = new Map<number, Promise<void>>();
  /** Deduplicate kill lines that arrive multiple times from WebRCON / console fanout. */
  private recentKillKeysByServer = new Map<number, Map<string, number>>();
  private static readonly DEDUPE_WINDOW_MS = 2500;
  private static readonly DEDUPE_MAX_KEYS = 200;
  /** `${rustServerId}:${discordUserId}` → wait for `has entered the game` before maze respawn */
  private pendingRespawn = new Map<
    string,
    {
      victimRow: MazeRosterKillRow;
      ignoreEnterUntil: number;
      reminderInterval: ReturnType<typeof setInterval> | null;
    }
  >();
  private deferredRespawnTimers = new Map<string, ReturnType<typeof setTimeout>>();
  /** Enter-game line seen before kill line for this Discord user (server-scoped). */
  private enterGameBeforeKill = new Map<string, number>();
  /** `${rustServerId}:${discordUserId}` → time we recorded a maze death (respawn=yes) for death-clock fallback. */
  private lastMazeVictimDeathAt = new Map<string, number>();
  /** `${rustServerId}:${discordUserId}` → last maze-respawn spawn slot (1..N) so the next respawn picks a different random point when N > 1. */
  private lastRespawnSpawnByPlayer = new Map<string, number>();
  /** `${rustServerId}:${discordUserId}` → last time we issued a maze respawn teleport for this player (dedupe). */
  private lastRespawnTeleportAt = new Map<string, number>();
  private static readonly RESPAWN_TELEPORT_DEDUPE_MS = 12_000;

  register(
    rustServerId: number,
    ctx: {
      guildRowId: number;
      eventId: number;
      rustServerId: number;
      respawnEnabled: boolean;
      spawnPointCount: number;
      kitName: string;
      rcon: { host: string; port: number; password: string };
      abortSignal: AbortSignal;
    }
  ): void {
    const sid = rustSid(rustServerId);
    this.byServer.set(sid, { ...ctx, rustServerId: sid, roster: null });
    this.flushByServer.set(sid, Promise.resolve());
    this.recentKillKeysByServer.set(sid, new Map());
    if (mazeRespawnDebug()) {
      console.log(`[maze respawn debug] registered rustServerId=${sid} eventId=${ctx.eventId} — kill/enter lines will be processed`);
    }
  }

  async refreshRoster(db: Pool, rustServerId: number, guildRowId: number, eventId: number): Promise<void> {
    const sid = rustSid(rustServerId);
    const rows = await listMazeEventRosterForKills(db, guildRowId, eventId);
    const a = this.byServer.get(sid);
    if (a) a.roster = rows;
  }

  /**
   * After initial `/maze-start` teleports, join `has entered the game` lines must not satisfy later deaths.
   * Call when that phase is finished so only real respawn enters are buffered.
   */
  clearEnterGameBuffersForServer(rustServerId: number): void {
    const sid = rustSid(rustServerId);
    const prefix = `${sid}:`;
    let n = 0;
    for (const key of [...this.enterGameBeforeKill.keys()]) {
      if (key.startsWith(prefix)) {
        this.enterGameBeforeKill.delete(key);
        n++;
      }
    }
    console.log(
      `[maze] post-spawn: cleared ${n} buffered enter-game line(s) for rustServerId=${sid} — respawn teleport will wait for a fresh "has entered the game" after you die`
    );
  }

  private clearPendingForServer(rustServerId: number): void {
    const sid = rustSid(rustServerId);
    const prefix = `${sid}:`;
    for (const [key, pr] of this.pendingRespawn.entries()) {
      if (!key.startsWith(prefix)) continue;
      if (pr.reminderInterval) clearInterval(pr.reminderInterval);
      this.pendingRespawn.delete(key);
    }
    for (const [key, t] of this.deferredRespawnTimers.entries()) {
      if (!key.startsWith(prefix)) continue;
      clearTimeout(t);
      this.deferredRespawnTimers.delete(key);
    }
    for (const key of [...this.enterGameBeforeKill.keys()]) {
      if (key.startsWith(prefix)) this.enterGameBeforeKill.delete(key);
    }
    for (const key of [...this.lastMazeVictimDeathAt.keys()]) {
      if (key.startsWith(prefix)) this.lastMazeVictimDeathAt.delete(key);
    }
    for (const key of [...this.lastRespawnSpawnByPlayer.keys()]) {
      if (key.startsWith(prefix)) this.lastRespawnSpawnByPlayer.delete(key);
    }
    for (const key of [...this.lastRespawnTeleportAt.keys()]) {
      if (key.startsWith(prefix)) this.lastRespawnTeleportAt.delete(key);
    }
  }

  unregister(rustServerId: number): void {
    const sid = rustSid(rustServerId);
    this.clearPendingForServer(sid);
    this.byServer.delete(sid);
    this.flushByServer.delete(sid);
    this.recentKillKeysByServer.delete(sid);
  }

  async drain(rustServerId: number): Promise<void> {
    const sid = rustSid(rustServerId);
    const p = this.flushByServer.get(sid);
    if (p) {
      try {
        await p;
      } catch {
        /* logged in chain */
      }
    }
  }

  onConsoleLine(rustServerId: number, line: string): void {
    const sid = rustSid(rustServerId);
    const L = line.toLowerCase();
    const mightEnter = L.includes("entered the game");
    const mightKill = lineMightBeRustKill(line);
    const a = this.byServer.get(sid);

    if (mazeRespawnDebug() && (mightEnter || mightKill)) {
      if (!a) {
        console.log(
          `[maze respawn debug] rustServerId=${sid}: no active maze event (start one with /maze-start) — ${line.slice(0, 300)}`
        );
        return;
      }
      console.log(`[maze respawn debug] rustServerId=${sid}: ${line.slice(0, 300)}`);
    }

    if (!a) return;
    if (!mightEnter && !mightKill) return;

    const prev = this.flushByServer.get(sid) ?? Promise.resolve();
    const next = prev
      .then(() => this.processConsoleLine(sid, line))
      .catch((err) => console.error("[maze kills] flush chain:", err));
    this.flushByServer.set(sid, next);
  }

  /**
   * Process kills first so a death always queues pending before we handle the same tick’s
   * enter-game line. Then resolve enter-game (pending match, buffer, or deferred teleport).
   */
  private async processConsoleLine(rustServerId: number, line: string): Promise<void> {
    const L = line.toLowerCase();
    const mightEnter = L.includes("entered the game");
    const mightKill = lineMightBeRustKill(line);

    const parsed = mightKill ? parseAnyKillLine(line) : null;
    if (parsed) {
      await this.handleKill(rustServerId, parsed);
    }
    if (mightEnter) {
      await this.tryResolveEnteredGameRespawn(rustServerId, line);
    }
  }

  private async tryResolveEnteredGameRespawn(rustServerId: number, line: string): Promise<void> {
    const a = this.byServer.get(rustServerId);
    if (!a?.respawnEnabled) return;

    const enterRaw = parseRustPlayerEnteredGame(line);
    if (!enterRaw) return;

    const now = Date.now();
    const prefix = `${rustServerId}:`;

    for (const [key, pr] of this.pendingRespawn.entries()) {
      if (!key.startsWith(prefix)) continue;

      const match = matchEnterGameToRoster(enterRaw, [pr.victimRow]);
      if (!match) {
        if (mazeRespawnDebug()) {
          console.log(
            `[maze respawn] enter-game name mismatch: log="${enterRaw}" vs roster="${pr.victimRow.ingameName}" (norm: "${normRustName(enterRaw)}" vs "${normRustName(pr.victimRow.ingameName)}")`
          );
        }
        continue;
      }

      this.enterGameBeforeKill.delete(`${rustServerId}:${pr.victimRow.discordUserId}`);

      if (now < pr.ignoreEnterUntil) {
        const wait = pr.ignoreEnterUntil - now;
        const old = this.deferredRespawnTimers.get(key);
        if (old) clearTimeout(old);
        this.deferredRespawnTimers.set(
          key,
          setTimeout(() => {
            this.deferredRespawnTimers.delete(key);
            const prev = this.flushByServer.get(rustServerId) ?? Promise.resolve();
            const next = prev
              .then(() => this.finishRespawnAfterEnterGame(key))
              .catch((err) => console.error("[maze] deferred respawn:", err));
            this.flushByServer.set(rustServerId, next);
          }, wait)
        );
        if (mazeRespawnDebug()) console.log(`[maze respawn] deferred ${wait}ms for ${pr.victimRow.ingameName}`);
        return;
      }

      if (mazeRespawnDebug()) console.log(`[maze respawn] matched enter-game for ${pr.victimRow.ingameName}, teleporting`);
      await this.finishRespawnAfterEnterGame(key);
      return;
    }

    // Death-clock fallback (Zentro): kill was seen but pending was lost — still teleport if enter matches within window
    if (a.roster?.length) {
      const row = matchEnterGameToRoster(enterRaw, a.roster);
      if (row) {
        const dk = `${rustServerId}:${row.discordUserId}`;
        if (!this.pendingRespawn.has(dk)) {
          const deathAt = this.lastMazeVictimDeathAt.get(dk);
          if (deathAt != null && now - deathAt <= MAZE_DEATH_CLOCK_MS) {
            const lastTp = this.lastRespawnTeleportAt.get(dk);
            if (lastTp != null && now - lastTp < MazeKillTracker.RESPAWN_TELEPORT_DEDUPE_MS) {
              if (mazeRespawnDebug()) console.log(`[maze respawn] dedupe (death-clock) for ${row.ingameName}`);
              return;
            }
            this.lastMazeVictimDeathAt.delete(dk);
            this.enterGameBeforeKill.delete(dk);
            console.log(`[maze] respawn: death-clock fallback for ${row.ingameName} (${MAZE_DEATH_CLOCK_MS / 1000}s after kill)`);
            if (!(await this.delayBeforeRespawnRcon(a.abortSignal))) return;
            const dkTrack = `${rustServerId}:${row.discordUserId}`;
            const avoidSlot = this.lastRespawnSpawnByPlayer.get(dkTrack) ?? null;
            const usedSlot = await runMazeRespawnWithZone({
              pool,
              guildRowId: a.guildRowId,
              rustServerId: a.rustServerId,
              host: a.rcon.host,
              port: a.rcon.port,
              password: a.rcon.password,
              kitName: a.kitName,
              ingameName: row.ingameName,
              spawnPointCount: a.spawnPointCount,
              avoidSpawnSlot: avoidSlot,
              signal: a.abortSignal,
            });
            if (usedSlot != null) this.lastRespawnSpawnByPlayer.set(dkTrack, usedSlot);
            this.lastRespawnTeleportAt.set(dkTrack, Date.now());
            return;
          }
        }
      }
    }

    if (a.roster?.length) {
      const row = matchEnterGameToRoster(enterRaw, a.roster);
      if (row) {
        const ok = `${rustServerId}:${row.discordUserId}`;
        this.enterGameBeforeKill.set(ok, Date.now());
        if (mazeRespawnDebug()) {
          console.log(
            `[maze respawn] buffered enter-game (waiting for kill line) for ${row.ingameName} — if you die and nothing happens, check /link name matches console`
          );
        }
      }
    }
  }

  /** Shared by normal respawn + death-clock fallback so RCON runs after the client is in-world. */
  private async delayBeforeRespawnRcon(signal: AbortSignal): Promise<boolean> {
    const delayMs = parseRespawnTeleportDelayMs();
    if (delayMs <= 0) return true;
    console.log(
      `[maze] respawn: waiting ${delayMs}ms before RCON teleport (set MAZE_RESPAWN_TELEPORT_DELAY_MS=0 to skip) so the player is fully in-world`
    );
    await sleepAbortable(delayMs, signal);
    return !signal.aborted;
  }

  private async finishRespawnAfterEnterGame(key: string): Promise<void> {
    const pr = this.pendingRespawn.get(key);
    if (!pr) return;

    const rustServerId = Number(key.split(":")[0]);
    const a = this.byServer.get(rustServerId);
    if (!a?.respawnEnabled) return;

    const now = Date.now();
    const lastTp = this.lastRespawnTeleportAt.get(key);
    if (lastTp != null && now - lastTp < MazeKillTracker.RESPAWN_TELEPORT_DEDUPE_MS) {
      if (mazeRespawnDebug()) console.log(`[maze respawn] dedupe for ${pr.victimRow.ingameName}`);
      if (pr.reminderInterval) clearInterval(pr.reminderInterval);
      this.pendingRespawn.delete(key);
      this.lastMazeVictimDeathAt.delete(key);
      return;
    }

    if (pr.reminderInterval) clearInterval(pr.reminderInterval);
    this.pendingRespawn.delete(key);
    this.lastMazeVictimDeathAt.delete(key);

    // Mark immediately so duplicate/late console lines can't trigger multiple teleports for the same death window.
    const trackKey = `${a.rustServerId}:${pr.victimRow.discordUserId}`;
    this.lastRespawnTeleportAt.set(trackKey, now);

    if (!(await this.delayBeforeRespawnRcon(a.abortSignal))) return;

    console.log(
      `[maze] respawn: teleporting ${pr.victimRow.ingameName} to maze spawn (zone + kit + global.teleportposrot)`
    );

    const avoidSlot = this.lastRespawnSpawnByPlayer.get(trackKey) ?? null;
    const usedSlot = await runMazeRespawnWithZone({
      pool,
      guildRowId: a.guildRowId,
      rustServerId: a.rustServerId,
      host: a.rcon.host,
      port: a.rcon.port,
      password: a.rcon.password,
      kitName: a.kitName,
      ingameName: pr.victimRow.ingameName,
      spawnPointCount: a.spawnPointCount,
      avoidSpawnSlot: avoidSlot,
      signal: a.abortSignal,
    });
    if (usedSlot != null) this.lastRespawnSpawnByPlayer.set(trackKey, usedSlot);
  }

  private async queuePendingRespawn(rustServerId: number, victimRow: MazeRosterKillRow): Promise<void> {
    const key = `${rustServerId}:${victimRow.discordUserId}`;
    const existing = this.pendingRespawn.get(key);
    if (existing?.reminderInterval) clearInterval(existing.reminderInterval);
    const def = this.deferredRespawnTimers.get(key);
    if (def) {
      clearTimeout(def);
      this.deferredRespawnTimers.delete(key);
    }

    const ignoreEnterUntil = Date.now() + RESPAWN_ENTER_GAME_DELAY_MS;
    const reminderInterval = setInterval(() => {
      const pr = this.pendingRespawn.get(key);
      if (!pr) {
        clearInterval(reminderInterval);
        return;
      }
      console.log(
        `[maze] respawn: still waiting for "${victimRow.ingameName}" — click **Respawn**, then wait for the console line "has entered the game"`
      );
    }, RESPAWN_ENTER_GAME_DELAY_MS);

    this.pendingRespawn.set(key, {
      victimRow,
      ignoreEnterUntil,
      reminderInterval,
    });
    this.lastMazeVictimDeathAt.set(key, Date.now());

    console.log(
      `[maze] respawn: death recorded for "${victimRow.ingameName}" — waiting for "has entered the game" after you click Respawn (or a very recent buffered line ≤${ENTER_REORDER_MAX_MS / 1000}s for log reorder)`
    );

    const ok = `${rustServerId}:${victimRow.discordUserId}`;
    const enterAt = this.enterGameBeforeKill.get(ok);
    if (enterAt != null && Date.now() - enterAt <= ENTER_REORDER_MAX_MS) {
      this.enterGameBeforeKill.delete(ok);
      console.log(
        `[maze] respawn: using buffered enter-game line (it arrived before the kill line) for "${victimRow.ingameName}"`
      );
      await this.finishRespawnAfterEnterGame(key);
    }
  }

  private async handleKill(rustServerId: number, parsed: { victim: string; killer: string }): Promise<void> {
    try {
      let a = this.byServer.get(rustServerId);
      if (!a) return;

      if (!a.roster?.length) {
        await this.refreshRoster(pool, rustServerId, a.guildRowId, a.eventId);
        a = this.byServer.get(rustServerId);
        if (!a?.roster?.length) return;
      }

      const roster = a.roster;
      const killerName = stripKillLogNoise(parsed.killer.replace(/\u200b/g, "").trim());
      const victimName = stripKillLogNoise(parsed.victim.replace(/\u200b/g, "").trim());

      const killerRow = matchRosterConsole(killerName, roster);
      const victimRow = matchRosterConsole(victimName, roster);

      if (mazeRespawnDebug()) {
        console.log(
          `[maze respawn] kill line: victim="${victimName}" killer="${killerName}" → victimRow=${victimRow ? victimRow.ingameName : "null"} killerRow=${killerRow ? killerRow.ingameName : "null"}`
        );
      }

      if (!killerRow && !victimRow) return;

      if (killerRow) {
        if (!victimRow && !victimOptional()) return;
        const isTeamKill = victimRow != null && victimRow.clanId === killerRow.clanId;

        // WebRCON / console fanout can emit the same kill more than once; dedupe by killer/victim + event.
        const dedupeVictim = victimRow?.discordUserId ?? victimName;
        const dedupeKey = `${a.eventId}:${killerRow.discordUserId}:${String(dedupeVictim)}`;
        const now = Date.now();
        const recent = this.recentKillKeysByServer.get(rustServerId);
        if (recent) {
          const last = recent.get(dedupeKey);
          if (last != null && now - last < MazeKillTracker.DEDUPE_WINDOW_MS) {
            if (mazeRespawnDebug()) console.log(`[maze kills] deduped duplicate kill line key=${dedupeKey}`);
            return;
          }
          recent.set(dedupeKey, now);
          if (recent.size > MazeKillTracker.DEDUPE_MAX_KEYS) {
            const entries = [...recent.entries()].sort((x, y) => x[1] - y[1]);
            for (let i = 0; i < Math.ceil(MazeKillTracker.DEDUPE_MAX_KEYS * 0.25); i++) {
              const k = entries[i]?.[0];
              if (k) recent.delete(k);
            }
          }
        }

        if (!isTeamKill) {
          await incrementMazeKill(pool, a.eventId, killerRow.clanId, killerRow.discordUserId);
          try {
            await insertMazeKillLog(
              pool,
              a.guildRowId,
              a.eventId,
              killerRow.discordUserId,
              victimRow?.discordUserId ?? null,
              killerRow.ingameName,
              victimRow?.ingameName ?? victimName
            );
          } catch (e) {
            console.error("[maze kills] kill log insert failed:", e);
          }
        }
      }

      if (victimRow) {
        if (!a.respawnEnabled) {
          this.lastMazeVictimDeathAt.delete(`${rustServerId}:${victimRow.discordUserId}`);
          await removeMazeEventMember(pool, a.eventId, victimRow.discordUserId);
          await this.refreshRoster(pool, rustServerId, a.guildRowId, a.eventId);
        } else {
          await this.queuePendingRespawn(rustServerId, victimRow);
        }
      }
    } catch (err) {
      console.error("[maze kills] failed:", err);
    }
  }
}

export const mazeKillTracker = new MazeKillTracker();
