import cron from "node-cron";
import type { Client } from "discord.js";
import type { Pool } from "mysql2/promise";
import { config } from "../config.js";
import { decryptSecret } from "../crypto/passwordVault.js";
import {
  ensureLobbyNuketownForJoin,
  getActiveNuketownEventMeta,
  getNuketownConfig,
  listNuketownParticipants,
  listNuketownTeams,
  setNuketownLobbyEndsAtNow,
  startNuketownEvent,
} from "../db/nuketown.js";
import { getRustServerByIdForGuild, listRustServersForGuild } from "../db/rustServers.js";
import { notifyGuildWebPush } from "../push/webPushNotify.js";
import { updateNuketownMessage } from "./announce.js";
import { runNuketownBracket } from "./runner.js";

const LOBBY_MAX_MINUTES = 15;

const tickLocks = new Set<number>();
let cronJob: cron.ScheduledTask | null = null;

function maxClansForMode(mode: "nuketown" | "tournament"): number {
  return mode === "tournament" ? 4 : 2;
}

async function areLobbyTeamsFull(pool: Pool, guildRowId: number, eventId: number, teamLimit: number): Promise<boolean> {
  const lim = Math.max(1, Math.floor(teamLimit));
  const teams = await listNuketownTeams(pool, eventId);
  if (teams.length < 2) return false;
  const participants = await listNuketownParticipants(pool, guildRowId, eventId);
  const countByClan = new Map<number, number>();
  for (const p of participants) countByClan.set(p.clanId, (countByClan.get(p.clanId) ?? 0) + 1);
  return teams.every((t) => (countByClan.get(t.clanId) ?? 0) >= lim);
}

export async function startNuketownAutomation(
  pool: Pool,
  guildRowId: number,
  rustServerId: number,
  mode: "nuketown" | "tournament"
): Promise<{ ok: true } | { ok: false; error: string }> {
  const cfg = await getNuketownConfig(pool, guildRowId, rustServerId, mode);
  if (!cfg?.messageId || !cfg.howOftenHours || cfg.howOftenHours <= 0) {
    return { ok: false, error: "Complete Nuketown setup first (including **How often** and posting the lobby message)." };
  }
  await pool.query(
    `UPDATE nuketown_configs
     SET ${mode === "tournament" ? "tournament_automation_started" : "automation_started"} = 1,
         ${mode === "tournament" ? "tournament_next_lobby_at_ms" : "next_lobby_at_ms"} = :nextMs
     WHERE guild_id = :gid AND rust_server_id = :sid`,
    { gid: guildRowId, sid: rustServerId, nextMs: Date.now() }
  );
  return { ok: true };
}

async function stopNuketownAutomation(pool: Pool, guildRowId: number, rustServerId: number, mode: "nuketown" | "tournament") {
  await pool.query(
    `UPDATE nuketown_configs
     SET ${mode === "tournament" ? "tournament_automation_started" : "automation_started"} = 0,
         ${mode === "tournament" ? "tournament_next_lobby_at_ms" : "next_lobby_at_ms"} = NULL
     WHERE guild_id = :gid AND rust_server_id = :sid`,
    { gid: guildRowId, sid: rustServerId }
  );
}

async function openAutomatedLobby(pool: Pool, client: Client, guildRowId: number, rustServerId: number, mode: "nuketown" | "tournament") {
  const cfg = await getNuketownConfig(pool, guildRowId, rustServerId, mode);
  if (!cfg?.messageId || !cfg.howOftenHours || cfg.howOftenHours <= 0) return;

  const active = await getActiveNuketownEventMeta(pool, guildRowId, rustServerId);
  if (active) return;

  const lobby = await ensureLobbyNuketownForJoin(pool, guildRowId, rustServerId, LOBBY_MAX_MINUTES, mode);
  if (!lobby.ok) return;

  const servers = await listRustServersForGuild(pool, guildRowId);
  const srv = servers.find((s) => String(s.id) === String(rustServerId));
  const serverName = srv?.nickname ?? "Server";

  // Initial message update with countdown + mode label
  const meta = await getActiveNuketownEventMeta(pool, guildRowId, rustServerId);
  await updateNuketownMessage(
    client,
    cfg.announcementChannelId,
    cfg.messageId,
    serverName,
    serverName,
    [],
    meta?.lobbyEndsAtMs ?? null,
    cfg.teamLimit,
    mode === "tournament" ? "tournament" : "nuketown",
    meta?.id ?? lobby.eventId
  );

  void notifyGuildWebPush(pool, guildRowId, rustServerId, {
    title: "Grindset",
    body: mode === "tournament" ? "Nuketown Tournament lobby is open. Join now!" : "Nuketown lobby is open. Join now!",
    tag: `${mode}-lobby-${lobby.eventId}`,
  });
}

async function startMatchFromLobby(
  pool: Pool,
  client: Client,
  guildRowId: number,
  rustServerId: number,
  eventId: number,
  mode: "nuketown" | "tournament"
): Promise<boolean> {
  const cfg = await getNuketownConfig(pool, guildRowId, rustServerId, mode);
  if (!cfg?.messageId) return false;

  const srv = await getRustServerByIdForGuild(pool, guildRowId, rustServerId);
  if (!srv) return false;

  let password: string;
  try {
    password = decryptSecret(srv.rcon_password_encrypted, config.encryptionKeyHex);
  } catch {
    return false;
  }

  const teams = await listNuketownTeams(pool, eventId);
  if (teams.length < 2) return false;

  const participants = await listNuketownParticipants(pool, guildRowId, eventId);
  const clanMeta = new Map<number, { clanTag: string; clanName: string; clanColor: string | null }>();
  for (const p of participants) clanMeta.set(p.clanId, { clanTag: p.clanTag, clanName: p.clanName, clanColor: (p as any).clanColor ?? null });

  const bracket = {
    kind: "nuketown" as const,
    teams: teams
      .map((t) => ({
        slot: t.slot,
        clanId: t.clanId,
        clanTag: clanMeta.get(t.clanId)?.clanTag ?? "",
        clanName: clanMeta.get(t.clanId)?.clanName ?? "Clan",
        clanColor: clanMeta.get(t.clanId)?.clanColor ?? null,
      }))
      .sort((a: any, b: any) => a.slot - b.slot),
    stage: "running" as const,
    currentMatch: null,
    winners: { semi1: null, semi2: null, champion: null },
  };

  const started = await startNuketownEvent(pool, eventId, cfg.kitName, cfg.teamLimit, bracket);
  if (!started) return false;

  void runNuketownBracket({
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
    kitName: cfg.kitName,
    gateFrequency: cfg.gateFrequency,
  });
  return true;
}

async function processLobbyPhase(pool: Pool, client: Client, guildRowId: number, rustServerId: number, mode: "nuketown" | "tournament") {
  const meta = await getActiveNuketownEventMeta(pool, guildRowId, rustServerId);
  if (!meta || meta.status !== "lobby") return;
  if ((mode === "tournament" ? "tournament" : "nuketown") !== meta.mode) return;

  const cfg = await getNuketownConfig(pool, guildRowId, rustServerId, mode);
  if (!cfg?.messageId) return;

  const teams = await listNuketownTeams(pool, meta.id);
  const now = Date.now();
  const maxClans = maxClansForMode(mode);

  // Only end the lobby early when the teams are actually full (respect team limit),
  // otherwise the 2nd clan joining would instantly start the match.
  if (teams.length >= maxClans) {
    const full = await areLobbyTeamsFull(pool, guildRowId, meta.id, cfg.teamLimit);
    if (full) await setNuketownLobbyEndsAtNow(pool, meta.id);
  }

  const meta2 = await getActiveNuketownEventMeta(pool, guildRowId, rustServerId);
  if (!meta2 || meta2.status !== "lobby") return;

  // Wait until the lobby timer expires. The only early-start path is setting `lobbyEndsAt` to now
  // once all teams reach the configured team limit.
  if (meta2.lobbyEndsAtMs != null && now < meta2.lobbyEndsAtMs) return;

  if (teams.length < 2) {
    // Cancel: not enough clans.
    await stopNuketownAutomation(pool, guildRowId, rustServerId, mode);
    return;
  }

  const ok = await startMatchFromLobby(pool, client, guildRowId, rustServerId, meta2.id, mode);
  if (!ok) {
    await stopNuketownAutomation(pool, guildRowId, rustServerId, mode);
  }
}

export async function tickNuketownAutomation(pool: Pool, client: Client): Promise<void> {
  // We only run if a config row exists; easiest scan is all guild+server rows.
  const [rows] = await pool.query<any[]>(
    `SELECT guild_id AS guildRowId, rust_server_id AS rustServerId,
            automation_started AS nuketownStarted, next_lobby_at_ms AS nuketownNext,
            tournament_automation_started AS tourneyStarted, tournament_next_lobby_at_ms AS tourneyNext
     FROM nuketown_configs`
  );
  for (const r of rows) {
    const guildRowId = Number(r.guildRowId);
    const rustServerId = Number(r.rustServerId);
    if (tickLocks.has(rustServerId)) continue;
    tickLocks.add(rustServerId);
    try {
      const active = await getActiveNuketownEventMeta(pool, guildRowId, rustServerId);
      if (active?.status === "running") continue;

      if (active?.status === "lobby") {
        await processLobbyPhase(pool, client, guildRowId, rustServerId, active.mode);
        continue;
      }

      // No active event; open next lobby if due for either mode.
      const now = Date.now();
      if (Number(r.nuketownStarted) === 1 && r.nuketownNext != null && now >= Number(r.nuketownNext)) {
        await openAutomatedLobby(pool, client, guildRowId, rustServerId, "nuketown");
        await pool.query(
          `UPDATE nuketown_configs SET next_lobby_at_ms = NULL WHERE guild_id = :gid AND rust_server_id = :sid`,
          { gid: guildRowId, sid: rustServerId }
        );
      }
      if (Number(r.tourneyStarted) === 1 && r.tourneyNext != null && now >= Number(r.tourneyNext)) {
        await openAutomatedLobby(pool, client, guildRowId, rustServerId, "tournament");
        await pool.query(
          `UPDATE nuketown_configs SET tournament_next_lobby_at_ms = NULL WHERE guild_id = :gid AND rust_server_id = :sid`,
          { gid: guildRowId, sid: rustServerId }
        );
      }
    } catch (e) {
      console.error(`[nuketown-automation] tick failed for server ${rustServerId}:`, e);
    } finally {
      tickLocks.delete(rustServerId);
    }
  }
}

export function initNuketownAutomationScheduler(pool: Pool, client: Client): void {
  if (cronJob) return;
  cronJob = cron.schedule(
    "*/20 * * * * *",
    () => {
      void tickNuketownAutomation(pool, client);
    },
    { timezone: "Etc/UTC" }
  );
  void tickNuketownAutomation(pool, client);
}

