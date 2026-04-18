/** WebRCON often glues JSON/braces to the next log line (`}Player`, `"True"player` from convar echoes). */
function stripWebRconConsoleJunk(name: string): string {
  let s = name.trim();
  s = s.replace(/^[\s}\]]+/, "");
  s = s.replace(/^["']*(?:True|False)?["']*/i, "");
  s = s.replace(/^[^\p{L}\p{N}[\]_-]+/u, "");
  s = s.replace(/[^\p{L}\p{N}[\]_\s-]+$/u, "");
  return s.trim();
}

function stripSteamSuffix(name: string): string {
  return name.replace(/\s*\[[0-9]+\]\s*$/, "").trim();
}

/** Trailing `[steam]` / `[clan]` segments (Rust often prints `name [TAG]`). */
function stripRustSuffixes(name: string): string {
  let s = name.trim();
  for (let i = 0; i < 4; i++) {
    const t = s.replace(/\s*\[[^\]]+\]\s*$/, "").trim();
    if (t === s) break;
    s = t;
  }
  return s;
}

/** Rust console sometimes concatenates unrelated lines with \\0; reject fake “names” from that. */
/** Matches `rust_player_kd.ingame_name` VARCHAR(128); keep parser stricter than nonsense blobs. */
const MAX_PLAYER_NAME_LEN = 128;

function isPlausibleRustPlayerName(s: string): boolean {
  const t = s.trim();
  if (t.length < 1 || t.length > MAX_PLAYER_NAME_LEN) return false;
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(t)) return false;
  if (/\[ SAVE \]/i.test(t)) return false;
  return true;
}

function finalizeKillPair(victim: string, killer: string): { victim: string; killer: string } | null {
  const v = stripRustSuffixes(stripWebRconConsoleJunk(victim));
  const k = stripRustSuffixes(stripWebRconConsoleJunk(killer));
  if (!v || !k || v.toLowerCase() === k.toLowerCase()) return null;
  if (!isPlausibleRustPlayerName(v) || !isPlausibleRustPlayerName(k)) return null;
  return { victim: v, killer: k };
}

/** Last resort: split on the last `was killed by` (handles odd timestamps / extra colons). */
function trySplitKill(normalized: string): { victim: string; killer: string } | null {
  const lower = normalized.toLowerCase();
  const needle = "was killed by";
  const idx = lower.lastIndexOf(needle);
  if (idx < 0) return null;
  let after = normalized.slice(idx + needle.length).trim();
  after = after.split(/\s+with\s+/i)[0].split(/\s*\(/)[0].trim();
  const killerToken = after.split(/\s+/)[0] ?? "";
  const killer = stripSteamSuffix(killerToken);
  if (!killer) return null;

  let before = normalized.slice(0, idx).trim();
  const lm = before.match(/LOG:\s*(.+)$/i);
  if (lm) before = lm[1].trim();
  else {
    const colonParts = before.split(":");
    before = (colonParts[colonParts.length - 1] ?? before).trim();
  }
  const victim = stripSteamSuffix(before);
  const pair = finalizeKillPair(victim, killer);
  return pair;
}

/**
 * Reliable passive kill parse for formats like:
 * `04/12/2026 16:51:26:LOG: nzcve7130 was killed by LORD-INCENDIARY`
 * (victim may have no `[CLAN]` tag even when /link does — roster matching still works.)
 */
function parseWasKilledBySplit(normalized: string): { victim: string; killer: string } | null {
  const m = normalized.match(/\bwas\s+killed\s+by\s+/i);
  if (!m || m.index === undefined) return null;
  const afterPhrase = normalized.slice(m.index + m[0].length).trim();
  const killerToken = afterPhrase.split(/\s+/)[0] ?? "";
  const killer = stripSteamSuffix(killerToken);
  let before = normalized.slice(0, m.index).trim();
  const logMatch = before.match(/LOG:\s*(.+)$/i);
  const victimPart = logMatch
    ? logMatch[1].trim()
    : (before.split(":").pop() ?? before).trim();
  const victim = stripSteamSuffix(victimPart);
  return finalizeKillPair(victim, killer);
}

/**
 * Parse Rust console lines that contain PvP kills.
 * Examples:
 *   04/09/2026 19:47:10:LOG: Vuhluu was killed by nzcve7130
 *   04/12/2026 16:51:26:LOG: nzcve7130 was killed by LORD-INCENDIARY
 */
export function parseRustKillLine(line: string): { victim: string; killer: string } | null {
  const normalized = line.replace(/\r/g, "").replace(/\0/g, "").trim();
  if (!/\bwas\s+killed\s+by\b/i.test(normalized)) return null;

  const splitPair = parseWasKilledBySplit(normalized);
  if (splitPair) return splitPair;

  // Dedicated path for `...LOG: Victim was killed by Killer` (avoids colon/timestamp confusion).
  const logKill = normalized.match(/LOG:\s*(.+?)\s+was\s+killed\s+by\s+(.+)$/i);
  if (logKill) {
    let killer = logKill[2].trim().split(/\s+with\s+/i)[0].split(/\s*\(/)[0].trim();
    killer = stripSteamSuffix(killer);
    const victim = stripSteamSuffix(logKill[1].trim());
    const pair = finalizeKillPair(victim, killer);
    if (pair) return pair;
  }

  const m = normalized.match(/\bwas\s+killed\s+by\s+/i);
  if (!m || m.index === undefined) return trySplitKill(normalized);

  const idx = m.index;
  const afterKillPhrase = normalized.slice(idx + m[0].length).trim();

  const killerRaw = afterKillPhrase.split(/\s*\(/)[0].split(/\s+with\s+/i)[0].trim();
  const killer = stripSteamSuffix(killerRaw);

  const before = normalized.slice(0, idx).trim();

  const logMatch = before.match(/LOG:\s*(.+)$/i);
  let victimPart: string;
  if (logMatch) {
    victimPart = logMatch[1].trim();
  } else {
    const colonParts = before.split(":");
    victimPart = (colonParts[colonParts.length - 1] ?? before).trim();
  }

  const victim = stripSteamSuffix(victimPart);

  const pair2 = finalizeKillPair(victim, killer);
  if (pair2) return pair2;

  return trySplitKill(normalized);
}

/**
 * Active-voice kill lines (no "was killed by"), e.g. `Killer killed Victim with M4`.
 * Skips passive-kill lines so `parseAnyKillLine` can try passive first.
 */
export function parseRustKillLineActive(line: string): { victim: string; killer: string } | null {
  const normalized = line.replace(/\r/g, "").trim();
  if (/\bwas\s+killed\s+by\b/i.test(normalized)) return null;

  let work = normalized;
  const logMatch = work.match(/LOG:\s*(.+)$/i);
  if (logMatch) work = logMatch[1].trim();

  const m = work.match(/^(.+?)\s+killed\s+(.+?)(?:\s+with\b|\s+at\b|\s+from\b|$)/i);
  if (!m) return null;

  let killer = stripSteamSuffix(m[1].trim().split(/\s*\(/)[0].trim());
  let victim = stripSteamSuffix(m[2].trim().split(/\s*\(/)[0].trim());
  const pair = finalizeKillPair(victim, killer);
  return pair;
}

/** Active kill without `^` anchor — for embedded JSON / HTML killfeed fragments. */
function parseRustKillLineActiveLoose(line: string): { victim: string; killer: string } | null {
  const normalized = line.replace(/\r/g, "").replace(/\0/g, "").trim();
  if (/\bwas\s+killed\s+by\b/i.test(normalized)) return null;
  let work = normalized;
  const logMatch = work.match(/LOG:\s*(.+)$/i);
  if (logMatch) work = logMatch[1].trim();
  const m = work.match(/(.+?)\s+killed\s+(.+?)(?:\s+with\b|\s+at\b|\s+from\b|<|"|$)/i);
  if (!m) return null;
  let killer = stripSteamSuffix(m[1].trim().split(/\s*\(/)[0].trim());
  let victim = stripSteamSuffix(m[2].trim().split(/\s*\(/)[0].trim());
  killer = killer.replace(/^["'{}:,]+|["'{}:,]+$/g, "").trim();
  victim = victim.replace(/^["'{}:,]+|["'{}:,]+$/g, "").trim();
  return finalizeKillPair(victim, killer);
}

/** Try passive (`was killed by`) then active (`X killed Y`) parsing. */
export function parseAnyKillLine(line: string): { victim: string; killer: string } | null {
  const normalized = line.replace(/\r/g, "").replace(/\0/g, "").trim();
  let r = parseRustKillLine(normalized) ?? parseRustKillLineActive(normalized);
  if (r) return r;
  if (!/\bkilled\b/i.test(normalized)) return null;
  const noHtml = normalized.replace(/<[^>]+>/g, " ");
  r = parseRustKillLine(noHtml) ?? parseRustKillLineActive(noHtml);
  if (r) return r;
  const dejunk = noHtml
    .replace(/\\"/g, '"')
    .replace(/["'{}]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return (
    parseRustKillLine(dejunk) ??
    parseRustKillLineActive(dejunk) ??
    parseRustKillLineActiveLoose(dejunk) ??
    parseRustKillLineActiveLoose(normalized)
  );
}

/** Cheap pre-filter before full kill parse (Zentro-style). Avoid matching substrings like "unkilled". */
export function lineMightBeRustKill(line: string): boolean {
  const L = line.toLowerCase();
  if (L.includes("was killed")) return true;
  if (/\bunkilled\b/i.test(line)) return false;
  return /\bkilled\b/i.test(line);
}

/**
 * Player finished loading after respawn (manual respawn click).
 * Example: `04/12/2026 16:35:42:LOG: nzcve7130 [SCARLETT] has entered the game`
 * Also tolerates extra text after "game", missing LOG:, and embedded nulls from WebRcon.
 */
function sanitizeEnteredGameNameFragment(s: string): string {
  return stripWebRconConsoleJunk(s);
}

export function parseRustPlayerEnteredGame(line: string): string | null {
  const normalized = line.replace(/\r/g, "").replace(/\0/g, "").trim();
  if (!/\bhas\s+entered\s+the\s+game\b/i.test(normalized)) return null;

  // Prefer `… Name [TAG] has entered the game` (works when JSON/convar junk is glued before the name).
  const tagMatches = [...normalized.matchAll(/([^\s[\]]+)\s+\[[^\]]+\]\s+has\s+entered\s+the\s+game\b/gi)];
  if (tagMatches.length > 0) {
    const last = tagMatches[tagMatches.length - 1];
    const raw = last[1];
    if (raw) {
      const name = stripWebRconConsoleJunk(raw);
      if (name.length >= 1 && name.length <= MAX_PLAYER_NAME_LEN && !/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(name)) {
        return name;
      }
    }
  }

  // Zentro / Rust: `LOG: PlayerName [CLAN] has entered the game` — name is up to first `[`
  if (/\bLOG:\s*/i.test(normalized) && normalized.includes("[")) {
    const z = normalized.match(/\bLOG:\s*([^[\n]+?)\s*\[/i);
    if (z) {
      const name = sanitizeEnteredGameNameFragment(z[1]);
      if (name) return name;
    }
  }

  const m = normalized.match(/\bLOG:\s*(.+?)\s+has\s+entered\s+the\s+game\b/i);
  if (m) {
    const name = sanitizeEnteredGameNameFragment(m[1]);
    if (name) return name;
  }

  const lower = normalized.toLowerCase();
  const needle = "has entered the game";
  const hi = lower.indexOf(needle);
  if (hi <= 0) return null;
  let before = normalized.slice(0, hi).trim();
  const colonParts = before.split(":");
  before = sanitizeEnteredGameNameFragment(colonParts[colonParts.length - 1] ?? before);
  return before || null;
}
