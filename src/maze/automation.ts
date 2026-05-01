import cron from "node-cron";
import type { Client } from "discord.js";
import type { Pool } from "mysql2/promise";
import { config } from "../config.js";
import { decryptSecret } from "../crypto/passwordVault.js";
import {
  countMazeEventMembers,
  deleteMazeEventRow,
  ensureLobbyMazeForJoin,
  getActiveMazeEvent,
  getActiveMazeEventMeta,
  getMazeConfig,
  isMazeAutomationConfigComplete,
  listMazeAutomationServers,
  listMazeSpawnViews,
  listMissingMazeSpawnCoords,
  mergeMazeConfig,
  MAZE_MAX_PLAYERS,
  setMazeLobbyEndsInMinutes,
  startMazeEvent,
} from "../db/maze.js";
import { getRustServerByIdForGuild, listRustServersForGuild } from "../db/rustServers.js";
import { notifyGuildWebPush } from "../push/webPushNotify.js";
import { sendAutomatedLobbyOpenPing } from "../discord/lobbyOpenNotify.js";
import { updateMazeMessage } from "./announce.js";
import { renderMazeEmbed } from "./render.js";
import { runMazeEvent } from "./runner.js";
import { runWebRconCommand } from "../rcon/webrcon.js";
import { applyEventZoneConfigIfPresent } from "../zones/eventZones.js";

const LOBBY_MAX_MINUTES = 15;

const tickLocks = new Set<number>();
let cronJob: cron.ScheduledTask | null = null;

function spawnCapForConfig(spawnPoints: number): number {
  return Math.min(Math.max(1, spawnPoints), MAZE_MAX_PLAYERS);
}

async function announceText(client: Client, channelId: string, text: string): Promise<void> {
  const ch = await client.channels.fetch(channelId).catch(() => null);
  if (!ch || !ch.isTextBased() || !("send" in ch)) return;
  await ch.send({ content: text });
}

export async function startMazeMatchFromLobby(
  pool: Pool,
  client: Client,
  guildRowId: number,
  rustServerId: number,
  eventId: number
): Promise<boolean> {
  const cfg = await getMazeConfig(pool, guildRowId, rustServerId);
  if (!cfg?.messageId || !isMazeAutomationConfigComplete(cfg)) return false;
  const durationMin = cfg.durationMinutes!;
  const kitName = cfg.kitName!.trim();
  const respawnEnabled = cfg.respawnEnabled;

  const srv = await getRustServerByIdForGuild(pool, guildRowId, rustServerId);
  if (!srv) return false;

  let password: string;
  try {
    password = decryptSecret(srv.rcon_password_encrypted, config.encryptionKeyHex);
  } catch {
    return false;
  }

  const started = await startMazeEvent(pool, eventId, durationMin, kitName, respawnEnabled);
  if (!started) return false;

  void notifyGuildWebPush(pool, guildRowId, rustServerId, {
    title: "Grindset",
    body: "Maze Started. Join now!",
    tag: `maze-${eventId}`,
  });

  void runMazeEvent({
    client,
    pool,
    guildRowId,
    rustServerId,
    eventId,
    announcementChannelId: cfg.announcementChannelId,
    serverNickname: srv.nickname,
    host: srv.server_ip,
    port: srv.rcon_port,
    password,
    durationMinutes: durationMin,
    kitName,
    spawnPointCount: cfg.spawnPoints,
  });

  return true;
}

async function cancelAutomatedLobby(
  pool: Pool,
  client: Client,
  guildRowId: number,
  rustServerId: number,
  eventId: number,
  reason: string
): Promise<void> {
  const cfg = await getMazeConfig(pool, guildRowId, rustServerId);
  await deleteMazeEventRow(pool, guildRowId, eventId);
  // Zone swap: lobby/event ended -> ensure inactive.
  try {
    const srvFull = await getRustServerByIdForGuild(pool, guildRowId, rustServerId);
    if (srvFull) {
      const password = decryptSecret(srvFull.rcon_password_encrypted, config.encryptionKeyHex);
      await applyEventZoneConfigIfPresent({
        pool,
        guildRowId,
        rustServerId,
        eventType: "maze",
        desired: "inactive",
        rcon: { host: srvFull.server_ip, port: srvFull.rcon_port, password },
      });
    }
  } catch (e) {
    console.error("[maze zones] failed to apply inactive on cancel:", e);
  }
  if (cfg?.howOftenHours && cfg.howOftenHours > 0) {
    await mergeMazeConfig(pool, guildRowId, rustServerId, {
      nextLobbyAtMs: Date.now() + cfg.howOftenHours * 3600_000,
    });
  }
  if (cfg?.announcementChannelId) {
    await announceText(
      client,
      cfg.announcementChannelId,
      `**Maze lobby cancelled** — ${reason} Next lobby is scheduled per your **How often** interval.`
    );
  }
}

async function openAutomatedMazeLobby(pool: Pool, client: Client, guildRowId: number, rustServerId: number): Promise<void> {
  const cfg = await getMazeConfig(pool, guildRowId, rustServerId);
  if (!cfg || !isMazeAutomationConfigComplete(cfg) || !cfg.messageId) {
    console.warn("[maze-automation] open lobby skipped — incomplete config", rustServerId);
    return;
  }

  const existing = await getActiveMazeEvent(pool, guildRowId, rustServerId);
  if (existing) return;

  const lobby = await ensureLobbyMazeForJoin(pool, guildRowId, rustServerId);
  if (!lobby.ok) return;

  await setMazeLobbyEndsInMinutes(pool, lobby.eventId, LOBBY_MAX_MINUTES);
  await mergeMazeConfig(pool, guildRowId, rustServerId, { nextLobbyAtMs: null });

  const servers = await listRustServersForGuild(pool, guildRowId);
  const srv = servers.find((s) => String(s.id) === String(rustServerId));
  const serverName = srv?.nickname ?? "Server";

  const views = await listMazeSpawnViews(pool, guildRowId, lobby.eventId);
  const meta = await getActiveMazeEventMeta(pool, guildRowId, rustServerId);
  const lobbyEndsAtMs = meta?.lobbyEndsAtMs ?? null;
  const durationMinutes = cfg.durationMinutes ?? null;
  const panelEmbed = renderMazeEmbed(serverName, serverName, views, durationMinutes, lobbyEndsAtMs);
  try {
    await updateMazeMessage(
      client,
      cfg.announcementChannelId,
      cfg.messageId,
      serverName,
      serverName,
      views,
      durationMinutes,
      lobbyEndsAtMs
    );
  } catch (e) {
    console.error("[maze-automation] updateMazeMessage failed:", e);
  }
  await sendAutomatedLobbyOpenPing(client, cfg.announcementChannelId, cfg.announcementRoleId, panelEmbed);

  void notifyGuildWebPush(pool, guildRowId, rustServerId, {
    title: "Grindset",
    body: "Maze lobby is open. Join now!",
    tag: `maze-lobby-${lobby.eventId}`,
  });

  // Zone swap: lobby opened -> ensure active.
  try {
    const srvFull = await getRustServerByIdForGuild(pool, guildRowId, rustServerId);
    if (srvFull) {
      const password = decryptSecret(srvFull.rcon_password_encrypted, config.encryptionKeyHex);
      await applyEventZoneConfigIfPresent({
        pool,
        guildRowId,
        rustServerId,
        eventType: "maze",
        desired: "active",
        rcon: { host: srvFull.server_ip, port: srvFull.rcon_port, password },
      });
    }
  } catch (e) {
    console.error("[maze zones] failed to apply active on lobby open:", e);
  }

  // Maze-specific server tuning while lobby is open/announced (best-effort).
  try {
    const srvFull = await getRustServerByIdForGuild(pool, guildRowId, rustServerId);
    if (srvFull) {
      const password = decryptSecret(srvFull.rcon_password_encrypted, config.encryptionKeyHex);
      const res = await runWebRconCommand(rustServerId, srvFull.server_ip, srvFull.rcon_port, password, "server.corpsedespawn 10");
      if (!res.ok) console.error(`[maze] corpsedespawn(10) failed: ${res.error}`);
    }
  } catch (e) {
    console.error("[maze] corpsedespawn(10) lobby best-effort failed:", e);
  }
}

async function processMazeLobbyPhase(
  pool: Pool,
  client: Client,
  guildRowId: number,
  rustServerId: number,
  eventId: number
): Promise<void> {
  const cfg = await getMazeConfig(pool, guildRowId, rustServerId);
  const meta = await getActiveMazeEventMeta(pool, guildRowId, rustServerId);
  if (!cfg || !meta || meta.status !== "lobby" || meta.id !== eventId) return;

  if (meta.lobbyEndsAtMs == null && cfg.automationStarted) {
    await setMazeLobbyEndsInMinutes(pool, eventId, LOBBY_MAX_MINUTES);
    return;
  }

  const spawnCap = spawnCapForConfig(cfg.spawnPoints);
  const members = await countMazeEventMembers(pool, eventId);
  const lobbyEndsAt = meta.lobbyEndsAtMs;
  const now = Date.now();

  const allSpawnsFull = members >= spawnCap && members >= 1;

  if (allSpawnsFull) {
    const missing = await listMissingMazeSpawnCoords(pool, guildRowId, rustServerId, cfg.spawnPoints);
    if (missing.length > 0) {
      await cancelAutomatedLobby(
        pool,
        client,
        guildRowId,
        rustServerId,
        eventId,
        `spawn coordinates missing for slot(s): **${missing.join(", ")}** (configure **Manage Positions**).`
      );
      return;
    }
    const ok = await startMazeMatchFromLobby(pool, client, guildRowId, rustServerId, eventId);
    if (!ok) {
      await cancelAutomatedLobby(
        pool,
        client,
        guildRowId,
        rustServerId,
        eventId,
        "could not start the maze (check RCON / config)."
      );
    }
    return;
  }

  if (lobbyEndsAt == null || now < lobbyEndsAt) return;

  if (members < 1) {
    await cancelAutomatedLobby(pool, client, guildRowId, rustServerId, eventId, "no players joined.");
    return;
  }

  const missingCoords = await listMissingMazeSpawnCoords(pool, guildRowId, rustServerId, cfg.spawnPoints);
  if (missingCoords.length > 0) {
    await cancelAutomatedLobby(
      pool,
      client,
      guildRowId,
      rustServerId,
      eventId,
      `missing maze spawn coordinates for: **${missingCoords.join(", ")}**. Use **Manage Positions**.`
    );
    return;
  }

  const ok = await startMazeMatchFromLobby(pool, client, guildRowId, rustServerId, eventId);
  if (!ok) {
    await cancelAutomatedLobby(pool, client, guildRowId, rustServerId, eventId, "failed to start after lobby window.");
  }
}

export async function tickMazeAutomation(pool: Pool, client: Client): Promise<void> {
  const servers = await listMazeAutomationServers(pool);
  for (const { guildRowId, rustServerId } of servers) {
    if (tickLocks.has(rustServerId)) continue;
    tickLocks.add(rustServerId);
    try {
      const cfg = await getMazeConfig(pool, guildRowId, rustServerId);
      if (!cfg?.automationStarted || !isMazeAutomationConfigComplete(cfg)) continue;

      const active = await getActiveMazeEvent(pool, guildRowId, rustServerId);
      if (active?.status === "running") continue;

      if (active?.status === "lobby") {
        await processMazeLobbyPhase(pool, client, guildRowId, rustServerId, active.id);
        continue;
      }

      const nextAt = cfg.nextLobbyAtMs;
      if (nextAt != null && Date.now() >= nextAt) {
        await openAutomatedMazeLobby(pool, client, guildRowId, rustServerId);
      }
    } catch (e) {
      console.error(`[maze-automation] tick failed for server ${rustServerId}:`, e);
    } finally {
      tickLocks.delete(rustServerId);
    }
  }
}

export function initMazeAutomationScheduler(pool: Pool, client: Client): void {
  if (cronJob) return;
  cronJob = cron.schedule(
    "*/20 * * * * *",
    () => {
      void tickMazeAutomation(pool, client);
    },
    { timezone: "Etc/UTC" }
  );
  void tickMazeAutomation(pool, client);
}

export async function startMazeAutomation(
  pool: Pool,
  guildRowId: number,
  rustServerId: number
): Promise<{ ok: true } | { ok: false; error: string }> {
  const cfg = await getMazeConfig(pool, guildRowId, rustServerId);
  if (!cfg?.messageId || !isMazeAutomationConfigComplete(cfg)) {
    return {
      ok: false,
      error: "Complete **/maze-setup** (how often, duration, kit, respawn, channel, spawns) first.",
    };
  }
  await mergeMazeConfig(pool, guildRowId, rustServerId, {
    automationStarted: true,
    nextLobbyAtMs: Date.now(),
  });
  return { ok: true };
}
