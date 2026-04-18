import { parseRustPlayerEnteredGame } from "../koth/killParse.js";

/** MySQL / callers may pass numeric string; Map keys must match emoteKitBridge `row.id`. */
function rustSid(id: number): number {
  return Number(id);
}

function stripNoise(name: string): string {
  return name
    .replace(/\u200b/g, "")
    .replace(/\s*\(sleeping\)\s*$/i, "")
    .replace(/\s*\[sleeping\]\s*$/i, "")
    .trim();
}

function norm(s: string): string {
  let x = stripNoise(s);
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

function matchesLinkedName(consoleFragment: string, linkedName: string): boolean {
  const n = norm(consoleFragment);
  const ln = norm(linkedName);
  if (!n || !ln) return false;
  if (n === ln) return true;
  if (ln.length >= 2 && n.startsWith(ln)) return true;
  if (n.length >= 2 && ln.startsWith(n)) return true;
  if (ln.length >= 3 && n.includes(ln)) return true;
  /** `has entered the game` names sometimes differ slightly from /link — first-token match (see maze killTracker). */
  const nt = n.split(/\s+/)[0] ?? "";
  const lt = ln.split(/\s+/)[0] ?? "";
  if (nt.length >= 1 && lt.length >= 1) {
    if (nt === lt) return true;
    if (nt.length >= 2 && lt.length >= 2 && (nt.startsWith(lt) || lt.startsWith(nt))) return true;
  }
  return false;
}

type WaitState = {
  linkedNames: [string, string];
  /** When set, only this player's `has entered the game` completes the wait (between-round loser-only flow). */
  singleTarget: string | null;
  seen: Set<string>;
  resolveOuter: () => void;
  rejectOuter: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

const byServer = new Map<number, WaitState>();

export const onev1RespawnWait = {
  /**
   * Subscribe synchronously; call **before** `killplayer` and await the returned promise **after** kills.
   * If you await kills first then call this, fast `has entered the game` lines can be missed.
   */
  waitForBothRespawns(rustServerId: number, linkedNames: [string, string], timeoutMs: number): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const sid = rustSid(rustServerId);
      if (byServer.has(sid)) {
        reject(new Error("Respawn wait already active for this server"));
        return;
      }
      const seen = new Set<string>();
      const timer = setTimeout(() => {
        byServer.delete(sid);
        reject(new Error(`Respawn wait timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      const st: WaitState = {
        linkedNames,
        singleTarget: null,
        seen,
        resolveOuter: () => {
          clearTimeout(timer);
          byServer.delete(sid);
          resolve();
        },
        rejectOuter: (e: Error) => {
          clearTimeout(timer);
          byServer.delete(sid);
          reject(e);
        },
        timer,
      };
      byServer.set(sid, st);
    });
  },

  /**
   * Wait for one linked player's `has entered the game`. Subscribe **before** any delay or `killplayer`
   * (if used), then await — same ordering rule as {@link waitForBothRespawns}.
   */
  waitForOneRespawn(rustServerId: number, targetIngameName: string, timeoutMs: number): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const sid = rustSid(rustServerId);
      if (byServer.has(sid)) {
        reject(new Error("Respawn wait already active for this server"));
        return;
      }
      const timer = setTimeout(() => {
        byServer.delete(sid);
        reject(new Error(`Respawn wait timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      const linkedNames: [string, string] = [targetIngameName, targetIngameName];
      const st: WaitState = {
        linkedNames,
        singleTarget: targetIngameName,
        seen: new Set<string>(),
        resolveOuter: () => {
          clearTimeout(timer);
          byServer.delete(sid);
          resolve();
        },
        rejectOuter: (e: Error) => {
          clearTimeout(timer);
          byServer.delete(sid);
          reject(e);
        },
        timer,
      };
      byServer.set(sid, st);
    });
  },

  onConsoleLine(rustServerId: number, line: string): void {
    const sid = rustSid(rustServerId);
    const st = byServer.get(sid);
    if (!st) return;
    const frag = parseRustPlayerEnteredGame(line);
    if (!frag) return;

    if (st.singleTarget) {
      if (matchesLinkedName(frag, st.singleTarget)) {
        st.resolveOuter();
      } else if (process.env.DEBUG_1V1 === "1") {
        console.log(
          `[1v1 respawn] enter-game parsed="${frag}" vs singleTarget=${JSON.stringify(st.singleTarget)} (no match)`
        );
      }
      return;
    }

    let matchedSomeone = false;
    for (const target of st.linkedNames) {
      if (matchesLinkedName(frag, target)) {
        st.seen.add(norm(target));
        matchedSomeone = true;
      }
    }
    if (process.env.DEBUG_1V1 === "1" && !matchedSomeone) {
      console.log(`[1v1 respawn] enter-game parsed="${frag}" vs linked=${JSON.stringify(st.linkedNames)} (no match)`);
    }
    const [a, b] = st.linkedNames;
    if (st.seen.has(norm(a)) && st.seen.has(norm(b))) {
      st.resolveOuter();
    }
  },

  /**
   * Stops the wait and **rejects** the pending promise so it cannot hang forever.
   * Callers that fire `cancel` without awaiting should attach `.catch(() => {})` if needed.
   */
  cancel(rustServerId: number): void {
    const sid = rustSid(rustServerId);
    const st = byServer.get(sid);
    if (st) {
      clearTimeout(st.timer);
      byServer.delete(sid);
      st.rejectOuter(new Error("Respawn wait cancelled"));
    }
  },
};
