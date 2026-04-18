import type { Pool } from "mysql2/promise";
import { config } from "../config.js";
import { decryptSecret } from "../crypto/passwordVault.js";
import { DEFAULT_KILLFEED_FORMAT, getKillfeedConfig } from "../db/killfeedConfig.js";
import { listAllRustServers } from "../db/rustServers.js";
import { parseAnyKillLine } from "../koth/killParse.js";
import { quoteForRconArg } from "../rcon/quote.js";
import { runWebRconCommand } from "../rcon/webrcon.js";

type CachedCfg = { enabled: boolean; format: string; randomizer: boolean };

const rconCreds = new Map<number, { host: string; port: number; password: string }>();
const configCache = new Map<number, CachedCfg>();
/** Server nicknames for logs (same keys as configCache). */
const serverNicknameById = new Map<number, string>();

/** Rotating verbs for Killfeed-randomizer (replaces the word `killed` in order). */
export const KILLFEED_RANDOMIZER_VERBS = [
  "wrecked",
  "crushed",
  "erased",
  "terminated",
  "dominated",
  "dropped",
  "clapped",
  "deleted",
  "ended",
  "outplayed",
  "sniped",
  "blasted",
  "punished",
  "took down",
  "melted",
  "smoked",
  "neutralized",
  "knocked",
  "dusted",
  "body-shot",
] as const;

/** Per Rust server: next index into {@link KILLFEED_RANDOMIZER_VERBS}. */
const randomizerVerbIndexByServer = new Map<number, number>();

/** Throttle “killfeed is off” warnings so console lines don’t spam during fights. */
const lastKillfeedDisabledLogMs = new Map<number, number>();
const KILLFEED_DISABLED_LOG_COOLDOWN_MS = 120_000;

function logKillfeedSkippedDisabled(serverId: number, nickname: string | undefined): void {
  const now = Date.now();
  const last = lastKillfeedDisabledLogMs.get(serverId) ?? 0;
  if (now - last < KILLFEED_DISABLED_LOG_COOLDOWN_MS) return;
  lastKillfeedDisabledLogMs.set(serverId, now);
  const label = nickname ? `${nickname} (#${serverId})` : `#${serverId}`;
  console.warn(
    `[killfeed] ${label}: in-game killfeed is OFF (skipping broadcast). Enable with /set — server + killfeed_game On.`
  );
}

function sanitizeKillfeedMessage(msg: string): string {
  let s = msg.replace(/\r\n?/g, " ");
  s = s.replace(/\{[^{}]+\}/g, "");
  s = s.replace(/[{}]/g, "");
  return s.replace(/\s+/g, " ").trim();
}

export async function refreshKillfeedCaches(pool: Pool): Promise<void> {
  rconCreds.clear();
  configCache.clear();
  serverNicknameById.clear();
  randomizerVerbIndexByServer.clear();
  const rows = await listAllRustServers(pool);
  for (const row of rows) {
    let password: string;
    try {
      password = decryptSecret(row.rcon_password_encrypted, config.encryptionKeyHex);
    } catch {
      continue;
    }
    rconCreds.set(row.id, { host: row.server_ip, port: row.rcon_port, password });
    serverNicknameById.set(row.id, row.nickname);
    const cfg = await getKillfeedConfig(pool, row.guild_id, row.id);
    const cached: CachedCfg = {
      enabled: cfg?.enabled ?? false,
      format: cfg?.format_string ?? DEFAULT_KILLFEED_FORMAT,
      randomizer: cfg?.randomizer_enabled ?? false,
    };
    configCache.set(row.id, cached);
    console.log(`[killfeed] ${row.nickname} (#${row.id}): in-game broadcast ${cached.enabled ? "ON" : "OFF"}`);
  }
}

export async function reloadKillfeedConfigForServer(pool: Pool, rustServerId: number): Promise<void> {
  const rows = await listAllRustServers(pool);
  const row = rows.find((r) => r.id === rustServerId);
  if (!row) {
    rconCreds.delete(rustServerId);
    configCache.delete(rustServerId);
    serverNicknameById.delete(rustServerId);
    return;
  }
  let password: string;
  try {
    password = decryptSecret(row.rcon_password_encrypted, config.encryptionKeyHex);
  } catch {
    rconCreds.delete(rustServerId);
    configCache.delete(rustServerId);
    serverNicknameById.delete(rustServerId);
    return;
  }
  rconCreds.set(row.id, { host: row.server_ip, port: row.rcon_port, password });
  serverNicknameById.set(row.id, row.nickname);
  const cfg = await getKillfeedConfig(pool, row.guild_id, row.id);
  configCache.set(row.id, {
    enabled: cfg?.enabled ?? false,
    format: cfg?.format_string ?? DEFAULT_KILLFEED_FORMAT,
    randomizer: cfg?.randomizer_enabled ?? false,
  });
}

/** In-game broadcast via WebRcon when killfeed is enabled for this server. */
export function onKillfeedConsoleLine(serverId: number, line: string): void {
  const parsed = parseAnyKillLine(line);
  if (!parsed) return;
  const cfg = configCache.get(serverId);
  if (!cfg || !cfg.enabled) {
    if (cfg && !cfg.enabled) logKillfeedSkippedDisabled(serverId, serverNicknameById.get(serverId));
    return;
  }
  const creds = rconCreds.get(serverId);
  if (!creds) {
    if (process.env.DEBUG_KILLFEED === "1") {
      console.warn(`[killfeed] skip server ${serverId}: no RCON creds in cache (decrypt/bootstrap issue?)`);
    }
    return;
  }

  let msg = cfg.format;
  msg = msg.replace(/\{Killer\}/gi, parsed.killer).replace(/\{Victim\}/gi, parsed.victim);

  if (cfg.randomizer && /\bkilled\b/i.test(msg)) {
    const i = randomizerVerbIndexByServer.get(serverId) ?? 0;
    const verb = KILLFEED_RANDOMIZER_VERBS[i % KILLFEED_RANDOMIZER_VERBS.length]!;
    randomizerVerbIndexByServer.set(serverId, i + 1);
    msg = msg.replace(/\bkilled\b/i, verb);
  }

  msg = sanitizeKillfeedMessage(msg);
  if (!msg) {
    if (process.env.DEBUG_KILLFEED === "1") {
      console.warn(`[killfeed] skip server ${serverId}: empty message after sanitize (check format string)`);
    }
    return;
  }

  /** Match `/test-connection`: Rust WebRcon expects `global.say` for server-wide chat (plain `say` often fails or is ignored). */
  const cmd = `global.say "${quoteForRconArg(msg)}"`;
  void runWebRconCommand(serverId, creds.host, creds.port, creds.password, cmd).then((res) => {
    if (!res.ok) {
      console.warn(`[killfeed] global.say failed server ${serverId}: ${res.error}`);
      if (process.env.DEBUG_KILLFEED === "1") {
        console.warn(`[killfeed] command was: global.say "<msg>" (msg len=${msg.length})`);
      }
    } else if (process.env.DEBUG_KILLFEED === "1") {
      console.log(`[killfeed] global.say ok server ${serverId} (msg len=${msg.length})`);
    }
  });
}
