import type { Pool } from "mysql2/promise";
import { pool } from "../db/pool.js";
import { parseAnyKillLine } from "../koth/killParse.js";

type RosterRow = { ingameName: string; clanId: number; slot: number };

function stripKillLogNoise(name: string): string {
  return name
    .replace(/\u200b/g, "")
    .replace(/^[\s}\]]+/, "")
    .replace(/\s*\(sleeping\)\s*$/i, "")
    .replace(/\s*\[sleeping\]\s*$/i, "")
    .replace(/\s*\(wounded\)\s*$/i, "")
    .replace(/[!?.]+$/g, "")
    .trim();
}

function normRustName(s: string): string {
  let x = stripKillLogNoise(s.trim());
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

function matchRosterConsole(consoleName: string, roster: RosterRow[]): RosterRow | null {
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

type Active = {
  guildRowId: number;
  rustServerId: number;
  abortSignal: AbortSignal;
  roster: RosterRow[] | null;
  aliveBySlot: Map<number, Set<string>>; // normalized ingameName
  resolveWipe: ((winnerSlot: number) => void) | null;
  wipePromise: Promise<number> | null;
};

export class NuketownKillTracker {
  private byServer = new Map<number, Active>();
  private flushByServer = new Map<number, Promise<void>>();

  register(
    rustServerId: number,
    ctx: { guildRowId: number; rustServerId: number; abortSignal: AbortSignal }
  ): void {
    this.byServer.set(rustServerId, {
      ...ctx,
      roster: null,
      aliveBySlot: new Map(),
      resolveWipe: null,
      wipePromise: null,
    });
    this.flushByServer.set(rustServerId, Promise.resolve());
  }

  unregister(rustServerId: number): void {
    this.byServer.delete(rustServerId);
    this.flushByServer.delete(rustServerId);
  }

  async setRoundRoster(
    db: Pool,
    rustServerId: number,
    roster: RosterRow[]
  ): Promise<void> {
    const a = this.byServer.get(rustServerId);
    if (!a) return;
    a.roster = roster;
    a.aliveBySlot = new Map();
    for (const r of roster) {
      const slot = Number(r.slot);
      const set = a.aliveBySlot.get(slot) ?? new Set<string>();
      set.add(normRustName(r.ingameName));
      a.aliveBySlot.set(slot, set);
    }
    a.wipePromise = new Promise<number>((resolve) => {
      a.resolveWipe = resolve;
    });
  }

  async waitForTeamWipe(rustServerId: number): Promise<number> {
    const a = this.byServer.get(rustServerId);
    if (!a?.wipePromise) throw new Error("NuketownKillTracker not ready for this round");
    return await a.wipePromise;
  }

  /** Call after a round is decided (before RCON kills) so admin/suicide lines cannot confuse the next round. */
  clearAfterRound(rustServerId: number): void {
    const a = this.byServer.get(rustServerId);
    if (!a) return;
    a.roster = null;
    a.aliveBySlot = new Map();
    a.resolveWipe = null;
    a.wipePromise = null;
  }

  onConsoleLine(rustServerId: number, line: string): void {
    const a = this.byServer.get(rustServerId);
    if (!a || a.abortSignal.aborted) return;
    const parsed = parseAnyKillLine(line);
    if (!parsed) return;
    const prev = this.flushByServer.get(rustServerId) ?? Promise.resolve();
    const next = prev
      .then(() => this.handleKill(rustServerId, parsed.victim))
      .catch((err) => console.error("[nuketown kills] flush chain:", err));
    this.flushByServer.set(rustServerId, next);
  }

  private async handleKill(rustServerId: number, victimRaw: string): Promise<void> {
    const a = this.byServer.get(rustServerId);
    if (!a || a.abortSignal.aborted) return;
    if (!a.roster?.length) return;

    const victimName = stripKillLogNoise(victimRaw);
    const victimRow = matchRosterConsole(victimName, a.roster);
    if (!victimRow) return;

    const slot = Number(victimRow.slot);
    const set = a.aliveBySlot.get(slot);
    if (!set) return;
    const vn = normRustName(victimRow.ingameName);
    if (!set.has(vn)) return; // already dead
    set.delete(vn);

    // If one slot is wiped, the other slot (among the two in this round) is winner.
    if (set.size === 0 && a.resolveWipe) {
      const slots = [...a.aliveBySlot.keys()];
      const other = slots.find((s) => s !== slot);
      if (other != null) {
        const resolve = a.resolveWipe;
        a.resolveWipe = null;
        resolve(other);
      }
    }
  }
}

export const nuketownKillTracker = new NuketownKillTracker();

