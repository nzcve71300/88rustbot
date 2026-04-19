import cron from "node-cron";
import type { Client } from "discord.js";
import type { Pool } from "mysql2/promise";
import { config } from "../config.js";
import { decryptSecret } from "../crypto/passwordVault.js";
import {
  countAssignedGatesForEvent,
  countEventMembers,
  deleteKothEventRow,
  ensureLobbyEventForJoin,
  getActiveKothEvent,
  getActiveKothEventMeta,
  getGateCoord,
  getKothConfig,
  isKothAutomationConfigComplete,
  listGateViews,
  listKothAutomationServers,
  mergeKothConfig,
  setKothLobbyEndsInMinutes,
  startKothEvent,
} from "../db/koth.js";
import { getRustServerByIdForGuild } from "../db/rustServers.js";
import { listRustServersForGuild } from "../db/rustServers.js";
import { notifyGuildWebPush } from "../push/webPushNotify.js";
import { updateKothMessage } from "./announce.js";
import { parseGateCoordTriple, runKothWaves } from "./runner.js";

const LOBBY_MAX_MINUTES = 15;
const MIN_GATE_FILL_RATIO = 0.5;

const tickLocks = new Set<number>();
let cronJob: cron.ScheduledTask | null = null;

function minGatesRequired(totalGates: number): number {
  return Math.max(1, Math.ceil(totalGates * MIN_GATE_FILL_RATIO));
}

async function announceText(client: Client, channelId: string, text: string): Promise<void> {
  const ch = await client.channels.fetch(channelId).catch(() => null);
  if (!ch || !ch.isTextBased() || !("send" in ch)) return;
  await ch.send({ content: text });
}

export async function startKothMatchFromLobby(
  pool: Pool,
  client: Client,
  guildRowId: number,
  rustServerId: number,
  eventId: number
): Promise<boolean> {
  const cfg = await getKothConfig(pool, guildRowId, rustServerId);
  if (!cfg?.messageId || !isKothAutomationConfigComplete(cfg)) return false;

  const gate1Raw = await getGateCoord(pool, guildRowId, rustServerId, 1);
  const gate1Xyz = gate1Raw ? parseGateCoordTriple(gate1Raw) : null;
  if (!gate1Xyz) return false;

  const waves = cfg.waves!;
  const durationMin = cfg.durationPerWaveMin!;
  const kitName = cfg.kitName!.trim();

  const srv = await getRustServerByIdForGuild(pool, guildRowId, rustServerId);
  if (!srv) return false;

  let password: string;
  try {
    password = decryptSecret(srv.rcon_password_encrypted, config.encryptionKeyHex);
  } catch {
    return false;
  }

  const started = await startKothEvent(pool, eventId, durationMin, waves, kitName);
  if (!started) return false;

  void notifyGuildWebPush(pool, guildRowId, rustServerId, {
    title: "Grindset",
    body: "KOTH Started. Join now!",
    tag: `koth-${eventId}`,
  });

  void runKothWaves({
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
    waves,
    durationPerWaveMin: durationMin,
    kitName,
    gateFrequency: cfg.gateFrequency,
    gate1Xyz,
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
  const cfg = await getKothConfig(pool, guildRowId, rustServerId);
  await deleteKothEventRow(pool, guildRowId, eventId);
  if (cfg?.howOftenHours && cfg.howOftenHours > 0) {
    await mergeKothConfig(pool, guildRowId, rustServerId, {
      nextLobbyAtMs: Date.now() + cfg.howOftenHours * 3600_000,
    });
  }
  if (cfg?.announcementChannelId) {
    await announceText(
      client,
      cfg.announcementChannelId,
      `**KOTH lobby cancelled** — ${reason} Next lobby is scheduled per your **How often** interval.`
    );
  }
}

async function openAutomatedLobby(pool: Pool, client: Client, guildRowId: number, rustServerId: number): Promise<void> {
  const cfg = await getKothConfig(pool, guildRowId, rustServerId);
  if (!cfg || !isKothAutomationConfigComplete(cfg) || !cfg.messageId) {
    console.warn("[koth-automation] open lobby skipped — incomplete config", rustServerId);
    return;
  }

  const gate1Raw = await getGateCoord(pool, guildRowId, rustServerId, 1);
  if (!gate1Raw || !parseGateCoordTriple(gate1Raw)) {
    console.warn("[koth-automation] Gate 1 coords missing — open lobby skipped", rustServerId);
    await mergeKothConfig(pool, guildRowId, rustServerId, {
      nextLobbyAtMs: Date.now() + 60 * 60_000,
    });
    return;
  }

  const existing = await getActiveKothEvent(pool, guildRowId, rustServerId);
  if (existing) return;

  const lobby = await ensureLobbyEventForJoin(pool, guildRowId, rustServerId);
  if (!lobby.ok) return;

  await setKothLobbyEndsInMinutes(pool, lobby.eventId, LOBBY_MAX_MINUTES);
  await mergeKothConfig(pool, guildRowId, rustServerId, { nextLobbyAtMs: null });

  const servers = await listRustServersForGuild(pool, guildRowId);
  const srv = servers.find((s) => String(s.id) === String(rustServerId));
  const serverName = srv?.nickname ?? "Server";

  const views = await listGateViews(pool, lobby.eventId);
  await updateKothMessage(
    client,
    cfg.announcementChannelId,
    cfg.messageId,
    serverName,
    serverName,
    views.map((g) => ({ gateNumber: g.gateNumber, clanName: g.clanName, members: g.members })),
    lobby.eventId,
    null
  );

  void notifyGuildWebPush(pool, guildRowId, rustServerId, {
    title: "Grindset",
    body: "KOTH lobby is open. Join now!",
    tag: `koth-lobby-${lobby.eventId}`,
  });
}

async function processLobbyPhase(
  pool: Pool,
  client: Client,
  guildRowId: number,
  rustServerId: number,
  eventId: number
): Promise<void> {
  const cfg = await getKothConfig(pool, guildRowId, rustServerId);
  const meta = await getActiveKothEventMeta(pool, guildRowId, rustServerId);
  if (!cfg || !meta || meta.status !== "lobby" || meta.id !== eventId) return;

  if (meta.lobbyEndsAtMs == null && cfg.automationStarted) {
    await setKothLobbyEndsInMinutes(pool, eventId, LOBBY_MAX_MINUTES);
    return;
  }

  const gatesTotal = cfg.gates;
  const assigned = await countAssignedGatesForEvent(pool, eventId);
  const members = await countEventMembers(pool, eventId);
  const lobbyEndsAt = meta.lobbyEndsAtMs;
  const now = Date.now();

  const allGatesFull = assigned >= gatesTotal && members >= 1;

  if (allGatesFull) {
    const ok = await startKothMatchFromLobby(pool, client, guildRowId, rustServerId, eventId);
    if (!ok) {
      await cancelAutomatedLobby(
        pool,
        client,
        guildRowId,
        rustServerId,
        eventId,
        "could not start the match (check RCON / config)."
      );
    }
    return;
  }

  if (lobbyEndsAt == null || now < lobbyEndsAt) return;

  if (members < 1 || assigned === 0) {
    await cancelAutomatedLobby(pool, client, guildRowId, rustServerId, eventId, "no players joined.");
    return;
  }

  const minGates = minGatesRequired(gatesTotal);
  if (assigned < minGates) {
    await cancelAutomatedLobby(
      pool,
      client,
      guildRowId,
      rustServerId,
      eventId,
      `fewer than **${MIN_GATE_FILL_RATIO * 100}%** of gates had clans after ${LOBBY_MAX_MINUTES} minutes.`
    );
    return;
  }

  const ok = await startKothMatchFromLobby(pool, client, guildRowId, rustServerId, eventId);
  if (!ok) {
    await cancelAutomatedLobby(pool, client, guildRowId, rustServerId, eventId, "failed to start after lobby window.");
  }
}

export async function tickKothAutomation(pool: Pool, client: Client): Promise<void> {
  const servers = await listKothAutomationServers(pool);
  for (const { guildRowId, rustServerId } of servers) {
    if (tickLocks.has(rustServerId)) continue;
    tickLocks.add(rustServerId);
    try {
      const cfg = await getKothConfig(pool, guildRowId, rustServerId);
      if (!cfg?.automationStarted || !isKothAutomationConfigComplete(cfg)) continue;

      const active = await getActiveKothEvent(pool, guildRowId, rustServerId);
      if (active?.status === "running") continue;

      if (active?.status === "lobby") {
        await processLobbyPhase(pool, client, guildRowId, rustServerId, active.id);
        continue;
      }

      const nextAt = cfg.nextLobbyAtMs;
      if (nextAt != null && Date.now() >= nextAt) {
        await openAutomatedLobby(pool, client, guildRowId, rustServerId);
      }
    } catch (e) {
      console.error(`[koth-automation] tick failed for server ${rustServerId}:`, e);
    } finally {
      tickLocks.delete(rustServerId);
    }
  }
}

export function initKothAutomationScheduler(pool: Pool, client: Client): void {
  if (cronJob) return;
  cronJob = cron.schedule(
    "*/20 * * * * *",
    () => {
      void tickKothAutomation(pool, client);
    },
    { timezone: "Etc/UTC" }
  );
  void tickKothAutomation(pool, client);
}

export async function startKothAutomation(
  pool: Pool,
  guildRowId: number,
  rustServerId: number
): Promise<{ ok: true } | { ok: false; error: string }> {
  const cfg = await getKothConfig(pool, guildRowId, rustServerId);
  if (!cfg?.messageId || !isKothAutomationConfigComplete(cfg)) {
    return { ok: false, error: "Complete **/koth-setup** (including how often, waves, duration, and kit) first." };
  }
  await mergeKothConfig(pool, guildRowId, rustServerId, {
    automationStarted: true,
    nextLobbyAtMs: Date.now(),
  });
  return { ok: true };
}
