import type http from "node:http";
import { ChannelType, EmbedBuilder, TextChannel, type Client } from "discord.js";
import type { Pool } from "mysql2/promise";
import { parseWebsitePosition } from "../admin/websitePositionParse.js";
import { memberHasAdminRole } from "../admin/guildAdmin.js";
import { normalizeCoordinates } from "../commands/shared/gatePositionOption.js";
import { buildClanJoinEmbed, buildJoinClanButtonRow } from "../clans/ui.js";
import { config } from "../config.js";
import { MAX_RUST_SERVERS_PER_GUILD } from "../constants.js";
import { decryptSecret } from "../crypto/passwordVault.js";
import { upsertClanSettings } from "../db/clans.js";
import { getDiscordGuildIdByRowId, getOrCreateGuildRow } from "../db/guilds.js";
import { insertEventSnapshot } from "../db/eventSnapshots.js";
import {
  countEventMembers,
  ensureLobbyEventForJoin,
  getActiveKothEvent,
  getGateCoord,
  getKothConfig,
  startKothEvent,
  upsertGateCoord,
  upsertKothConfig,
} from "../db/koth.js";
import {
  countMazeEventMembers,
  ensureLobbyMazeForJoin,
  getActiveMazeEvent,
  getMazeConfig,
  listMissingMazeSpawnCoords,
  MAZE_MAX_SPAWN_POINTS,
  startMazeEvent,
  upsertMazeConfig,
  upsertMazeSpawnCoord,
} from "../db/maze.js";
import {
  deleteNuketownEventOnly,
  ensureLobbyNuketownForJoin,
  finishNuketownEvent,
  getActiveNuketownEventMeta,
  upsertNuketownConfig,
  upsertNuketownGateCoord,
} from "../db/nuketown.js";
import { deleteMatch, getMatchForServer, upsertOneV1Config, upsertOneV1GateCoord } from "../db/onev1.js";
import { getRustServerByIdForGuild, getGuildRowIdForRustServerId, listRustServersForGuild } from "../db/rustServers.js";
import { performMazeDelete } from "../maze/mazeEndActions.js";
import { performKothEnd } from "../koth/kothEndActions.js";
import { renderKothEmbed } from "../koth/render.js";
import { parseGateCoordTriple, runKothWaves } from "../koth/runner.js";
import { renderMazeEmbed } from "../maze/render.js";
import { runMazeEvent } from "../maze/runner.js";
import { renderNuketownEmbed } from "../nuketown/render.js";
import { scheduleNuketownLobbyWatch } from "../nuketown/nuketownLobbyWatch.js";
import { requestStopNuketown } from "../nuketown/runner.js";
import { onev1KillTracker } from "../onev1/killTracker.js";
import { onev1RespawnWait } from "../onev1/respawnWait.js";
import { requestStopOneV1 } from "../onev1/runner.js";
import { KOTH_RCON_SETUP, MAZE_RCON_SETUP, runSayRcon } from "../rcon/eventBroadcasts.js";
import { notifyGuildWebPush } from "../push/webPushNotify.js";

function json(res: http.ServerResponse, status: number, body: unknown): void {
  const data = Buffer.from(JSON.stringify(body), "utf8");
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Length", data.byteLength);
  res.end(data);
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function readJsonBody(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return null;
  return JSON.parse(raw) as unknown;
}

async function assertWebsiteAdmin(
  client: Client,
  pool: Pool,
  discordUserId: string,
  rustServerId: number
): Promise<{ guildRowId: number; discordGuildId: string } | null> {
  const guildRowId = await getGuildRowIdForRustServerId(pool, rustServerId);
  if (guildRowId === null) return null;
  const discordGuildId = await getDiscordGuildIdByRowId(pool, guildRowId);
  if (!discordGuildId) return null;
  const g = client.guilds.cache.get(discordGuildId);
  if (!g) return null;
  const member = await g.members.fetch(discordUserId).catch(() => null);
  if (!member) return null;
  if (!memberHasAdminRole(member, g)) return null;
  return { guildRowId, discordGuildId };
}

export async function handleAdminPanelRoutes(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  pathname: string,
  client: Client,
  pool: Pool
): Promise<boolean> {
  const method = (req.method ?? "GET").toUpperCase();
  const discordUserId = String(req.headers["x-discord-user-id"] ?? "").trim();
  if (!discordUserId) {
    json(res, 401, { ok: false, error: "Missing X-Discord-User-Id" });
    return true;
  }

  if (pathname === "/api/admin/eligible" && method === "GET") {
    const guilds: Array<{
      discordGuildId: string;
      name: string;
      iconUrl: string | null;
      rustServers: Array<{ id: number; nickname: string; slug: string }>;
    }> = [];

    for (const g of client.guilds.cache.values()) {
      try {
        const member = await g.members.fetch(discordUserId).catch(() => null);
        if (!member || !memberHasAdminRole(member, g)) continue;
        const guildRowId = await getOrCreateGuildRow(pool, g.id);
        const rustServers = await listRustServersForGuild(pool, guildRowId);
        guilds.push({
          discordGuildId: g.id,
          name: g.name,
          iconUrl: g.iconURL({ size: 64 }),
          rustServers: rustServers.map((s) => ({
            id: s.id,
            nickname: s.nickname,
            slug: slugify(`${s.id}-${s.nickname}`),
          })),
        });
      } catch (e) {
        console.error("[admin eligible] guild", g.id, e);
      }
    }

    json(res, 200, { ok: true, eligible: guilds.length > 0, guilds });
    return true;
  }

  const serverMatch = /^\/api\/admin\/server\/(\d+)(?:\/(.*))?$/.exec(pathname);
  if (!serverMatch) return false;

  const rustServerId = Number.parseInt(serverMatch[1] ?? "", 10);
  if (!Number.isFinite(rustServerId) || rustServerId < 1) {
    json(res, 400, { ok: false, error: "Invalid server id" });
    return true;
  }

  const ctx = await assertWebsiteAdmin(client, pool, discordUserId, rustServerId);
  if (!ctx) {
    json(res, 403, { ok: false, error: "Forbidden" });
    return true;
  }

  const { guildRowId, discordGuildId } = ctx;
  const guild = client.guilds.cache.get(discordGuildId);
  if (!guild) {
    json(res, 503, { ok: false, error: "Guild not available" });
    return true;
  }

  const rest = serverMatch[2] ?? "";

  if (rest === "meta" && method === "GET") {
    const channels = guild.channels.cache
      .filter((c) => c.type === ChannelType.GuildText || c.type === ChannelType.GuildAnnouncement)
      .map((c) => ({ id: c.id, name: c.name }))
      .sort((a, b) => a.name.localeCompare(b.name));
    const roles = guild.roles.cache
      .filter((r) => r.id !== guild.id)
      .map((r) => ({ id: r.id, name: r.name }))
      .sort((a, b) => a.name.localeCompare(b.name));
    json(res, 200, { ok: true, channels, roles });
    return true;
  }

  if (rest === "koth/events" && method === "GET") {
    const ev = await getActiveKothEvent(pool, guildRowId, rustServerId);
    const list = ev ? [{ id: ev.id, status: ev.status }] : [];
    json(res, 200, { ok: true, events: list });
    return true;
  }

  if (rest === "koth/end" && method === "POST") {
    const active = await getActiveKothEvent(pool, guildRowId, rustServerId);
    if (!active) {
      json(res, 400, { ok: false, error: "No active KOTH for this server." });
      return true;
    }
    const result = await performKothEnd(pool, guildRowId, rustServerId);
    if (!result.ok) {
      json(res, 500, { ok: false, error: result.error });
      return true;
    }
    json(res, 200, { ok: true, ended: result.hadActive });
    return true;
  }

  if (rest === "koth/setup" && method === "POST") {
    const raw = await readJsonBody(req);
    const body = raw as {
      announcementChannelId?: string;
      gates?: number;
      gateFrequency?: number;
      announcementRoleId?: string;
    };
    const announcementChannelId = String(body.announcementChannelId ?? "").trim();
    const gates = Number(body.gates);
    const gateFrequency = Number(body.gateFrequency);
    const announcementRoleId = String(body.announcementRoleId ?? "").trim();
    if (!announcementChannelId || !announcementRoleId || !Number.isFinite(gates) || gates < 1 || gates > 20) {
      json(res, 400, { ok: false, error: "Invalid channel, gates (1–20), or role." });
      return true;
    }
    if (!Number.isFinite(gateFrequency) || gateFrequency < 1000 || gateFrequency > 9999) {
      json(res, 400, { ok: false, error: "Gate frequency must be 1000–9999." });
      return true;
    }

    const srv = await getRustServerByIdForGuild(pool, guildRowId, rustServerId);
    if (!srv) {
      json(res, 404, { ok: false, error: "Server not found" });
      return true;
    }

    const ch = await guild.channels.fetch(announcementChannelId).catch(() => null);
    if (!ch || !(ch instanceof TextChannel)) {
      json(res, 400, { ok: false, error: "Pick a text channel." });
      return true;
    }

    const role = await guild.roles.fetch(announcementRoleId).catch(() => null);
    if (!role) {
      json(res, 400, { ok: false, error: "Invalid role." });
      return true;
    }

    const lobby = await ensureLobbyEventForJoin(pool, guildRowId, rustServerId);
    const eventNumber = lobby.ok ? lobby.eventId : null;
    const embed = renderKothEmbed(srv.nickname, srv.nickname, [], eventNumber, null);
    const sent = await ch.send({ content: `<@&${role.id}>`, embeds: [embed] });

    await upsertKothConfig(pool, guildRowId, rustServerId, ch.id, role.id, gates, gateFrequency, sent.id);

    void notifyGuildWebPush(pool, guildRowId, rustServerId, {
      title: "Grindset",
      body: "KOTH lobby is open. Join now!",
      tag: `koth-lobby-${lobby.ok ? lobby.eventId : "setup"}`,
    });

    try {
      const rustRow = await getRustServerByIdForGuild(pool, guildRowId, rustServerId);
      if (rustRow) {
        const rconPassword = decryptSecret(rustRow.rcon_password_encrypted, config.encryptionKeyHex);
        void runSayRcon(rustRow.id, rustRow.server_ip, rustRow.rcon_port, rconPassword, KOTH_RCON_SETUP, "koth-setup");
      }
    } catch (err) {
      console.error("[admin koth-setup] say failed:", err);
    }

    json(res, 200, { ok: true, messageId: sent.id });
    return true;
  }

  if (rest === "koth/start" && method === "POST") {
    const raw = await readJsonBody(req);
    const body = raw as { waves?: number; durationMinutes?: number; kitName?: string };
    const waves = Number(body.waves);
    const durationMin = Number(body.durationMinutes);
    const kitName = String(body.kitName ?? "").trim();

    if (!Number.isFinite(waves) || waves < 1 || waves > 50) {
      json(res, 400, { ok: false, error: "Waves must be 1–50." });
      return true;
    }
    if (!Number.isFinite(durationMin) || durationMin < 1 || durationMin > 120) {
      json(res, 400, { ok: false, error: "Duration must be 1–120 minutes." });
      return true;
    }
    if (!kitName) {
      json(res, 400, { ok: false, error: "Kit name required." });
      return true;
    }

    const cfg = await getKothConfig(pool, guildRowId, rustServerId);
    if (!cfg || !cfg.messageId) {
      json(res, 400, { ok: false, error: "Run KOTH setup first." });
      return true;
    }

    const gate1Raw = await getGateCoord(pool, guildRowId, rustServerId, 1);
    const gate1Xyz = gate1Raw ? parseGateCoordTriple(gate1Raw) : null;
    if (!gate1Xyz) {
      json(res, 400, { ok: false, error: "KOTH Gate 1 position required (/manage-positions)." });
      return true;
    }

    const active = await getActiveKothEvent(pool, guildRowId, rustServerId);
    if (!active || active.status !== "lobby") {
      json(res, 400, { ok: false, error: "Need an active lobby and participants." });
      return true;
    }

    const members = await countEventMembers(pool, active.id);
    if (members < 1) {
      json(res, 400, { ok: false, error: "At least one player must /koth-join first." });
      return true;
    }

    const srv = await getRustServerByIdForGuild(pool, guildRowId, rustServerId);
    if (!srv) {
      json(res, 404, { ok: false, error: "Server not found" });
      return true;
    }

    let password: string;
    try {
      password = decryptSecret(srv.rcon_password_encrypted, config.encryptionKeyHex);
    } catch {
      json(res, 500, { ok: false, error: "RCON decrypt failed" });
      return true;
    }

    const started = await startKothEvent(pool, active.id, durationMin, waves, kitName);
    if (!started) {
      json(res, 409, { ok: false, error: "Could not start KOTH." });
      return true;
    }

    void notifyGuildWebPush(pool, guildRowId, rustServerId, {
      title: "Grindset",
      body: "KOTH Started. Join now!",
      tag: `koth-${active.id}`,
    });

    void runKothWaves({
      client,
      pool,
      guildRowId,
      rustServerId,
      eventId: active.id,
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

    json(res, 200, { ok: true, started: true });
    return true;
  }

  if (rest === "maze/events" && method === "GET") {
    const ev = await getActiveMazeEvent(pool, guildRowId, rustServerId);
    const list = ev ? [{ id: ev.id, status: ev.status }] : [];
    json(res, 200, { ok: true, events: list });
    return true;
  }

  if (rest === "maze/setup" && method === "POST") {
    const raw = await readJsonBody(req);
    const body = raw as {
      announcementChannelId?: string;
      spawnPoints?: number;
      announcementRoleId?: string;
    };
    const announcementChannelId = String(body.announcementChannelId ?? "").trim();
    const spawnPoints = Number(body.spawnPoints);
    const announcementRoleId = String(body.announcementRoleId ?? "").trim();
    if (!announcementChannelId || !announcementRoleId || !Number.isFinite(spawnPoints)) {
      json(res, 400, { ok: false, error: "Channel, spawn points, and role required." });
      return true;
    }
    if (spawnPoints < 1 || spawnPoints > MAZE_MAX_SPAWN_POINTS) {
      json(res, 400, { ok: false, error: `Spawn points must be 1–${MAZE_MAX_SPAWN_POINTS}.` });
      return true;
    }

    const srv = await getRustServerByIdForGuild(pool, guildRowId, rustServerId);
    if (!srv) {
      json(res, 404, { ok: false, error: "Server not found" });
      return true;
    }

    const ch = await guild.channels.fetch(announcementChannelId).catch(() => null);
    if (!ch || !(ch instanceof TextChannel)) {
      json(res, 400, { ok: false, error: "Pick a text channel." });
      return true;
    }

    const role = await guild.roles.fetch(announcementRoleId).catch(() => null);
    if (!role) {
      json(res, 400, { ok: false, error: "Invalid role." });
      return true;
    }

    const embed = renderMazeEmbed(srv.nickname, srv.nickname, [], null, null);
    const sent = await ch.send({ content: `<@&${role.id}>`, embeds: [embed] });

    await upsertMazeConfig(pool, guildRowId, rustServerId, ch.id, role.id, spawnPoints, sent.id);
    await ensureLobbyMazeForJoin(pool, guildRowId, rustServerId);

    void notifyGuildWebPush(pool, guildRowId, rustServerId, {
      title: "Grindset",
      body: "Maze lobby is open. Join now!",
      tag: "maze-lobby-setup",
    });

    try {
      const rustRow = await getRustServerByIdForGuild(pool, guildRowId, rustServerId);
      if (rustRow) {
        const rconPassword = decryptSecret(rustRow.rcon_password_encrypted, config.encryptionKeyHex);
        void runSayRcon(rustRow.id, rustRow.server_ip, rustRow.rcon_port, rconPassword, MAZE_RCON_SETUP, "maze-setup");
      }
    } catch (err) {
      console.error("[admin maze-setup] say failed:", err);
    }

    json(res, 200, { ok: true, messageId: sent.id });
    return true;
  }

  if (rest === "maze/start" && method === "POST") {
    const raw = await readJsonBody(req);
    const body = raw as { respawn?: string; durationMinutes?: number; kitName?: string };
    const respawnRaw = String(body.respawn ?? "").toLowerCase();
    const durationMin = Number(body.durationMinutes);
    const kitName = String(body.kitName ?? "").trim();

    if (respawnRaw !== "yes" && respawnRaw !== "no") {
      json(res, 400, { ok: false, error: 'respawn must be "yes" or "no".' });
      return true;
    }
    if (!Number.isFinite(durationMin) || durationMin < 1 || durationMin > 180) {
      json(res, 400, { ok: false, error: "Duration must be 1–180 minutes." });
      return true;
    }
    if (!kitName) {
      json(res, 400, { ok: false, error: "Kit name required." });
      return true;
    }

    const cfg = await getMazeConfig(pool, guildRowId, rustServerId);
    if (!cfg || !cfg.messageId) {
      json(res, 400, { ok: false, error: "Run Maze setup first." });
      return true;
    }

    const active = await getActiveMazeEvent(pool, guildRowId, rustServerId);
    if (!active || active.status !== "lobby") {
      json(res, 400, { ok: false, error: "Need an active maze lobby with /maze-join players." });
      return true;
    }

    const members = await countMazeEventMembers(pool, active.id);
    if (members < 1) {
      json(res, 400, { ok: false, error: "At least one player must /maze-join first." });
      return true;
    }

    const missingCoords = await listMissingMazeSpawnCoords(pool, guildRowId, rustServerId, cfg.spawnPoints);
    if (missingCoords.length > 0) {
      json(res, 400, {
        ok: false,
        error: `Missing maze spawn coordinates for: ${missingCoords.join(", ")}. Use Manage Positions.`,
      });
      return true;
    }

    const srv = await getRustServerByIdForGuild(pool, guildRowId, rustServerId);
    if (!srv) {
      json(res, 404, { ok: false, error: "Server not found" });
      return true;
    }

    let password: string;
    try {
      password = decryptSecret(srv.rcon_password_encrypted, config.encryptionKeyHex);
    } catch {
      json(res, 500, { ok: false, error: "RCON decrypt failed" });
      return true;
    }

    const respawnEnabled = respawnRaw === "yes";
    const started = await startMazeEvent(pool, active.id, durationMin, kitName, respawnEnabled);
    if (!started) {
      json(res, 409, { ok: false, error: "Could not start maze." });
      return true;
    }

    void notifyGuildWebPush(pool, guildRowId, rustServerId, {
      title: "Grindset",
      body: "Maze Started. Join now!",
      tag: `maze-${active.id}`,
    });

    void runMazeEvent({
      client,
      pool,
      guildRowId,
      rustServerId,
      eventId: active.id,
      announcementChannelId: cfg.announcementChannelId,
      serverNickname: srv.nickname,
      host: srv.server_ip,
      port: srv.rcon_port,
      password,
      durationMinutes: durationMin,
      kitName,
      spawnPointCount: cfg.spawnPoints,
    });

    json(res, 200, { ok: true, started: true });
    return true;
  }

  if (rest === "maze/end" && method === "POST") {
    const result = await performMazeDelete(pool, guildRowId, rustServerId);
    if (!result.ok) {
      json(res, 500, { ok: false, error: result.error });
      return true;
    }
    json(res, 200, { ok: true, ended: result.hadActive, stoppedRunner: result.stoppedRunner });
    return true;
  }

  if (rest === "nuketown/events" && method === "GET") {
    const meta = await getActiveNuketownEventMeta(pool, guildRowId, rustServerId);
    const list = meta ? [{ id: meta.id, status: meta.status }] : [];
    json(res, 200, { ok: true, events: list });
    return true;
  }

  if (rest === "nuketown/setup" && method === "POST") {
    const raw = await readJsonBody(req);
    const body = raw as {
      announcementChannelId?: string;
      announcementRoleId?: string;
      gates?: number;
      gateFrequency?: number;
      teamLimit?: number;
      kitName?: string;
    };
    const announcementChannelId = String(body.announcementChannelId ?? "").trim();
    const announcementRoleId = String(body.announcementRoleId ?? "").trim();
    const gates = Number(body.gates);
    const gateFrequency = Number(body.gateFrequency);
    const teamLimit = Number(body.teamLimit);
    const kitName = String(body.kitName ?? "").trim();

    if (!announcementChannelId || !announcementRoleId || !kitName) {
      json(res, 400, { ok: false, error: "Channel, role, and kit name required." });
      return true;
    }
    if (!Number.isFinite(gates) || gates < 2 || gates > 20) {
      json(res, 400, { ok: false, error: "Gates must be 2–20." });
      return true;
    }
    if (!Number.isFinite(gateFrequency) || gateFrequency < 1000 || gateFrequency > 9999) {
      json(res, 400, { ok: false, error: "Gate frequency must be 1000–9999." });
      return true;
    }
    if (!Number.isFinite(teamLimit) || teamLimit < 1 || teamLimit > 5) {
      json(res, 400, { ok: false, error: "Team limit must be 1–5." });
      return true;
    }

    const srv = await getRustServerByIdForGuild(pool, guildRowId, rustServerId);
    if (!srv) {
      json(res, 404, { ok: false, error: "Server not found" });
      return true;
    }

    const channel = await guild.channels.fetch(announcementChannelId).catch(() => null);
    if (!channel || !(channel instanceof TextChannel)) {
      json(res, 400, { ok: false, error: "Pick a text channel." });
      return true;
    }

    const role = await guild.roles.fetch(announcementRoleId).catch(() => null);
    if (!role) {
      json(res, 400, { ok: false, error: "Invalid role." });
      return true;
    }

    const lobby = await ensureLobbyNuketownForJoin(pool, guildRowId, rustServerId, 5);
    if (!lobby.ok) {
      json(res, 400, { ok: false, error: "Nuketown is already running on this server." });
      return true;
    }

    const meta = await getActiveNuketownEventMeta(pool, guildRowId, rustServerId);
    const lobbyEndsAtMs = meta?.lobbyEndsAtMs ?? Date.now() + 5 * 60_000;
    const eventNumber = meta?.id ?? lobby.eventId;

    const sent = await channel.send({
      content: `<@&${role.id}>`,
      embeds: [renderNuketownEmbed(srv.nickname, srv.nickname, [], lobbyEndsAtMs, teamLimit, eventNumber)],
    });

    await upsertNuketownConfig(
      pool,
      guildRowId,
      rustServerId,
      channel.id,
      role.id,
      gates,
      gateFrequency,
      teamLimit,
      kitName,
      sent.id
    );

    void notifyGuildWebPush(pool, guildRowId, rustServerId, {
      title: "Grindset",
      body: "Nuketown lobby is open. Join now!",
      tag: `nuketown-lobby-${eventNumber}`,
    });

    scheduleNuketownLobbyWatch(client, pool, guildRowId, rustServerId, channel.id, kitName, teamLimit, gateFrequency);

    json(res, 200, { ok: true, messageId: sent.id });
    return true;
  }

  if (rest === "nuketown/delete" && method === "POST") {
    const active = await getActiveNuketownEventMeta(pool, guildRowId, rustServerId);
    if (!active) {
      json(res, 400, { ok: false, error: "No active Nuketown for this server." });
      return true;
    }

    const stopped = requestStopNuketown(rustServerId);

    try {
      await insertEventSnapshot({
        pool,
        guildRowId,
        rustServerId,
        type: "nuketown",
        payload: { kind: "nuketown", cancelled: true, reason: "Deleted by admin (website).", deletedAtMs: Date.now() },
      });
    } catch (err) {
      console.error("[admin nuketown-delete] snapshot failed:", err);
    }

    await finishNuketownEvent(pool, active.id).catch(() => {});
    await deleteNuketownEventOnly(pool, active.id);

    json(res, 200, { ok: true, stoppedRunner: stopped });
    return true;
  }

  if (rest === "onev1/match" && method === "GET") {
    const match = await getMatchForServer(pool, rustServerId);
    json(res, 200, {
      ok: true,
      match: match ? { id: match.id, status: match.status } : null,
    });
    return true;
  }

  if (rest === "onev1/setup" && method === "POST") {
    const raw = await readJsonBody(req);
    const body = raw as { announcementChannelId?: string; enabled?: boolean; kitName?: string; gateFrequency?: number };
    const announcementChannelId = String(body.announcementChannelId ?? "").trim();
    const enabled = Boolean(body.enabled);
    const kitName = String(body.kitName ?? "").trim();
    const gateFrequency = Number(body.gateFrequency);

    if (!announcementChannelId || !kitName) {
      json(res, 400, { ok: false, error: "Channel and kit name required." });
      return true;
    }
    if (!Number.isFinite(gateFrequency) || gateFrequency < 1000 || gateFrequency > 9999) {
      json(res, 400, { ok: false, error: "Gate frequency must be 1000–9999." });
      return true;
    }

    const servers = await listRustServersForGuild(pool, guildRowId);
    if (!servers.some((s) => s.id === rustServerId)) {
      json(res, 400, { ok: false, error: "Invalid server." });
      return true;
    }

    const channel = await guild.channels.fetch(announcementChannelId).catch(() => null);
    if (!channel || !(channel instanceof TextChannel)) {
      json(res, 400, { ok: false, error: "Pick a text channel." });
      return true;
    }

    await upsertOneV1Config(pool, guildRowId, rustServerId, channel.id, enabled, kitName, gateFrequency);
    json(res, 200, { ok: true });
    return true;
  }

  if (rest === "onev1/delete" && method === "POST") {
    const match = await getMatchForServer(pool, rustServerId);
    if (!match) {
      json(res, 400, { ok: false, error: "No pending or active 1v1 for this server." });
      return true;
    }

    requestStopOneV1(rustServerId);
    onev1RespawnWait.cancel(rustServerId);
    onev1KillTracker.releasePendingRound(rustServerId);
    await deleteMatch(pool, match.id);

    try {
      if (match.messageId) {
        const ch = await client.channels.fetch(match.channelId).catch(() => null);
        if (ch?.isTextBased() && "messages" in ch) {
          const msg = await ch.messages.fetch(match.messageId).catch(() => null);
          if (msg) {
            await msg.edit({
              embeds: [
                new EmbedBuilder()
                  .setTitle("⚔️ 1v1 — cancelled")
                  .setDescription("An admin removed this 1v1 via the website admin panel.")
                  .setColor(0xed4245),
              ],
              components: [],
            });
          }
        }
      }
    } catch {
      /* channel/message may be gone */
    }

    json(res, 200, { ok: true, removedId: match.id });
    return true;
  }

  if (rest === "clan/setup" && method === "POST") {
    const raw = await readJsonBody(req);
    const body = raw as { enabled?: boolean; maxMembers?: number; channelId?: string };
    const enabled = Boolean(body.enabled);
    const maxMembers = Number(body.maxMembers);
    const channelId = String(body.channelId ?? "").trim();

    if (!channelId) {
      json(res, 400, { ok: false, error: "Channel required." });
      return true;
    }
    if (!Number.isFinite(maxMembers) || maxMembers < 1 || maxMembers > 20) {
      json(res, 400, { ok: false, error: "Max members must be 1–20." });
      return true;
    }

    const servers = await listRustServersForGuild(pool, guildRowId);
    if (servers.length < 1) {
      json(res, 400, { ok: false, error: "No Rust servers configured for this Discord." });
      return true;
    }
    if (servers.length > MAX_RUST_SERVERS_PER_GUILD) {
      console.warn("[admin clan-setup] server count exceeded cap.");
    }
    if (!servers.some((s) => s.id === rustServerId)) {
      json(res, 400, { ok: false, error: "This page must match a Rust server in your guild." });
      return true;
    }

    const channel = await guild.channels.fetch(channelId).catch(() => null);
    if (!channel || !(channel instanceof TextChannel)) {
      json(res, 400, { ok: false, error: "Pick a text channel." });
      return true;
    }

    const joinEmbed = buildClanJoinEmbed(enabled, maxMembers);
    const row = buildJoinClanButtonRow(!enabled);
    const sent = await channel.send({ embeds: [joinEmbed], components: [row] });

    await upsertClanSettings(pool, guildRowId, enabled, maxMembers, channel.id, sent.id);
    json(res, 200, { ok: true, messageId: sent.id });
    return true;
  }

  if (rest === "positions" && method === "POST") {
    const raw = await readJsonBody(req);
    const body = raw as { position?: string; coordinates?: string };
    const positionRaw = String(body.position ?? "").trim();
    const coordinatesRaw = String(body.coordinates ?? "").trim();

    const coordNorm = normalizeCoordinates(coordinatesRaw);
    if (!coordNorm) {
      json(res, 400, { ok: false, error: "Provide three numbers: x y z (spaces or commas)." });
      return true;
    }

    const parsed = parseWebsitePosition(positionRaw);
    if (!parsed) {
      json(res, 400, {
        ok: false,
        error:
          "Invalid position label. Use e.g. KOTH Gate 1, Maze spawn-point 1, Nuketown Gate 1, 1v1 Gate 1.",
      });
      return true;
    }

    if (parsed.kind === "koth_gate") {
      await upsertGateCoord(pool, guildRowId, rustServerId, parsed.gate, coordNorm);
    } else if (parsed.kind === "maze_spawn") {
      await upsertMazeSpawnCoord(pool, guildRowId, rustServerId, parsed.spawn, coordNorm);
    } else if (parsed.kind === "nuketown_gate") {
      await upsertNuketownGateCoord(pool, guildRowId, rustServerId, parsed.gate, coordNorm);
    } else {
      await upsertOneV1GateCoord(pool, guildRowId, rustServerId, parsed.gate, coordNorm);
    }

    json(res, 200, { ok: true, saved: parsed, coordinates: coordNorm });
    return true;
  }

  return false;
}
