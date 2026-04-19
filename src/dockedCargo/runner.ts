import type { Pool } from "mysql2/promise";
import type { Client } from "discord.js";
import { config } from "../config.js";
import { decryptSecret } from "../crypto/passwordVault.js";
import {
  getDockedCargoConfig,
  isDockedCargoConfigComplete,
  mergeDockedCargoConfig,
  type DockedCargoConfigRow,
} from "../db/dockedCargo.js";
import { getRustServerByIdForGuild } from "../db/rustServers.js";
import { notifyGuildWebPush } from "../push/webPushNotify.js";
import { runWebRconCommand } from "../rcon/webrcon.js";
import { announceDockedCargoEvent } from "./discordAnnounce.js";

export type DockedCargoPhase = "off" | "docked" | "between";

type LoopEntry = { abort: AbortController; phase: DockedCargoPhase };

const loops = new Map<number, LoopEntry>();

export function getDockedCargoRuntimePhase(rustServerId: number): DockedCargoPhase {
  return loops.get(rustServerId)?.phase ?? "off";
}

export function isDockedCargoLoopRunning(rustServerId: number): boolean {
  return loops.has(rustServerId);
}

function setPhase(rustServerId: number, phase: DockedCargoPhase): void {
  const x = loops.get(rustServerId);
  if (x) x.phase = phase;
}

async function sleepAbort(ms: number, signal: AbortSignal): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    const onAbort = (): void => {
      clearTimeout(t);
      reject(new Error("aborted"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export function stopDockedCargoLoop(rustServerId: number): void {
  const x = loops.get(rustServerId);
  if (x) {
    x.abort.abort();
    loops.delete(rustServerId);
  }
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

/**
 * Starts the repeating automation loop (spawn → dock timer → undock → how_often wait → repeat).
 * Call only when {@link isDockedCargoConfigComplete} is true.
 */
export function startDockedCargoAutomation(
  pool: Pool,
  guildRowId: number,
  rustServerId: number,
  client: Client,
  options?: { force?: boolean }
): { ok: true } | { ok: false; error: string } {
  if (loops.has(rustServerId) && !options?.force) {
    return { ok: false, error: "Loop already running for this server." };
  }
  if (options?.force) {
    stopDockedCargoLoop(rustServerId);
  }

  const abort = new AbortController();
  const signal = abort.signal;
  loops.set(rustServerId, { abort, phase: "between" });

  void (async () => {
    try {
      while (!signal.aborted) {
        const cfg = await getDockedCargoConfig(pool, guildRowId, rustServerId);
        if (!cfg || !isDockedCargoConfigComplete(cfg)) {
          console.warn("[docked-cargo] config incomplete, stopping loop", rustServerId);
          void mergeDockedCargoConfig(pool, guildRowId, rustServerId, { automationStarted: false }).catch(() => {});
          break;
        }

        setPhase(rustServerId, "docked");
        try {
          await runSpawnAndDock(pool, guildRowId, rustServerId, cfg, client);
        } catch (e) {
          console.error("[docked-cargo] spawn sequence failed:", e);
        }

        const dockMs = cfg.timeDockedMinutes! * 60_000;
        try {
          await sleepAbort(dockMs, signal);
        } catch {
          break;
        }

        const cfg2 = await getDockedCargoConfig(pool, guildRowId, rustServerId);
        if (!cfg2 || !isDockedCargoConfigComplete(cfg2)) {
          void mergeDockedCargoConfig(pool, guildRowId, rustServerId, { automationStarted: false }).catch(() => {});
          break;
        }

        await runUndock(pool, guildRowId, rustServerId, cfg2, client);

        setPhase(rustServerId, "between");
        const waitMs = cfg2.howOftenHours! * 3600_000;
        try {
          await sleepAbort(waitMs, signal);
        } catch {
          break;
        }
      }
    } finally {
      loops.delete(rustServerId);
    }
  })();

  return { ok: true };
}
