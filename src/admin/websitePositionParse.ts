import { parseGatePosition } from "../commands/shared/gatePositionOption.js";
import { parseMazeSpawnPosition } from "../commands/shared/mazeSpawnOption.js";

export type WebsitePositionParse =
  | { kind: "koth_gate"; gate: number }
  | { kind: "maze_spawn"; spawn: number }
  | { kind: "nuketown_gate"; gate: number }
  | { kind: "onev1_gate"; gate: 1 | 2 };

/** Same rules as `/manage-positions` `position` string. */
export function parseWebsitePosition(raw: string): WebsitePositionParse | null {
  const s = raw.trim();
  const low = s.toLowerCase();
  const num = Number.parseInt(low.replace(/[^0-9]/g, ""), 10);
  const hasNum = Number.isFinite(num);
  const isMaze = low.includes("maze") || low.includes("spawn");
  const isNuke = low.includes("nuke");
  const is1v1 = low.includes("1v1") || low.includes("onev1") || low.includes("1 v 1");
  const isKoth = (low.includes("koth") || low.includes("gate")) && !is1v1;

  if (isMaze) {
    const spawn = parseMazeSpawnPosition(s);
    if (spawn != null) return { kind: "maze_spawn", spawn };
    if (hasNum && num >= 1 && num <= 10) return { kind: "maze_spawn", spawn: num };
    return null;
  }
  if (isNuke) {
    if (hasNum && num >= 1 && num <= 20) return { kind: "nuketown_gate", gate: num };
    return null;
  }
  if (is1v1) {
    const gateMatch = low.match(/\bgate\s*(\d+)/);
    if (gateMatch) {
      const g = Number.parseInt(gateMatch[1] ?? "", 10);
      if (g === 1 || g === 2) return { kind: "onev1_gate", gate: g as 1 | 2 };
    }
    return null;
  }
  if (isKoth) {
    const gate = parseGatePosition(s);
    if (gate != null) return { kind: "koth_gate", gate };
    if (hasNum && num >= 1 && num <= 20) return { kind: "koth_gate", gate: num };
    return null;
  }
  return null;
}
