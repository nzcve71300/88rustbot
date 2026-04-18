import { runWebRconCommand } from "./webrcon.js";

/** User-requested strings: plain `say` (not `global.say`), passed to WebRcon verbatim. */
export const KOTH_RCON_SETUP =
  "say <b><size=35><color=#FACC15>KOTH EVENT STARTING SOON USE</color> <color=#166534> /KOTH-JOIN IN THE DISCORD</color>";

export const KOTH_RCON_START = "say <b><size=55><color=#FACC15>KOTH EVENT STARTED</color>";

export const MAZE_RCON_SETUP =
  "say <b><size=35><color=#FACC15>MAZE EVENT STARTING SOON USE</color> <color=#166534> /MAZE-JOIN IN THE DISCORD</color>";

export const MAZE_RCON_START = "say <b><size=55><color=#FACC15>MAZE EVENT STARTED</color>";

/** Strip characters that break Rust rich-text / RCON when substituting clan and linked names. */
export function sanitizeSayFragment(s: string): string {
  const t = s.replace(/[<>"\\]/g, "").replace(/\s+/g, " ").trim();
  return t.length > 0 ? t : "N/A";
}

export function buildKothEndedSay(clanName: string, linkedName: string): string {
  const c = sanitizeSayFragment(clanName);
  const n = sanitizeSayFragment(linkedName);
  return `say <b><size=55><color=#DC2626>KOTH EVENT ENDED</color><color=#EAB308>${c} | ${n} Won the event</color>`;
}

export function buildMazeEndedSay(clanName: string, linkedName: string): string {
  const c = sanitizeSayFragment(clanName);
  const n = sanitizeSayFragment(linkedName);
  return `say <b><size=55><color=#DC2626>MAZE EVENT ENDED</color><color=#EAB308>${c} | ${n} Won the event</color>`;
}

export async function runSayRcon(
  rustServerId: number,
  host: string,
  port: number,
  password: string,
  commandLine: string,
  logTag: string
): Promise<void> {
  const res = await runWebRconCommand(rustServerId, host, port, password, commandLine);
  if (!res.ok) {
    console.warn(`[${logTag}] say RCON failed: ${res.error}`);
  }
}
