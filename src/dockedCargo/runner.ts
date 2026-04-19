import cron from "node-cron";
import type { Pool } from "mysql2/promise";
import type { Client } from "discord.js";
import { config } from "../config.js";
import { decryptSecret } from "../crypto/passwordVault.js";
import {
  getDockedCargoConfig,
  isDockedCargoConfigComplete,
  mergeDockedCargoConfig,
  listDockedCargoAutomationServers,
  type DockedCargoConfigRow,
} from "../db/dockedCargo.js";
import { getRustServerByIdForGuild } from "../db/rustServers.js";
import { notifyGuildWebPush } from "../push/webPushNotify.js";
import { runWebRconCommand } from "../rcon/webrcon.js";
import { announceDockedCargoEvent } from "./discordAnnounce.js";

export type DockedCargoPhase = "off" | "docked" | "between";

const SPAWN_RETRY_MS = 60_000;

/** Per-server mutex so overlapping cron ticks do not double-spawn. */
const tickLocks = new Set<number>();

let cronJob: cron.ScheduledTask | null = null;

export function getDockedCargoRuntimePhaseFromConfig(cfg: DockedCargoConfigRow | null): DockedCargoPhase {
  if (!cfg?.automationStarted) return "off";
  if (cfg.automationPhase === "docked") return "docked";
  return "between";
}

async function runRcon(
  rustServerId: number,
  host: string,
  port: number,
  password: string,
  cmd: string,
  label: string
): Promise<void> {
  const r = await runWebRconCommand(rustServerId, host, port, password, cmd);
  if (!r.ok) {
    console.error(`[docked-cargo] ${label} failed:`, r.error);
  }
}

async function runSpawnAndDock(
  pool: Pool,
  guildRowId: number,
  rustServerId: number,
  cfg: DockedCargoConfigRow,
  client: Client
): Promise<void> {
  const srv = await getRustServerByIdForGuild(pool, guildRowId, rustServerId);
  if (!srv) throw new Error("Rust server not found");
  const password = decryptSecret(srv.rcon_password_encrypted, config.encryptionKeyHex);
  const { server_ip: host, rcon_port: port } = srv;
  const x = cfg.coordX!;
  const y = cfg.coordY!;
  const z = cfg.coordZ!;
  const crates = cfg.lockedCrates!;

  await runRcon(rustServerId, host, port, password, `cargoships.loot_rounds: "${crates}"`, "loot_rounds");
  await runRcon(
    rustServerId,
    host,
    port,
    password,
    `entity.spawn cargoshipdynamic2 ${x},${y},${z}`,
    "spawn"
  );
  await runRcon(
    rustServerId,
    host,
    port,
    password,
    `cargoshipdynamic.cargoship_speed_scale "0"`,
    "speed 0"
  );

  if (cfg.sayEnabled && cfg.inGameMessage?.trim()) {
    await runRcon(
      rustServerId,
      host,
      port,
      password,
      `say ${cfg.inGameMessage.trim()}`,
      "say arrive"
    );
  }

  if (cfg.announcementChannelId) {
    await announceDockedCargoEvent(
      client,
      cfg.announcementChannelId,
      cfg.announcementRoleId,
      "Docked Cargo — spawned",
      `**${srv.nickname}** — Cargo has **docked**. Get in-game and contest the ship.`
    );
  }

  void notifyGuildWebPush(pool, guildRowId, rustServerId, {
    title: "Grindset",
    body: "Docked Cargo is active on this server.",
    tag: `docked-cargo-active-${rustServerId}`,
  });
}

async function runUndock(
  pool: Pool,
  guildRowId: number,
  rustServerId: number,
  cfg: DockedCargoConfigRow,
  client: Client
): Promise<void> {
  const srv = await getRustServerByIdForGuild(pool, guildRowId, rustServerId);
  if (!srv) return;
  let password: string;
  try {
    password = decryptSecret(srv.rcon_password_encrypted, config.encryptionKeyHex);
  } catch {
    return;
  }
  const { server_ip: host, rcon_port: port } = srv;
  await runRcon(
    rustServerId,
    host,
    port,
    password,
    `cargoshipdynamic.cargoship_speed_scale "1"`,
    "speed 1"
  );
  if (cfg.sayEnabled && cfg.leaveMessage?.trim()) {
    await runRcon(
      rustServerId,
      host,
      port,
      password,
      `say ${cfg.leaveMessage.trim()}`,
      "say leave"
    );
  }
  if (cfg.announcementChannelId) {
    await announceDockedCargoEvent(
      client,
      cfg.announcementChannelId,
      cfg.announcementRoleId,
      "Docked Cargo — leaving",
      `**${srv.nickname}** — The cargo ship is **undocking** and leaving the area.`
    );
  }
}

export async function processDockedCargoServer(
  pool: Pool,
  client: Client,
  guildRowId: number,
  rustServerId: number
): Promise<void> {
  if (tickLocks.has(rustServerId)) return;
  tickLocks.add(rustServerId);
  try {
    const cfg = await getDockedCargoConfig(pool, guildRowId, rustServerId);
    if (!cfg?.automationStarted) return;
    if (!isDockedCargoConfigComplete(cfg)) {
      console.warn("[docked-cargo] config incomplete, stopping automation", rustServerId);
      await mergeDockedCargoConfig(pool, guildRowId, rustServerId, { automationStarted: false });
      return;
    }

    const now = Date.now();
    const dockMs = cfg.timeDockedMinutes! * 60_000;
    const waitMs = cfg.howOftenHours! * 3600_000;

    // Pending spawn (initial, after force-restart, or after failed spawn retry window).
    if (cfg.automationPhase == null) {
      if (cfg.phaseDeadlineMs != null && now < cfg.phaseDeadlineMs) return;
      try {
        await runSpawnAndDock(pool, guildRowId, rustServerId, cfg, client);
        await mergeDockedCargoConfig(pool, guildRowId, rustServerId, {
          automationPhase: "docked",
          phaseDeadlineMs: now + dockMs,
        });
      } catch (e) {
        console.error("[docked-cargo] spawn sequence failed:", e);
        await mergeDockedCargoConfig(pool, guildRowId, rustServerId, {
          automationPhase: null,
          phaseDeadlineMs: now + SPAWN_RETRY_MS,
        });
      }
      return;
    }

    if (cfg.automationPhase === "docked") {
      if (cfg.phaseDeadlineMs == null || now < cfg.phaseDeadlineMs) return;
      const cfgFresh = await getDockedCargoConfig(pool, guildRowId, rustServerId);
      if (!cfgFresh || !isDockedCargoConfigComplete(cfgFresh)) return;
      await runUndock(pool, guildRowId, rustServerId, cfgFresh, client);
      await mergeDockedCargoConfig(pool, guildRowId, rustServerId, {
        automationPhase: "between",
        phaseDeadlineMs: now + waitMs,
      });
      return;
    }

    if (cfg.automationPhase === "between") {
      if (cfg.phaseDeadlineMs == null || now < cfg.phaseDeadlineMs) return;
      const cfgFresh = await getDockedCargoConfig(pool, guildRowId, rustServerId);
      if (!cfgFresh || !isDockedCargoConfigComplete(cfgFresh)) return;
      try {
        await runSpawnAndDock(pool, guildRowId, rustServerId, cfgFresh, client);
        await mergeDockedCargoConfig(pool, guildRowId, rustServerId, {
          automationPhase: "docked",
          phaseDeadlineMs: now + dockMs,
        });
      } catch (e) {
        console.error("[docked-cargo] spawn sequence failed:", e);
        await mergeDockedCargoConfig(pool, guildRowId, rustServerId, {
          automationPhase: null,
          phaseDeadlineMs: now + SPAWN_RETRY_MS,
        });
      }
    }
  } finally {
    tickLocks.delete(rustServerId);
  }
}

export async function tickAllDockedCargoAutomation(pool: Pool, client: Client): Promise<void> {
  const servers = await listDockedCargoAutomationServers(pool);
  for (const { guildRowId, rustServerId } of servers) {
    try {
      await processDockedCargoServer(pool, client, guildRowId, rustServerId);
    } catch (e) {
      console.error(`[docked-cargo] tick failed for server ${rustServerId}:`, e);
    }
  }
}

/**
 * Registers automation: persisted phase deadlines + node-cron (survives process restarts).
 */
export function initDockedCargoScheduler(pool: Pool, client: Client): void {
  if (cronJob) return;
  // Every 20 seconds — responsive enough for dock/between transitions without hammering RCON.
  cronJob = cron.schedule(
    "*/20 * * * * *",
    () => {
      void tickAllDockedCargoAutomation(pool, client);
    },
    { timezone: "Etc/UTC" }
  );
  void tickAllDockedCargoAutomation(pool, client);
}

/**
 * Enables automation and resets schedule so the next cron tick spawns cargo (or retries after backoff).
 */
export async function startDockedCargoAutomation(
  pool: Pool,
  guildRowId: number,
  rustServerId: number,
  _client: Client,
  _options?: { force?: boolean }
): Promise<{ ok: true } | { ok: false; error: string }> {
  await mergeDockedCargoConfig(pool, guildRowId, rustServerId, {
    automationStarted: true,
    automationPhase: null,
    phaseDeadlineMs: null,
  });
  return { ok: true };
}
