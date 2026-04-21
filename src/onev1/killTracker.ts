import { parseAnyKillLine } from "../koth/killParse.js";

/** MySQL / callers may pass numeric string; Map keys use Rust server id. */
function rustSid(id: number): number {
  return Number(id);
}

type Side = "a" | "b";

type Roster = { side: Side; ingameName: string };

function stripNoise(name: string): string {
  return name
    .replace(/\u200b/g, "")
    .replace(/\s*\(sleeping\)\s*$/i, "")
    .replace(/\s*\[sleeping\]\s*$/i, "")
    .trim();
}

function normRustName(s: string): string {
  let x = stripNoise(s.trim());
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

/** After we arm a round, drop RCON kill lines that are still echoing from admin kills / respawn. */
function parseArmKillIgnoreMs(): number {
  const v = process.env.ONEV1_ARM_KILL_IGNORE_MS?.trim();
  if (v === undefined || v === "") return 8000;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) && n >= 0 ? n : 8000;
}

function matchRoster(consoleName: string, roster: Roster[]): Roster | null {
  const n = normRustName(consoleName);
  if (!n) return null;
  const exact = roster.filter((r) => normRustName(r.ingameName) === n);
  if (exact.length === 1) return exact[0]!;
  if (exact.length > 1) return null;
  const prefix = roster.filter((r) => {
    const ln = normRustName(r.ingameName);
    return ln.length >= 2 && n.startsWith(ln);
  });
  if (prefix.length === 1) return prefix[0]!;
  const rev = roster.filter((r) => {
    const ln = normRustName(r.ingameName);
    return n.length >= 2 && ln.startsWith(n);
  });
  if (rev.length === 1) return rev[0]!;
  return null;
}

type Active = {
  roster: Roster[];
  alive: Map<Side, Set<string>>;
  resolveRound: ((winner: Side) => void) | null;
  roundPromise: Promise<Side> | null;
  /** Ignore console kills until this time (stale lines from between-round `killplayer` after the next round arms). */
  ignoreKillsUntil: number;
};

export class OneV1KillTracker {
  private byServer = new Map<number, Active>();
  private flushByServer = new Map<number, Promise<void>>();

  register(rustServerId: number): void {
    const sid = rustSid(rustServerId);
    this.byServer.set(sid, {
      roster: [],
      alive: new Map(),
      resolveRound: null,
      roundPromise: null,
      ignoreKillsUntil: 0,
    });
    this.flushByServer.set(sid, Promise.resolve());
  }

  unregister(rustServerId: number): void {
    const sid = rustSid(rustServerId);
    this.byServer.delete(sid);
    this.flushByServer.delete(sid);
  }

  /** Unblock {@link waitForRoundWinner} (e.g. admin force-stop). Arbitrary winner; caller must abort the match run immediately after. */
  releasePendingRound(rustServerId: number): void {
    const sid = rustSid(rustServerId);
    const a = this.byServer.get(sid);
    if (!a?.resolveRound) return;
    const fn = a.resolveRound;
    a.resolveRound = null;
    fn("a");
  }

  setRoundRoster(rustServerId: number, challengerName: string, opponentName: string): void {
    const sid = rustSid(rustServerId);
    const a = this.byServer.get(sid);
    if (!a) return;
    const roster: Roster[] = [
      { side: "a", ingameName: challengerName },
      { side: "b", ingameName: opponentName },
    ];
    a.roster = roster;
    a.alive = new Map([
      ["a", new Set([normRustName(challengerName)])],
      ["b", new Set([normRustName(opponentName)])],
    ]);
    a.roundPromise = new Promise<Side>((resolve) => {
      a.resolveRound = resolve;
    });
    a.ignoreKillsUntil = Date.now() + parseArmKillIgnoreMs();
  }

  clearAfterRound(rustServerId: number): void {
    const sid = rustSid(rustServerId);
    const x = this.byServer.get(sid);
    if (!x) return;
    x.roster = [];
    x.alive = new Map();
    x.resolveRound = null;
    x.roundPromise = null;
    x.ignoreKillsUntil = 0;
  }

  async waitForRoundWinner(rustServerId: number): Promise<Side> {
    const sid = rustSid(rustServerId);
    const a = this.byServer.get(sid);
    if (!a?.roundPromise) throw new Error("1v1 kill tracker not ready");
    return await a.roundPromise;
  }

  onConsoleLine(rustServerId: number, line: string): void {
    const sid = rustSid(rustServerId);
    const a = this.byServer.get(sid);
    if (!a?.roster.length) return;
    const parsed = parseAnyKillLine(line);
    if (!parsed) return;
    const prev = this.flushByServer.get(sid) ?? Promise.resolve();
    const next = prev
      .then(() => this.handleKill(sid, parsed.victim))
      .catch((err) => console.error("[1v1 kills] flush:", err));
    this.flushByServer.set(sid, next);
  }

  private async handleKill(rustServerId: number, victimRaw: string): Promise<void> {
    const a = this.byServer.get(rustServerId);
    if (!a?.roster.length || !a.resolveRound) return;
    if (Date.now() < a.ignoreKillsUntil) return;

    const victimRow = matchRoster(victimRaw, a.roster);
    if (!victimRow) return;

    const side = victimRow.side;
    const set = a.alive.get(side);
    if (!set) return;
    const vn = normRustName(victimRow.ingameName);
    if (!set.has(vn)) return;
    set.delete(vn);

    if (set.size === 0) {
      const winner: Side = side === "a" ? "b" : "a";
      const resolve = a.resolveRound;
      a.resolveRound = null;
      if (resolve) resolve(winner);
    }
  }

  async drain(rustServerId: number): Promise<void> {
    const sid = rustSid(rustServerId);
    const p = this.flushByServer.get(sid);
    if (p) {
      try {
        await p;
      } catch {
        /* logged */
      }
    }
  }
}

export const onev1KillTracker = new OneV1KillTracker();
