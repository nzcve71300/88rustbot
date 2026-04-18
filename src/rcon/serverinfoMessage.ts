/**
 * Parse Rust WebRCON `global.serverinfo` / `serverinfo` console output.
 * Example prefix: 04/18/2026 21:23:10:LOG: {\n "Hostname": ...
 */
export type ServerinfoMetrics = {
  EntityCount: number;
  Framerate: number;
  Memory: number;
  Players: number;
  MaxPlayers?: number;
};

const LOG_PREFIX = /(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})\s*:LOG:/;

export function parseServerTimeFromRconMessage(message: string): Date | null {
  const m = message.match(LOG_PREFIX);
  if (!m) return null;
  const month = Number.parseInt(m[1] ?? "", 10) - 1;
  const day = Number.parseInt(m[2] ?? "", 10);
  const year = Number.parseInt(m[3] ?? "", 10);
  const hh = Number.parseInt(m[4] ?? "", 10);
  const mm = Number.parseInt(m[5] ?? "", 10);
  const ss = Number.parseInt(m[6] ?? "", 10);
  if (!Number.isFinite(month) || !Number.isFinite(day) || year < 2000) return null;
  return new Date(year, month, day, hh, mm, ss);
}

function extractJsonObject(message: string): string | null {
  const i = message.indexOf("{");
  const j = message.lastIndexOf("}");
  if (i < 0 || j < 0 || j <= i) return null;
  return message.slice(i, j + 1);
}

export function parseServerinfoMetrics(message: string): ServerinfoMetrics | null {
  const raw = extractJsonObject(message);
  if (!raw) return null;
  const normalized = raw.replace(/\\n/g, "\n");
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(normalized) as Record<string, unknown>;
  } catch {
    try {
      obj = JSON.parse(normalized.replace(/\r?\n/g, "")) as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  const num = (k: string): number | null => {
    const v = obj[k];
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
    return null;
  };

  const entity = num("EntityCount");
  const fps = num("Framerate");
  const mem = num("Memory");
  const players = num("Players");
  if (entity === null || fps === null || mem === null || players === null) return null;

  const maxP = num("MaxPlayers");

  return {
    EntityCount: Math.round(entity),
    Framerate: fps,
    Memory: Math.round(mem),
    Players: Math.round(players),
    ...(maxP != null ? { MaxPlayers: Math.round(maxP) } : {}),
  };
}

export function parseServerinfoRconMessage(message: string): {
  serverTime: Date | null;
  metrics: ServerinfoMetrics | null;
} {
  return {
    serverTime: parseServerTimeFromRconMessage(message),
    metrics: parseServerinfoMetrics(message),
  };
}
