import type http from "node:http";
import { ChannelType, TextChannel, type Client } from "discord.js";
import type { Pool } from "mysql2/promise";
import { memberHasAdminRole } from "../admin/guildAdmin.js";
import { config } from "../config.js";
import { decryptSecret } from "../crypto/passwordVault.js";
import { getDiscordGuildIdByRowId, getOrCreateGuildRow } from "../db/guilds.js";
import {
  countEventMembers,
  ensureLobbyEventForJoin,
  getActiveKothEvent,
  getGateCoord,
  getKothConfig,
  startKothEvent,
  upsertKothConfig,
} from "../db/koth.js";
import { getRustServerByIdForGuild, getGuildRowIdForRustServerId, listRustServersForGuild } from "../db/rustServers.js";
import { performKothEnd } from "../koth/kothEndActions.js";
import { renderKothEmbed } from "../koth/render.js";
import { parseGateCoordTriple, runKothWaves } from "../koth/runner.js";
import { KOTH_RCON_SETUP, runSayRcon } from "../rcon/eventBroadcasts.js";
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

  return false;
}
