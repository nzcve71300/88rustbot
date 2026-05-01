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
  getActiveKothEvent,
  getActiveKothEventMeta,
  getGateCoord,
  getKothConfig,
  upsertGateCoord,
  mergeKothConfig,
  isKothAutomationConfigComplete,
} from "../db/koth.js";
import {
  getActiveMazeEvent,
  getActiveMazeEventMeta,
  getMazeConfig,
  isMazeAutomationConfigComplete,
  MAZE_MAX_SPAWN_POINTS,
  mergeMazeConfig,
  upsertMazeSpawnCoord,
} from "../db/maze.js";
import {
  deleteNuketownEventOnly,
  ensureLobbyNuketownForJoin,
  finishNuketownEvent,
  getActiveNuketownEventMeta,
  getNuketownConfig,
  upsertNuketownConfig,
  upsertNuketownGateCoord,
} from "../db/nuketown.js";
import { deleteMatch, getMatchForServer, getOneV1Config, upsertOneV1Config, upsertOneV1GateCoord } from "../db/onev1.js";
import { listServerMetricsForServer } from "../db/serverMetrics.js";
import { getRustServerByIdForGuild, getGuildRowIdForRustServerId, listRustServersForGuild } from "../db/rustServers.js";
import { performMazeDelete } from "../maze/mazeEndActions.js";
import { performKothEnd } from "../koth/kothEndActions.js";
import { renderKothEmbed } from "../koth/render.js";
import { startKothAutomation } from "../koth/automation.js";
import { renderMazeEmbed } from "../maze/render.js";
import { startMazeAutomation } from "../maze/automation.js";
import { renderNuketownEmbed } from "../nuketown/render.js";
import { scheduleNuketownLobbyWatch } from "../nuketown/nuketownLobbyWatch.js";
import { startNuketownAutomation } from "../nuketown/automation.js";
import { requestStopNuketown } from "../nuketown/runner.js";
import { requestStopKoth } from "../koth/runner.js";
import { onev1KillTracker } from "../onev1/killTracker.js";
import { onev1RespawnWait } from "../onev1/respawnWait.js";
import { requestStopOneV1 } from "../onev1/runner.js";
import { KOTH_RCON_SETUP, MAZE_RCON_SETUP, runSayRcon } from "../rcon/eventBroadcasts.js";
import { notifyGuildWebPush } from "../push/webPushNotify.js";
import {
  type DockedCargoPatch,
  getDockedCargoConfig,
  isDockedCargoConfigComplete,
  mergeDockedCargoConfig,
} from "../db/dockedCargo.js";
import { startDockedCargoAutomation } from "../dockedCargo/runner.js";
import { requestStopMaze } from "../maze/runner.js";
import { type EventZoneProfile, type EventZoneType, getEventZoneConfig, markEventZoneApplied, upsertEventZoneConfig } from "../db/eventZones.js";
import { applyEventZoneConfigIfPresent } from "../zones/eventZones.js";

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

function formatHhmmFromMs(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function adaptiveYAxis(min: number, max: number): { min: number; max: number } {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { min: 0, max: 1 };
  if (min === max) {
    const pad = Math.max(1, Math.abs(min) * 0.05);
    return { min: min - pad, max: max + pad };
  }
  const pad = (max - min) * 0.08;
  return { min: min - pad, max: max + pad };
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

function isEventZoneType(s: string): s is EventZoneType {
  return s === "koth" || s === "maze" || s === "nuketown" || s === "onev1";
}

function isEventZoneProfile(s: string): s is EventZoneProfile {
  return s === "active" || s === "inactive";
}

function parse01(v: unknown): 0 | 1 | null {
  const n = typeof v === "string" ? Number.parseInt(v, 10) : typeof v === "number" ? v : NaN;
  if (n === 0) return 0;
  if (n === 1) return 1;
  return null;
}

function parseRgb(s: unknown): string | null {
  const raw = String(s ?? "").trim();
  if (!raw) return null;
  const m = /^(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})$/.exec(raw);
  if (!m) return null;
  const r = Number(m[1]);
  const g = Number(m[2]);
  const b = Number(m[3]);
  if (![r, g, b].every((x) => Number.isFinite(x) && x >= 0 && x <= 255)) return null;
  return `${r},${g},${b}`;
}

async function isEventRunningNow(pool: Pool, guildRowId: number, rustServerId: number, eventType: EventZoneType): Promise<boolean> {
  if (eventType === "koth") {
    const meta = await getActiveKothEventMeta(pool, guildRowId, rustServerId);
    return meta?.status === "running";
  }
  if (eventType === "maze") {
    const meta = await getActiveMazeEventMeta(pool, guildRowId, rustServerId);
    return meta?.status === "running";
  }
  if (eventType === "nuketown") {
    const meta = await getActiveNuketownEventMeta(pool, guildRowId, rustServerId);
    return meta?.status === "running";
  }
  // onev1
  const match = await getMatchForServer(pool, rustServerId);
  return match?.status === "running";
}

async function isEventActiveForZones(pool: Pool, guildRowId: number, rustServerId: number, eventType: EventZoneType): Promise<boolean> {
  // "Active" for zones means: lobby open OR running (so players joining lobby get the active zone).
  if (eventType === "koth") {
    const a = await getActiveKothEvent(pool, guildRowId, rustServerId);
    return a?.status === "lobby" || a?.status === "running";
  }
  if (eventType === "maze") {
    const a = await getActiveMazeEvent(pool, guildRowId, rustServerId);
    return a?.status === "lobby" || a?.status === "running";
  }
  if (eventType === "nuketown") {
    const a = await getActiveNuketownEventMeta(pool, guildRowId, rustServerId);
    return a?.status === "lobby" || a?.status === "running";
  }
  // onev1: treat pending/running as active (no lobby concept).
  const match = await getMatchForServer(pool, rustServerId);
  return match != null && (match.status === "pending" || match.status === "running");
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

  const zoneMatch = /^zones\/(koth|maze|nuketown|onev1)\/(active|inactive)$/.exec(rest);
  if (zoneMatch) {
    const eventType = zoneMatch[1] as string;
    const profile = zoneMatch[2] as string;
    if (!isEventZoneType(eventType) || !isEventZoneProfile(profile)) {
      json(res, 400, { ok: false, error: "Invalid zone type/profile" });
      return true;
    }

    if (method === "GET") {
      const cfg = await getEventZoneConfig(pool, guildRowId, rustServerId, eventType, profile);
      json(res, 200, { ok: true, config: cfg });
      return true;
    }

    if (method === "PUT") {
      const raw = await readJsonBody(req);
      const body = (raw ?? {}) as any;

      const zoneName = String(body.zoneName ?? "").trim();
      const x = Number(body.posX);
      const y = Number(body.posY);
      const z = Number(body.posZ);
      const rotation = Number(body.rotation ?? 0);
      const size = Number(body.size);
      const allowPvp = parse01(body.enablePvp);
      const allowNpc = parse01(body.enableNpcVsPlayerDamage);
      const radiationDamage = Number(body.radiationDamage ?? 0);
      const allowBuildingDamage = parse01(body.isBuildingDamageAllowed);
      const allowBuilding = parse01(body.isBuildingAllowed);
      const colorRgb = body.zoneColor != null ? parseRgb(body.zoneColor) : null;
      const enterMessage = body.enterMessage != null ? String(body.enterMessage).trim() : "";
      const leaveMessage = body.leaveMessage != null ? String(body.leaveMessage).trim() : "";

      if (!zoneName || zoneName.length > 64) {
        json(res, 400, { ok: false, error: "Zone name is required (max 64 chars)." });
        return true;
      }
      if (![x, y, z].every((n) => Number.isFinite(n))) {
        json(res, 400, { ok: false, error: "Map position must be numeric x,y,z." });
        return true;
      }
      if (!Number.isFinite(rotation)) {
        json(res, 400, { ok: false, error: "Rotation must be a number." });
        return true;
      }
      if (!Number.isFinite(size) || size < 1 || size > 100) {
        json(res, 400, { ok: false, error: "Zone size must be 1–100." });
        return true;
      }
      if (allowPvp == null || allowNpc == null || allowBuildingDamage == null || allowBuilding == null) {
        json(res, 400, { ok: false, error: "Yes/No fields must be numeric 0 or 1." });
        return true;
      }
      if (!Number.isFinite(radiationDamage) || radiationDamage < 0 || radiationDamage > 100) {
        json(res, 400, { ok: false, error: "Radiation damage must be 0–100." });
        return true;
      }
      if (body.zoneColor != null && String(body.zoneColor).trim() && !colorRgb) {
        json(res, 400, { ok: false, error: "Zone color must be R,G,B (0–255 each)." });
        return true;
      }

      await upsertEventZoneConfig(pool, guildRowId, rustServerId, {
        eventType,
        profile,
        zoneName,
        pos: { x, y, z },
        rotation,
        size: Math.floor(size),
        allowPvpDamage01: allowPvp,
        allowNpcDamage01: allowNpc,
        radiationDamage: Math.floor(radiationDamage),
        allowBuildingDamage01: allowBuildingDamage,
        allowBuilding01: allowBuilding,
        colorRgb,
        enterMessage: enterMessage ? enterMessage : null,
        leaveMessage: leaveMessage ? leaveMessage : null,
      });

      // After saving, apply the correct profile for the current server state:
      // - event active (lobby/running) => apply ACTIVE profile
      // - event inactive => apply INACTIVE profile
      let applied = false;
      const desiredProfile: EventZoneProfile = (await isEventActiveForZones(pool, guildRowId, rustServerId, eventType))
        ? "active"
        : "inactive";
      const desiredCfg = await getEventZoneConfig(pool, guildRowId, rustServerId, eventType, desiredProfile);
      if (desiredCfg) {
        const srv = await getRustServerByIdForGuild(pool, guildRowId, rustServerId);
        if (srv) {
          try {
            const password = decryptSecret(srv.rcon_password_encrypted, config.encryptionKeyHex);
            await applyEventZoneConfigIfPresent({
              pool,
              guildRowId,
              rustServerId,
              eventType,
              desired: desiredProfile,
              rcon: { host: srv.server_ip, port: srv.rcon_port, password },
            });
            applied = true;
          } catch (e) {
            console.error("[zones] apply failed:", e);
          }
        }
      }

      const saved = await getEventZoneConfig(pool, guildRowId, rustServerId, eventType, profile);
      json(res, 200, { ok: true, saved, applied });
      return true;
    }
  }

  if (rest === "koth/events" && method === "GET") {
    const ev = await getActiveKothEvent(pool, guildRowId, rustServerId);
    const list = ev ? [{ id: ev.id, status: ev.status }] : [];
    json(res, 200, { ok: true, events: list });
    return true;
  }

  if (rest === "koth/config" && method === "GET") {
    const cfg = await getKothConfig(pool, guildRowId, rustServerId);
    json(res, 200, {
      ok: true,
      config: cfg
        ? {
            announcementChannelId: cfg.announcementChannelId,
            announcementRoleId: cfg.announcementRoleId,
            gates: cfg.gates,
            gateFrequency: cfg.gateFrequency,
            teamLimit: cfg.teamLimit,
            messageId: cfg.messageId,
            howOftenHours: cfg.howOftenHours,
            waves: cfg.waves,
            durationPerWaveMin: cfg.durationPerWaveMin,
            kitName: cfg.kitName,
            automationStarted: cfg.automationStarted,
            nextLobbyAtMs: cfg.nextLobbyAtMs,
            setupComplete: isKothAutomationConfigComplete(cfg),
          }
        : null,
    });
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
      teamLimit?: number;
      announcementRoleId?: string;
      howOftenHours?: number;
      waves?: number;
      durationMinutes?: number;
      kitName?: string;
    };
    const announcementChannelId = String(body.announcementChannelId ?? "").trim();
    const gates = Number(body.gates);
    const gateFrequency = Number(body.gateFrequency);
    const teamLimit = Number(body.teamLimit);
    const announcementRoleId = String(body.announcementRoleId ?? "").trim();
    const howOftenHours = Number(body.howOftenHours);
    const waves = Number(body.waves);
    const durationMin = Number(body.durationMinutes);
    const kitName = String(body.kitName ?? "").trim();

    if (!announcementChannelId || !announcementRoleId || !Number.isFinite(gates) || gates < 1 || gates > 20) {
      json(res, 400, { ok: false, error: "Invalid channel, gates (1–20), or role." });
      return true;
    }
    if (!Number.isFinite(gateFrequency) || gateFrequency < 1000 || gateFrequency > 9999) {
      json(res, 400, { ok: false, error: "Gate frequency must be 1000–9999." });
      return true;
    }
    if (!Number.isFinite(teamLimit) || teamLimit < 1 || teamLimit > 20) {
      json(res, 400, { ok: false, error: "Team limit must be 1–20." });
      return true;
    }
    if (!Number.isFinite(howOftenHours) || howOftenHours < 0.25 || howOftenHours > 168) {
      json(res, 400, { ok: false, error: "How often (hours) must be between 0.25 and 168." });
      return true;
    }
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

    const embed = renderKothEmbed(srv.nickname, srv.nickname, [], null, null);
    const sent = await ch.send({ content: `<@&${role.id}>`, embeds: [embed] });

    const mergedCfg = await mergeKothConfig(pool, guildRowId, rustServerId, {
      announcementChannelId: ch.id,
      announcementRoleId: role.id,
      gates,
      gateFrequency,
      teamLimit,
      messageId: sent.id,
      howOftenHours,
      waves,
      durationPerWaveMin: durationMin,
      kitName,
      automationStarted: false,
      nextLobbyAtMs: null,
    });

    void notifyGuildWebPush(pool, guildRowId, rustServerId, {
      title: "Grindset",
      body: "KOTH configured. Start automation from the admin panel when ready.",
      tag: `koth-setup-${rustServerId}`,
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

    json(res, 200, { ok: true, messageId: sent.id, setupComplete: isKothAutomationConfigComplete(mergedCfg) });
    return true;
  }

  if (rest === "koth/start" && method === "POST") {
    const raw = await readJsonBody(req);
    const body = raw as { force?: boolean };
    const force = Boolean(body.force);

    const cfg = await getKothConfig(pool, guildRowId, rustServerId);
    if (!cfg || !cfg.messageId || !isKothAutomationConfigComplete(cfg)) {
      json(res, 400, { ok: false, error: "Complete KOTH setup (how often, waves, duration, kit) first." });
      return true;
    }

    if (cfg.automationStarted && !force) {
      json(res, 409, { ok: false, error: "already_started", needsForce: true });
      return true;
    }

    const started = await startKothAutomation(pool, guildRowId, rustServerId);
    if (!started.ok) {
      json(res, 500, { ok: false, error: started.error ?? "Start failed" });
      return true;
    }

    json(res, 200, { ok: true, started: true });
    return true;
  }

  // Toggle automation on/off (admin panel switch).
  if (rest === "koth/automation" && method === "PUT") {
    const raw = await readJsonBody(req);
    const body = raw as { enabled?: unknown; force?: unknown };
    const enabled = Boolean(body?.enabled);
    const force = Boolean(body?.force);

    if (!enabled) {
      await mergeKothConfig(pool, guildRowId, rustServerId, { automationStarted: false, nextLobbyAtMs: null });
      // Best-effort: stop any in-memory runner for this server.
      requestStopKoth(rustServerId);
      json(res, 200, { ok: true, enabled: false });
      return true;
    }

    const cfg = await getKothConfig(pool, guildRowId, rustServerId);
    if (!cfg || !cfg.messageId || !isKothAutomationConfigComplete(cfg)) {
      json(res, 400, { ok: false, error: "Complete KOTH setup first." });
      return true;
    }
    if (cfg.automationStarted && !force) {
      json(res, 409, { ok: false, error: "already_started", needsForce: true });
      return true;
    }
    const started = await startKothAutomation(pool, guildRowId, rustServerId);
    if (!started.ok) {
      json(res, 500, { ok: false, error: started.error ?? "Start failed" });
      return true;
    }
    json(res, 200, { ok: true, enabled: true });
    return true;
  }

  if (rest === "maze/events" && method === "GET") {
    const ev = await getActiveMazeEvent(pool, guildRowId, rustServerId);
    const list = ev ? [{ id: ev.id, status: ev.status }] : [];
    json(res, 200, { ok: true, events: list });
    return true;
  }

  if (rest === "maze/config" && method === "GET") {
    const cfg = await getMazeConfig(pool, guildRowId, rustServerId);
    json(res, 200, {
      ok: true,
      config: cfg
        ? {
            announcementChannelId: cfg.announcementChannelId,
            announcementRoleId: cfg.announcementRoleId,
            spawnPoints: cfg.spawnPoints,
            messageId: cfg.messageId,
            howOftenHours: cfg.howOftenHours,
            durationMinutes: cfg.durationMinutes,
            kitName: cfg.kitName,
            respawnEnabled: cfg.respawnEnabled,
            automationStarted: cfg.automationStarted,
            nextLobbyAtMs: cfg.nextLobbyAtMs,
            setupComplete: isMazeAutomationConfigComplete(cfg),
          }
        : null,
    });
    return true;
  }

  if (rest === "maze/setup" && method === "POST") {
    const raw = await readJsonBody(req);
    const body = raw as {
      announcementChannelId?: string;
      spawnPoints?: number;
      announcementRoleId?: string;
      howOftenHours?: number;
      durationMinutes?: number;
      kitName?: string;
      respawn?: string;
    };
    const announcementChannelId = String(body.announcementChannelId ?? "").trim();
    const spawnPoints = Number(body.spawnPoints);
    const announcementRoleId = String(body.announcementRoleId ?? "").trim();
    const howOftenHours = Number(body.howOftenHours);
    const durationMin = Number(body.durationMinutes);
    const kitName = String(body.kitName ?? "").trim();
    const respawnRaw = String(body.respawn ?? "").toLowerCase();

    if (!announcementChannelId || !announcementRoleId || !Number.isFinite(spawnPoints)) {
      json(res, 400, { ok: false, error: "Channel, spawn points, and role required." });
      return true;
    }
    if (spawnPoints < 1 || spawnPoints > MAZE_MAX_SPAWN_POINTS) {
      json(res, 400, { ok: false, error: `Spawn points must be 1–${MAZE_MAX_SPAWN_POINTS}.` });
      return true;
    }
    if (!Number.isFinite(howOftenHours) || howOftenHours < 0.25 || howOftenHours > 168) {
      json(res, 400, { ok: false, error: "How often (hours) must be between 0.25 and 168." });
      return true;
    }
    if (!Number.isFinite(durationMin) || durationMin < 1 || durationMin > 180) {
      json(res, 400, { ok: false, error: "Duration must be 1–180 minutes." });
      return true;
    }
    if (respawnRaw !== "yes" && respawnRaw !== "no") {
      json(res, 400, { ok: false, error: 'respawn must be "yes" or "no".' });
      return true;
    }
    if (!kitName) {
      json(res, 400, { ok: false, error: "Kit name required." });
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

    const mergedCfg = await mergeMazeConfig(pool, guildRowId, rustServerId, {
      announcementChannelId: ch.id,
      announcementRoleId: role.id,
      spawnPoints,
      messageId: sent.id,
      howOftenHours,
      durationMinutes: durationMin,
      kitName,
      respawnEnabled: respawnRaw === "yes",
      automationStarted: false,
      nextLobbyAtMs: null,
    });

    void notifyGuildWebPush(pool, guildRowId, rustServerId, {
      title: "Grindset",
      body: "Maze configured. Start automation from the admin panel when ready.",
      tag: `maze-setup-${rustServerId}`,
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

    json(res, 200, {
      ok: true,
      messageId: sent.id,
      setupComplete: isMazeAutomationConfigComplete(mergedCfg),
    });
    return true;
  }

  if (rest === "maze/start" && method === "POST") {
    const raw = await readJsonBody(req);
    const body = raw as { force?: boolean };
    const force = Boolean(body.force);

    const cfg = await getMazeConfig(pool, guildRowId, rustServerId);
    if (!cfg || !cfg.messageId || !isMazeAutomationConfigComplete(cfg)) {
      json(res, 400, { ok: false, error: "Complete Maze setup (how often, duration, kit, respawn) first." });
      return true;
    }

    if (cfg.automationStarted && !force) {
      json(res, 409, { ok: false, error: "already_started", needsForce: true });
      return true;
    }

    const started = await startMazeAutomation(pool, guildRowId, rustServerId);
    if (!started.ok) {
      json(res, 500, { ok: false, error: started.error ?? "Start failed" });
      return true;
    }

    json(res, 200, { ok: true, started: true });
    return true;
  }

  // Toggle automation on/off (admin panel switch).
  if (rest === "maze/automation" && method === "PUT") {
    const raw = await readJsonBody(req);
    const body = raw as { enabled?: unknown; force?: unknown };
    const enabled = Boolean(body?.enabled);
    const force = Boolean(body?.force);

    if (!enabled) {
      await mergeMazeConfig(pool, guildRowId, rustServerId, { automationStarted: false, nextLobbyAtMs: null });
      requestStopMaze(rustServerId);
      json(res, 200, { ok: true, enabled: false });
      return true;
    }

    const cfg = await getMazeConfig(pool, guildRowId, rustServerId);
    if (!cfg || !cfg.messageId || !isMazeAutomationConfigComplete(cfg)) {
      json(res, 400, { ok: false, error: "Complete Maze setup first." });
      return true;
    }
    if (cfg.automationStarted && !force) {
      json(res, 409, { ok: false, error: "already_started", needsForce: true });
      return true;
    }
    const started = await startMazeAutomation(pool, guildRowId, rustServerId);
    if (!started.ok) {
      json(res, 500, { ok: false, error: started.error ?? "Start failed" });
      return true;
    }
    json(res, 200, { ok: true, enabled: true });
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
      mode?: unknown;
      announcementChannelId?: string;
      announcementRoleId?: string;
      gates?: number;
      gateFrequency?: number;
      teamLimit?: number;
      kitName?: string;
      howOftenHours?: number;
    };
    const mode = String(body.mode ?? "nuketown") === "tournament" ? "tournament" : "nuketown";
    const announcementChannelId = String(body.announcementChannelId ?? "").trim();
    const announcementRoleId = String(body.announcementRoleId ?? "").trim();
    const gates = Number(body.gates);
    const gateFrequency = Number(body.gateFrequency);
    const teamLimit = Number(body.teamLimit);
    const kitName = String(body.kitName ?? "").trim();
    const howOftenHours = body.howOftenHours != null ? Number(body.howOftenHours) : null;

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
    if (howOftenHours != null && (!Number.isFinite(howOftenHours) || howOftenHours < 0 || howOftenHours > 168)) {
      json(res, 400, { ok: false, error: "How often must be 0–168 hours." });
      return true;
    }
    if (mode === "tournament" && gates !== 4) {
      json(res, 400, { ok: false, error: "Nuketown Tournament requires exactly 4 gates." });
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

    const lobby = await ensureLobbyNuketownForJoin(pool, guildRowId, rustServerId, 5, mode);
    if (!lobby.ok) {
      json(res, 400, { ok: false, error: "Nuketown is already running on this server." });
      return true;
    }

    const meta = await getActiveNuketownEventMeta(pool, guildRowId, rustServerId);
    const lobbyEndsAtMs = meta?.lobbyEndsAtMs ?? Date.now() + 5 * 60_000;
    const eventNumber = meta?.id ?? lobby.eventId;

    const sent = await channel.send({
      content: `<@&${role.id}>`,
      embeds: [renderNuketownEmbed(srv.nickname, srv.nickname, [], lobbyEndsAtMs, teamLimit, mode, eventNumber)],
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
      sent.id,
      howOftenHours && howOftenHours > 0 ? howOftenHours : null,
      false,
      howOftenHours && howOftenHours > 0 ? Date.now() + howOftenHours * 3600_000 : null,
      mode
    );

    void notifyGuildWebPush(pool, guildRowId, rustServerId, {
      title: "Grindset",
      body: "Nuketown lobby is open. Join now!",
      tag: `nuketown-lobby-${eventNumber}`,
    });

    scheduleNuketownLobbyWatch(
      client,
      pool,
      guildRowId,
      rustServerId,
      channel.id,
      kitName,
      teamLimit,
      gateFrequency,
      mode === "tournament" ? 4 : 2
    );

    json(res, 200, { ok: true, messageId: sent.id });
    return true;
  }

  if (rest === "nuketown/delete" && method === "POST") {
    const raw = await readJsonBody(req);
    const body = raw as { confirm?: unknown } | null;
    if (String(body?.confirm ?? "") !== "DELETE_NUKETOWN") {
      json(res, 400, { ok: false, error: "Missing confirmation." });
      return true;
    }
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

  // Toggle automation on/off (admin panel switch) — Nuketown + Tournament
  if (rest === "nuketown/automation" && method === "PUT") {
    const raw = await readJsonBody(req);
    const body = raw as { enabled?: unknown; force?: unknown; mode?: unknown };
    const enabled = Boolean(body?.enabled);
    const force = Boolean(body?.force);
    const mode = String(body?.mode ?? "nuketown") === "tournament" ? "tournament" : "nuketown";

    if (!enabled) {
      await pool.query(
        `UPDATE nuketown_configs
         SET ${mode === "tournament" ? "tournament_automation_started" : "automation_started"} = 0,
             ${mode === "tournament" ? "tournament_next_lobby_at_ms" : "next_lobby_at_ms"} = NULL
         WHERE guild_id = :gid AND rust_server_id = :sid`,
        { gid: guildRowId, sid: rustServerId }
      );
      // Do NOT stop an active lobby/match when toggling automation off.
      // This switch is only for scheduling future lobbies.
      json(res, 200, { ok: true, enabled: false });
      return true;
    }

    const cfg = await getNuketownConfig(pool, guildRowId, rustServerId, mode);
    if (!cfg || !cfg.messageId || !cfg.howOftenHours || cfg.howOftenHours <= 0) {
      json(res, 400, { ok: false, error: "Complete Nuketown setup first (including How often)." });
      return true;
    }
    if (cfg.automationStarted && !force) {
      json(res, 409, { ok: false, error: "already_started", needsForce: true });
      return true;
    }
    const started = await startNuketownAutomation(pool, guildRowId, rustServerId, mode);
    if (!started.ok) {
      json(res, 500, { ok: false, error: started.error ?? "Start failed" });
      return true;
    }
    json(res, 200, { ok: true, enabled: true });
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

  if (rest === "onev1/config" && method === "GET") {
    const cfg = await getOneV1Config(pool, guildRowId, rustServerId);
    json(res, 200, {
      ok: true,
      config: cfg
        ? {
            announcementChannelId: cfg.announcementChannelId,
            enabled: cfg.enabled,
            kitName: cfg.kitName,
            gateFrequency: cfg.gateFrequency,
          }
        : null,
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
    if (!servers.some((s) => String(s.id) === String(rustServerId))) {
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

  if (rest === "metrics" && method === "GET") {
    const rows = await listServerMetricsForServer(pool, rustServerId);
    const points = rows.map((r) => {
      const tMs = r.serverTimeMs ?? r.capturedAtMs;
      return {
        tMs,
        label: formatHhmmFromMs(tMs),
        entityCount: r.entityCount,
        framerate: r.framerate,
        memoryMb: r.memoryMb,
        players: r.players,
      };
    });

    let latest: {
      entityCount: number;
      framerate: number;
      memoryMb: number;
      players: number;
    } | null = null;
    if (rows.length > 0) {
      const last = rows[rows.length - 1]!;
      latest = {
        entityCount: last.entityCount,
        framerate: last.framerate,
        memoryMb: last.memoryMb,
        players: last.players,
      };
    }

    const ecVals = rows.map((r) => r.entityCount);
    const fpsVals = rows.map((r) => r.framerate);
    const memVals = rows.map((r) => r.memoryMb);

    const yEntity =
      ecVals.length > 0
        ? adaptiveYAxis(Math.min(...ecVals), Math.max(...ecVals))
        : { min: 0, max: 1 };
    const yFps =
      fpsVals.length > 0 ? adaptiveYAxis(Math.min(...fpsVals), Math.max(...fpsVals)) : { min: 0, max: 1 };
    const yMem =
      memVals.length > 0 ? adaptiveYAxis(Math.min(...memVals), Math.max(...memVals)) : { min: 0, max: 1 };

    json(res, 200, {
      ok: true,
      points,
      latest,
      yAxis: {
        entity: yEntity,
        framerate: yFps,
        memory: yMem,
        players: { min: 0, max: 100 },
      },
    });
    return true;
  }

  if (rest === "docked-cargo/config" && method === "GET") {
    const cfg = await getDockedCargoConfig(pool, guildRowId, rustServerId);
    json(res, 200, {
      ok: true,
      config: cfg
        ? {
            coordX: cfg.coordX,
            coordY: cfg.coordY,
            coordZ: cfg.coordZ,
            coordinates:
              cfg.coordX != null && cfg.coordY != null && cfg.coordZ != null
                ? `${cfg.coordX},${cfg.coordY},${cfg.coordZ}`
                : "",
            howOftenHours: cfg.howOftenHours,
            inGameMessage: cfg.inGameMessage,
            sayEnabled: cfg.sayEnabled,
            leaveMessage: cfg.leaveMessage,
            lockedCrates: cfg.lockedCrates,
            timeDockedMinutes: cfg.timeDockedMinutes,
            announcementChannelId: cfg.announcementChannelId,
            announcementRoleId: cfg.announcementRoleId,
            automationStarted: cfg.automationStarted,
            setupComplete: isDockedCargoConfigComplete(cfg),
          }
        : null,
    });
    return true;
  }

  if (rest === "docked-cargo/setup" && method === "POST") {
    const raw = await readJsonBody(req);
    const body = raw as {
      coordinates?: string;
      howOftenHours?: number;
      inGameMessage?: string;
      sayEnabled?: boolean;
      leaveMessage?: string;
      lockedCrates?: number;
      timeDockedMinutes?: number;
      announcementChannelId?: string;
      announcementRoleId?: string;
    };
    const patch: DockedCargoPatch = {};

    if (body.coordinates !== undefined) {
      const s = String(body.coordinates).trim();
      const parts = s.split(/[,\s]+/).filter(Boolean);
      if (parts.length === 3) {
        const x = Number.parseFloat(parts[0]!);
        const y = Number.parseFloat(parts[1]!);
        const z = Number.parseFloat(parts[2]!);
        if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
          patch.coordX = x;
          patch.coordY = y;
          patch.coordZ = z;
        }
      }
    }
    if (body.howOftenHours !== undefined) {
      const h = Number(body.howOftenHours);
      if (Number.isFinite(h) && h > 0) patch.howOftenHours = h;
    }
    if (body.inGameMessage !== undefined) patch.inGameMessage = String(body.inGameMessage);
    if (body.sayEnabled !== undefined) patch.sayEnabled = Boolean(body.sayEnabled);
    if (body.leaveMessage !== undefined) patch.leaveMessage = String(body.leaveMessage);
    if (body.lockedCrates !== undefined) {
      const n = Number(body.lockedCrates);
      if (Number.isFinite(n) && n >= 1 && n <= 5) patch.lockedCrates = n;
    }
    if (body.timeDockedMinutes !== undefined) {
      const n = Number(body.timeDockedMinutes);
      if (Number.isFinite(n) && n >= 1) patch.timeDockedMinutes = n;
    }
    if (body.announcementChannelId !== undefined) {
      const ch = String(body.announcementChannelId).trim();
      if (ch) {
        const fetched = await guild.channels.fetch(ch).catch(() => null);
        if (!fetched || !(fetched instanceof TextChannel)) {
          json(res, 400, { ok: false, error: "Invalid announcement channel." });
          return true;
        }
        patch.announcementChannelId = ch;
      }
    }
    if (body.announcementRoleId !== undefined) {
      const rid = String(body.announcementRoleId).trim();
      if (rid) {
        const role = await guild.roles.fetch(rid).catch(() => null);
        if (!role) {
          json(res, 400, { ok: false, error: "Invalid announcement role." });
          return true;
        }
        patch.announcementRoleId = rid;
      }
    }

    const merged = await mergeDockedCargoConfig(pool, guildRowId, rustServerId, patch);
    json(res, 200, { ok: true, setupComplete: isDockedCargoConfigComplete(merged) });
    return true;
  }

  if (rest === "docked-cargo/start" && method === "POST") {
    const raw = await readJsonBody(req);
    const body = raw as { force?: boolean };
    const force = Boolean(body.force);
    const cfg = await getDockedCargoConfig(pool, guildRowId, rustServerId);
    if (!cfg || !isDockedCargoConfigComplete(cfg)) {
      json(res, 400, { ok: false, error: "Complete Docked Cargo setup first." });
      return true;
    }
    if (cfg.automationStarted && !force) {
      json(res, 409, { ok: false, error: "already_started", needsForce: true });
      return true;
    }
    const started = await startDockedCargoAutomation(
      pool,
      guildRowId,
      rustServerId,
      client,
      force ? { force: true } : undefined
    );
    if (!started.ok) {
      json(res, 500, { ok: false, error: started.error ?? "Start failed" });
      return true;
    }
    json(res, 200, { ok: true, started: true });
    return true;
  }

  // Toggle automation on/off (admin panel switch).
  if (rest === "docked-cargo/automation" && method === "PUT") {
    const raw = await readJsonBody(req);
    const body = raw as { enabled?: unknown; force?: unknown };
    const enabled = Boolean(body?.enabled);
    const force = Boolean(body?.force);

    if (!enabled) {
      await mergeDockedCargoConfig(pool, guildRowId, rustServerId, { automationStarted: false });
      json(res, 200, { ok: true, enabled: false });
      return true;
    }

    const cfg = await getDockedCargoConfig(pool, guildRowId, rustServerId);
    if (!cfg || !isDockedCargoConfigComplete(cfg)) {
      json(res, 400, { ok: false, error: "Complete Docked Cargo setup first." });
      return true;
    }
    if (cfg.automationStarted && !force) {
      json(res, 409, { ok: false, error: "already_started", needsForce: true });
      return true;
    }
    const started = await startDockedCargoAutomation(
      pool,
      guildRowId,
      rustServerId,
      client,
      force ? { force: true } : undefined
    );
    if (!started.ok) {
      json(res, 500, { ok: false, error: started.error ?? "Start failed" });
      return true;
    }
    json(res, 200, { ok: true, enabled: true });
    return true;
  }

  return false;
}
