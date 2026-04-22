import type { Pool } from "mysql2/promise";
import { pool } from "../db/pool.js";
import {
  incrementKothKill,
  insertKothKillLog,
  listKothEventRosterForKills,
  type KothRosterKillRow,
} from "../db/koth.js";
import { parseAnyKillLine } from "./killParse.js";

type Active = {
  guildRowId: number;
  eventId: number;
  wave: number;
  /** Loaded when the event starts — console names are matched only against these participants. */
  roster: KothRosterKillRow[] | null;
  /** Per clan, normalized ingame names still alive this wave (PvP deaths only). */
  aliveByClanId: Map<number, Set<string>>;
  /** At least two distinct clans — only then can we end the wave early when one clan remains. */
  multiClanWave: boolean;
  resolveLastClan: (() => void) | null;
  lastClanPromise: Promise<void> | null;
};

/** Rust sometimes appends state suffixes not stripped by killParse. */
function stripKillLogNoise(name: string): string {
  return name
    .replace(/\s*\(sleeping\)\s*$/i, "")
    .replace(/\s*\[sleeping\]\s*$/i, "")
    .replace(/\s*\(wounded\)\s*$/i, "")
    .trim();
}

/** Same normalization idea as link lookup: tags, then CI / prefix vs linked ingame name. */
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

/**
 * Default: only the killer must match the event roster (victims can be non-participants or fail name match).
 * Set `KOTH_VICTIM_STRICT=1` to require both killer and victim to match roster (fair PvP-only scoring).
 */
const victimOptionalForKoth = (): boolean => process.env.KOTH_VICTIM_STRICT !== "1";

const earlyWaveDisabled = (): boolean => process.env.KOTH_DISABLE_EARLY_WAVE === "1";

/**
 * Match console log name → roster row. Tries exact CI, prefix, reverse prefix, then unique substring.
 */
function matchRosterConsole(consoleName: string, roster: KothRosterKillRow[]): KothRosterKillRow | null {
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

class KothKillTracker {
  private byServer = new Map<number, Active>();
  /** Serialize async kill handling per server so wave summaries don't read DB before writes land. */
  private flushByServer = new Map<number, Promise<void>>();

  register(rustServerId: number, ctx: Omit<Active, "roster" | "aliveByClanId" | "multiClanWave" | "resolveLastClan" | "lastClanPromise">): void {
    this.byServer.set(rustServerId, {
      ...ctx,
      roster: null,
      aliveByClanId: new Map(),
      multiClanWave: false,
      resolveLastClan: null,
      lastClanPromise: null,
    });
    this.flushByServer.set(rustServerId, Promise.resolve());
  }

  /** Call right after register (and after each wave if roster can change). */
  async refreshRoster(
    db: Pool,
    rustServerId: number,
    guildRowId: number,
    eventId: number
  ): Promise<void> {
    const rows = await listKothEventRosterForKills(db, guildRowId, eventId);
    const a = this.byServer.get(rustServerId);
    if (a) {
      a.roster = rows;
      this.resetWaveAliveFromRoster(a, rows);
    }
  }

  /** Resolves when ≤1 clan still has living members (or everyone dead). Only used when ≥2 clans in the wave. */
  waitForLastClanStanding(rustServerId: number): Promise<void> | null {
    const a = this.byServer.get(rustServerId);
    return a?.lastClanPromise ?? null;
  }

  private resetWaveAliveFromRoster(a: Active, roster: KothRosterKillRow[]): void {
    a.resolveLastClan = null;
    a.lastClanPromise = null;
    a.aliveByClanId = new Map();
    if (earlyWaveDisabled() || roster.length === 0) {
      a.multiClanWave = false;
      return;
    }
    const distinctClans = new Set(roster.map((r) => r.clanId));
    a.multiClanWave = distinctClans.size >= 2;
    for (const r of roster) {
      const set = a.aliveByClanId.get(r.clanId) ?? new Set<string>();
      set.add(normRustName(r.ingameName));
      a.aliveByClanId.set(r.clanId, set);
    }
    if (a.multiClanWave) {
      a.lastClanPromise = new Promise<void>((resolve) => {
        a.resolveLastClan = resolve;
      });
    }
  }

  private tryResolveWaveEarly(a: Active): void {
    if (!a.multiClanWave || !a.resolveLastClan) return;
    let clansWithSurvivors = 0;
    for (const s of a.aliveByClanId.values()) {
      if (s.size > 0) clansWithSurvivors++;
    }
    if (clansWithSurvivors <= 1) {
      const fn = a.resolveLastClan;
      a.resolveLastClan = null;
      fn();
      if (process.env.DEBUG_KOTH === "1") {
        console.log(
          `[koth kills] early wave end: ${clansWithSurvivors === 0 ? "no survivors" : "one clan left"} (event ${a.eventId} wave ${a.wave})`
        );
      }
    }
  }

  setWave(rustServerId: number, wave: number): void {
    const a = this.byServer.get(rustServerId);
    if (a) a.wave = wave;
  }

  unregister(rustServerId: number): void {
    this.byServer.delete(rustServerId);
    this.flushByServer.delete(rustServerId);
  }

  /** Await before posting wave summary so all pending kill increments are committed. */
  async drain(rustServerId: number): Promise<void> {
    const p = this.flushByServer.get(rustServerId);
    if (p) {
      try {
        await p;
      } catch {
        /* individual handleKill already logs */
      }
    }
  }

  onConsoleLine(rustServerId: number, line: string): void {
    const a = this.byServer.get(rustServerId);
    if (!a) return;
    const parsed = parseAnyKillLine(line);
    if (!parsed) return;

    const prev = this.flushByServer.get(rustServerId) ?? Promise.resolve();
    const next = prev
      .then(() => this.handleKill(rustServerId, parsed))
      .catch((err) => console.error("[koth kills] flush chain:", err));
    this.flushByServer.set(rustServerId, next);
  }

  private async handleKill(
    rustServerId: number,
    parsed: { victim: string; killer: string }
  ): Promise<void> {
    try {
      let a = this.byServer.get(rustServerId);
      if (!a) return;

      if (!a.roster?.length) {
        await this.refreshRoster(pool, rustServerId, a.guildRowId, a.eventId);
        a = this.byServer.get(rustServerId);
        if (!a?.roster?.length) {
          console.warn("[koth kills] roster empty — no /koth-join participants with /link?");
          return;
        }
      }

      const roster = a.roster;
      const killerName = stripKillLogNoise(parsed.killer.replace(/\u200b/g, "").trim());
      const victimName = stripKillLogNoise(parsed.victim.replace(/\u200b/g, "").trim());

      const killerRow = matchRosterConsole(killerName, roster);
      if (!killerRow) {
        console.warn(
          `[koth kills] killer "${killerName}" did not match any KOTH participant (check /link vs console name)`
        );
        return;
      }

      const victimRow = matchRosterConsole(victimName, roster);
      if (!victimRow) {
        if (!victimOptionalForKoth()) {
          console.warn(
            `[koth kills] victim "${victimName}" did not match any KOTH participant — ensure /koth-join, or unset KOTH_VICTIM_STRICT to only require the killer on the roster`
          );
          return;
        }
      }

      const isTeamKill = victimRow != null && victimRow.clanId === killerRow.clanId;
      if (!isTeamKill) {
        await incrementKothKill(pool, a.eventId, a.wave, killerRow.clanId, killerRow.discordUserId);
        try {
          await insertKothKillLog(
            pool,
            a.guildRowId,
            a.eventId,
            a.wave,
            killerRow.discordUserId,
            victimRow?.discordUserId ?? null,
            killerRow.ingameName,
            victimRow?.ingameName ?? victimName
          );
        } catch (logErr) {
          console.error("[koth kills] failed to save kill log row:", logErr);
        }
      }

      if (victimRow) {
        const set = a.aliveByClanId.get(victimRow.clanId);
        if (set) {
          set.delete(normRustName(victimRow.ingameName));
        }
        this.tryResolveWaveEarly(a);
      }

      if (process.env.DEBUG_KOTH === "1") {
        const vLabel = victimRow?.ingameName ?? victimName;
        console.log(
          `[koth kills] ${isTeamKill ? "teamkill (ignored)" : "+1"} killer=${killerRow.ingameName} victim=${vLabel} wave ${a.wave} event ${a.eventId}`
        );
      }
    } catch (err) {
      console.error("[koth kills] increment failed:", err);
    }
  }
}

export const kothKillTracker = new KothKillTracker();
