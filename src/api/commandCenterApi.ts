import http from "node:http";
import { URL } from "node:url";
import type { Client } from "discord.js";
import { handleAdminPanelRoutes } from "./adminPanelHttp.js";
import { pool } from "../db/pool.js";
import { listAllRustServers } from "../db/rustServers.js";
import { getGuildRowIdForRustServerId } from "../db/rustServers.js";
import { getDiscordGuildIdByRowId } from "../db/guilds.js";
import { decryptSecret } from "../crypto/passwordVault.js";
import { config } from "../config.js";
import { runWebRconCommand } from "../rcon/webrcon.js";
import {
  addEventMember,
  assignGate,
  countEventMembers,
  ensureLobbyEventForJoin,
  getActiveKothEvent,
  getActiveKothEventMeta,
  getClanGate,
  getKothDoorDelayMs,
  getKothConfig,
  listGateViews,
  listKothParticipantsWithGatesAndClan,
  removeEventMember,
  removeGateIfEmpty,
} from "../db/koth.js";
import {
  countNuketownMembers,
  getActiveNuketownEventMeta,
  getNuketownConfig,
  listNuketownParticipants,
  listNuketownTeams,
  assignNuketownTeamSlot,
  addNuketownEventMember,
  getNuketownTeamSlot,
  ensureLobbyNuketownForJoin,
  removeNuketownEventMember,
  removeNuketownTeamIfEmpty,
} from "../db/nuketown.js";
import { updateNuketownMessage } from "../nuketown/announce.js";
import { getOneV1Config, getMatchForServer, hasActiveOrPendingMatch } from "../db/onev1.js";
import { listLinkedInClanUserIdsForGuild } from "../db/onev1Nominate.js";
import {
  commitOneV1Accept,
  commitOneV1Duck,
  createAndAnnounceOneV1Match,
  validateOneV1Accept,
  validateOneV1Duck,
} from "../onev1/matchLifecycle.js";
import { insertSiteInboxMessage, listUnreadSiteInboxForUser, markSiteInboxRead } from "../db/siteInbox.js";
import {
  addMazeEventMember,
  countMazeEventMembers,
  ensureLobbyMazeForJoin,
  findFreeMazeSpawn,
  getActiveMazeEvent,
  getActiveMazeEventMeta,
  getMazeConfig,
  listMazeSpawnViews,
  MAZE_MAX_PLAYERS,
  MAZE_MAX_SPAWN_POINTS,
  removeMazeEventMember,
} from "../db/maze.js";
import { getDockedCargoConfig, isDockedCargoConfigComplete } from "../db/dockedCargo.js";
import { getDockedCargoRuntimePhaseFromConfig } from "../dockedCargo/runner.js";
import {
  getLinkByDiscordUser,
  getLinkByIngameNameCi,
  hasDiscordLinkForUser,
  insertLink,
  listRustServerIdsForDiscordUser,
} from "../db/links.js";
import {
  deleteWebPushSubscription,
  getWebPushServerScopeForUser,
  replaceWebPushServerScopeForUser,
  upsertWebPushSubscription,
} from "../db/webPush.js";
import { getLatestUnexpiredSnapshot, deleteExpiredSnapshots } from "../db/eventSnapshots.js";
import {
  addClanMember,
  countClanMembers,
  createClan,
  createInvite,
  deleteClan,
  deleteExpiredInvites,
  getClanForEventParticipation,
  getClanSettings,
  getMemberClan,
  findInviteByCode,
  inviteCodeExists,
  listClanMemberDiscordUserIds,
  promoteClanOwner,
  removeClanMember,
  updateClanDetails,
} from "../db/clans.js";
import { refreshActiveClansPanelsForGuild } from "../clans/activeClansPanel.js";
import {
  createClanRole,
  createPrivateClanChannel,
  ensureClansCategory,
  resolveRoleColor,
} from "../clans/discordAssets.js";
import { syncLinkedNicknameForUser, syncLinkedNicknamesForClan } from "../clans/nicknames.js";
import { listRustServersForGuild } from "../db/rustServers.js";
import { updateKothMessage } from "../koth/announce.js";
import { updateMazeMessage } from "../maze/announce.js";
import { getTopClansForServerLeaderboard } from "../db/clanLeaderboard.js";
import { formatKdRatio } from "../stats/kdRatio.js";
import {
  EVENT_JOIN_BLOCKED_MESSAGE,
  discordUserHasAnyActiveEventParticipation,
  joinTargetConflictsWithExistingSlots,
  listActiveEventParticipationSlots,
} from "../db/eventParticipation.js";
import { getLucidsBalance, trySpendLucids } from "../db/storeLucids.js";

type HostnameSegment = { text: string; color?: string };

type Serverinfo = {
  Hostname: string;
  MaxPlayers: number;
  Players: number;
  Map?: string;
  Uptime?: number;
};

function getEnvOptional(name: string): string | null {
  const v = process.env[name];
  return v?.trim() ? v.trim() : null;
}

function json(res: http.ServerResponse, status: number, body: unknown): void {
  const data = Buffer.from(JSON.stringify(body), "utf8");
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Length", data.byteLength);
  res.end(data);
}

function unauthorized(res: http.ServerResponse): void {
  json(res, 401, { ok: false, error: "Unauthorized" });
}

function notFound(res: http.ServerResponse): void {
  json(res, 404, { ok: false, error: "Not found" });
}

async function readJsonBody(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return null;
  return JSON.parse(raw) as unknown;
}

function parseServerIdFromPath(path: string, prefix: string): number | null {
  if (!path.startsWith(prefix)) return null;
  const rest = path.slice(prefix.length);
  const idRaw = rest.split("/")[0] ?? "";
  const id = Number.parseInt(idRaw, 10);
  return Number.isFinite(id) && id > 0 ? id : null;
}

type OneV1WebsitePath =
  | { serverId: number; kind: "candidates" }
  | { serverId: number; kind: "nominate" }
  | { serverId: number; kind: "match"; matchId: number; action: "accept" | "duck" };

function parseOneV1WebsitePath(path: string): OneV1WebsitePath | null {
  const prefix = "/api/server/";
  if (!path.startsWith(prefix)) return null;
  const rest = path.slice(prefix.length);
  const segments = rest.split("/").filter(Boolean);
  const serverId = Number.parseInt(segments[0] ?? "", 10);
  if (!Number.isFinite(serverId) || serverId < 1 || segments[1] !== "onev1") return null;
  if (segments[2] === "nominate-candidates" && segments.length === 3) {
    return { serverId, kind: "candidates" };
  }
  if (segments[2] === "nominate" && segments.length === 3) {
    return { serverId, kind: "nominate" };
  }
  if (segments[2] === "match" && segments.length === 5) {
    const matchId = Number.parseInt(segments[3] ?? "", 10);
    const action = segments[4];
    if (!Number.isFinite(matchId) || matchId < 1) return null;
    if (action === "accept" || action === "duck") {
      return { serverId, kind: "match", matchId, action };
    }
  }
  return null;
}

function parseServerinfoJson(message: string): Serverinfo | null {
  const i = message.indexOf("{");
  const j = message.lastIndexOf("}");
  if (i < 0 || j < 0 || j <= i) return null;
  const raw = message.slice(i, j + 1);
  const normalized = raw.replace(/\\n/g, "\n");
  try {
    return JSON.parse(normalized) as Serverinfo;
  } catch {
    try {
      return JSON.parse(normalized.replace(/\r?\n/g, "")) as Serverinfo;
    } catch {
      return null;
    }
  }
}

function parseColoredHostname(hostname: string): { segments: HostnameSegment[]; plain: string } {
  const segments: HostnameSegment[] = [];
  const re = /<color=#([0-9a-fA-F]{6})>(.*?)<\/color>/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(hostname))) {
    if (m.index > last) {
      const before = hostname.slice(last, m.index);
      const text = before.replace(/<[^>]+>/g, "");
      if (text) segments.push({ text });
    }
    const color = `#${m[1]}`;
    const text = (m[2] ?? "").replace(/<[^>]+>/g, "");
    if (text) segments.push({ text, color });
    last = m.index + m[0].length;
  }
  if (last < hostname.length) {
    const rest = hostname.slice(last);
    const text = rest.replace(/<[^>]+>/g, "");
    if (text) segments.push({ text });
  }
  const plain = segments.map((s) => s.text).join("").replace(/\s+/g, " ").trim();
  return { segments, plain };
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  let idx = 0;
  const workers = Array.from({ length: Math.max(1, limit) }, async () => {
    while (idx < items.length) {
      const current = items[idx++];
      out.push(await fn(current));
    }
  });
  await Promise.all(workers);
  return out;
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), ms);
  // Note: runWebRconCommand doesn't accept AbortSignal; we use this wrapper only for fetch/other promises.
  return Promise.race([
    p.finally(() => clearTimeout(timer)),
    new Promise<T>((_resolve, reject) => {
      ac.signal.addEventListener("abort", () => reject(new Error(`${label} timed out after ${ms}ms`)), {
        once: true,
      });
    }),
  ]);
}

type CachedServers = { atMs: number; payload: unknown };
let serversCache: CachedServers | null = null;
let serversRefreshInFlight: Promise<unknown> | null = null;
const SERVERS_CACHE_TTL_MS = 15_000;

export function startCommandCenterApi(client?: Client): void {
  const portRaw = getEnvOptional("BOT_API_PORT");
  const apiKey = getEnvOptional("BOT_API_KEY");

  if (!portRaw || !apiKey) {
    console.log("[command-center api] disabled (set BOT_API_PORT and BOT_API_KEY to enable)");
    return;
  }

  const port = Number.parseInt(portRaw, 10);
  if (!Number.isFinite(port) || port <= 0 || port > 65535) {
    console.error("[command-center api] invalid BOT_API_PORT:", portRaw);
    return;
  }

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      const path = url.pathname;

      if (path === "/health") {
        json(res, 200, { ok: true });
        return;
      }

      // Public VAPID key for browser PushManager (no API key; key material is not secret).
      if (path === "/api/push/vapid-public-key" && req.method === "GET") {
        const pub = getEnvOptional("VAPID_PUBLIC_KEY");
        if (!pub) {
          json(res, 503, { ok: false, error: "Push not configured." });
          return;
        }
        json(res, 200, { ok: true, publicKey: pub });
        return;
      }

      const key = String(req.headers["x-api-key"] ?? "");
      if (key !== apiKey) {
        unauthorized(res);
        return;
      }

      if (path.startsWith("/api/admin/")) {
        if (!client) {
          json(res, 503, { ok: false, error: "Admin panel requires the Discord bot process." });
          return;
        }
        const handled = await handleAdminPanelRoutes(req, res, path, client, pool);
        if (handled) return;
        notFound(res);
        return;
      }

      // --- Web Push subscription (authenticated via Netlify + X-Discord-User-Id) ---
      if (path === "/api/push/eligible" && req.method === "GET") {
        const discordUserId = String(req.headers["x-discord-user-id"] ?? "").trim();
        if (!discordUserId) {
          json(res, 401, { ok: false, error: "Missing user." });
          return;
        }
        const linked = await hasDiscordLinkForUser(pool, discordUserId);
        json(res, 200, { ok: true, linked });
        return;
      }

      if (path === "/api/push/subscribe" && req.method === "POST") {
        const discordUserId = String(req.headers["x-discord-user-id"] ?? "").trim();
        if (!discordUserId) {
          json(res, 401, { ok: false, error: "Missing user." });
          return;
        }
        const body = (await readJsonBody(req)) as {
          subscription?: { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
          serverId?: number;
        } | null;
        const sub = body?.subscription;
        const endpoint = String(sub?.endpoint ?? "");
        const p256dh = String(sub?.keys?.p256dh ?? "");
        const auth = String(sub?.keys?.auth ?? "");
        if (!endpoint || !p256dh || !auth) {
          json(res, 400, { ok: false, error: "Invalid subscription." });
          return;
        }
        const serverIdRaw = body?.serverId;
        const serverId =
          serverIdRaw !== undefined && serverIdRaw !== null ? Number(serverIdRaw) : Number.NaN;
        if (serverIdRaw !== undefined && serverIdRaw !== null) {
          if (!Number.isFinite(serverId) || serverId < 1) {
            json(res, 400, { ok: false, error: "Invalid serverId." });
            return;
          }
          const guildRowId = await getGuildRowIdForRustServerId(pool, serverId);
          if (!guildRowId) {
            json(res, 404, { ok: false, error: "Server not found." });
            return;
          }
          const link = await getLinkByDiscordUser(pool, guildRowId, discordUserId);
          if (!link) {
            json(res, 403, {
              ok: false,
              error: "Link your in-game name once for that Discord (covers every Rust server there).",
            });
            return;
          }
        } else {
          const linkedAny = await hasDiscordLinkForUser(pool, discordUserId);
          if (!linkedAny) {
            json(res, 403, {
              ok: false,
              error: "Link your in-game name once for that Discord (covers every Rust server there).",
            });
            return;
          }
        }
        await upsertWebPushSubscription(pool, discordUserId, { endpoint, keys: { p256dh, auth } });
        json(res, 200, { ok: true });
        return;
      }

      if (path === "/api/push/unsubscribe" && req.method === "POST") {
        const discordUserId = String(req.headers["x-discord-user-id"] ?? "").trim();
        if (!discordUserId) {
          json(res, 401, { ok: false, error: "Missing user." });
          return;
        }
        const body = (await readJsonBody(req)) as { endpoint?: string } | null;
        const endpoint = String(body?.endpoint ?? "");
        if (!endpoint) {
          json(res, 400, { ok: false, error: "Missing endpoint." });
          return;
        }
        await deleteWebPushSubscription(pool, discordUserId, endpoint);
        json(res, 200, { ok: true });
        return;
      }

      // Per–Rust-server notification scope (empty scope = all servers in guilds you’re linked in).
      if (path === "/api/push/server-scope" && req.method === "GET") {
        const discordUserId = String(req.headers["x-discord-user-id"] ?? "").trim();
        if (!discordUserId) {
          json(res, 401, { ok: false, error: "Missing user." });
          return;
        }
        const eligibleRustServerIds = await listRustServerIdsForDiscordUser(pool, discordUserId);
        const scope = await getWebPushServerScopeForUser(pool, discordUserId);
        json(res, 200, {
          ok: true,
          eligibleRustServerIds,
          restrictToServers: scope.restrictToServers,
          rustServerIds: scope.rustServerIds,
        });
        return;
      }

      if (path === "/api/push/server-scope" && req.method === "PUT") {
        const discordUserId = String(req.headers["x-discord-user-id"] ?? "").trim();
        if (!discordUserId) {
          json(res, 401, { ok: false, error: "Missing user." });
          return;
        }
        const linked = await hasDiscordLinkForUser(pool, discordUserId);
        if (!linked) {
          json(res, 403, {
            ok: false,
            error: "Link your in-game name once for that Discord (covers every Rust server there).",
          });
          return;
        }
        const body = (await readJsonBody(req)) as { rustServerIds?: unknown } | null;
        const raw = body?.rustServerIds;
        if (!Array.isArray(raw)) {
          json(res, 400, { ok: false, error: "Expected rustServerIds array." });
          return;
        }
        const ids = raw
          .map((x) => Number(x))
          .filter((n) => Number.isFinite(n) && n > 0);
        const eligible = new Set(await listRustServerIdsForDiscordUser(pool, discordUserId));
        for (const id of ids) {
          if (!eligible.has(id)) {
            json(res, 400, { ok: false, error: "Invalid or ineligible rust server id." });
            return;
          }
        }
        await replaceWebPushServerScopeForUser(pool, discordUserId, ids);
        json(res, 200, { ok: true });
        return;
      }

      // --- Site inbox (targeted website notifications) ---
      if (path === "/api/me/inbox" && req.method === "GET") {
        const discordUserId = String(req.headers["x-discord-user-id"] ?? "").trim();
        if (!discordUserId) {
          json(res, 401, { ok: false, error: "Missing user." });
          return;
        }
        const messages = await listUnreadSiteInboxForUser(pool, discordUserId, 30);
        json(res, 200, { ok: true, messages });
        return;
      }

      // --- Store: Lucids balance (read-only) ---
      if (path === "/api/me/lucids" && req.method === "GET") {
        const discordUserId = String(req.headers["x-discord-user-id"] ?? "").trim();
        if (!discordUserId) {
          json(res, 401, { ok: false, error: "Missing user." });
          return;
        }
        const lucids = await getLucidsBalance(pool, discordUserId);
        json(res, 200, { ok: true, discordUserId, lucids });
        return;
      }

      // --- Store: Spend Lucids (atomic; fails if insufficient) ---
      if (path === "/api/me/lucids/spend" && req.method === "POST") {
        const discordUserId = String(req.headers["x-discord-user-id"] ?? "").trim();
        if (!discordUserId) {
          json(res, 401, { ok: false, error: "Missing user." });
          return;
        }
        const body = (await readJsonBody(req)) as { amount?: unknown } | null;
        const amountRaw = body?.amount;
        const amount = typeof amountRaw === "number" ? amountRaw : Number(amountRaw);
        if (!Number.isFinite(amount) || amount < 0) {
          json(res, 400, { ok: false, error: "Invalid amount." });
          return;
        }
        const result = await trySpendLucids(pool, discordUserId, amount);
        if (!result.ok) {
          json(res, 409, { ok: false, error: "Insufficient Lucids.", discordUserId, balance: result.balance });
          return;
        }
        json(res, 200, { ok: true, discordUserId, newBalance: result.newBalance });
        return;
      }

      if (path === "/api/me/inbox/mark-read" && req.method === "POST") {
        const discordUserId = String(req.headers["x-discord-user-id"] ?? "").trim();
        if (!discordUserId) {
          json(res, 401, { ok: false, error: "Missing user." });
          return;
        }
        const body = (await readJsonBody(req)) as { ids?: unknown } | null;
        const rawIds = Array.isArray(body?.ids) ? body.ids : [];
        const ids = rawIds.map((x) => Number(x)).filter((n) => Number.isFinite(n) && n > 0);
        await markSiteInboxRead(pool, discordUserId, ids);
        json(res, 200, { ok: true });
        return;
      }

      const onev1Website = parseOneV1WebsitePath(path);
      if (onev1Website) {
        if (!client) {
          json(res, 503, { ok: false, error: "Discord client unavailable." });
          return;
        }
        const discordUserId = String(req.headers["x-discord-user-id"] ?? "").trim();
        if (!discordUserId) {
          json(res, 401, { ok: false, error: "Missing user." });
          return;
        }
        const guildRowId = await getGuildRowIdForRustServerId(pool, onev1Website.serverId);
        if (!guildRowId) {
          json(res, 404, { ok: false, error: "Server not found." });
          return;
        }

        if (onev1Website.kind === "candidates" && req.method === "GET") {
          const settings = await getClanSettings(pool, guildRowId);
          if (!settings.enabled) {
            json(res, 403, { ok: false, error: "Clan system disabled." });
            return;
          }
          const link = await getLinkByDiscordUser(pool, guildRowId, discordUserId);
          if (!link) {
            json(res, 403, { ok: false, error: "You must link before nominating." });
            return;
          }
          if (!(await getClanForEventParticipation(pool, guildRowId, discordUserId))) {
            json(res, 403, { ok: false, error: "You must be in a clan to use 1v1." });
            return;
          }
          const rawIds = await listLinkedInClanUserIdsForGuild(pool, guildRowId);
          const fallbackAvatar = (id: string) =>
            `https://cdn.discordapp.com/embed/avatars/${Number.parseInt(id, 10) % 5}.png`;
          const eligible: { discordUserId: string; displayName: string; avatarUrl: string }[] = [];
          for (const uid of rawIds) {
            if (uid === discordUserId) continue;
            if (await discordUserHasAnyActiveEventParticipation(pool, guildRowId, uid)) continue;
            try {
              const u = await client.users.fetch(uid);
              eligible.push({
                discordUserId: uid,
                displayName: u.globalName ?? u.username,
                avatarUrl: u.displayAvatarURL({ size: 64, extension: "png" }),
              });
            } catch {
              eligible.push({
                discordUserId: uid,
                displayName: "Unknown",
                avatarUrl: fallbackAvatar(uid),
              });
            }
          }
          eligible.sort((a, b) => a.displayName.localeCompare(b.displayName));
          json(res, 200, { ok: true, candidates: eligible });
          return;
        }

        if (onev1Website.kind === "nominate" && req.method === "POST") {
          const settings = await getClanSettings(pool, guildRowId);
          if (!settings.enabled) {
            json(res, 403, { ok: false, error: "Clan system disabled." });
            return;
          }
          const body = (await readJsonBody(req)) as { opponentDiscordId?: string } | null;
          const opponentId = String(body?.opponentDiscordId ?? "").trim();
          if (!opponentId || opponentId === discordUserId) {
            json(res, 400, { ok: false, error: "Invalid opponent." });
            return;
          }
          const cfg = await getOneV1Config(pool, guildRowId, onev1Website.serverId);
          if (!cfg) {
            json(res, 400, { ok: false, error: "1v1 is not configured for this server." });
            return;
          }
          if (!cfg.enabled) {
            json(res, 400, { ok: false, error: "1v1 is disabled for this server." });
            return;
          }
          if (await hasActiveOrPendingMatch(pool, onev1Website.serverId)) {
            json(res, 409, {
              ok: false,
              error:
                "A 1v1 is already in progress or waiting for acceptance on this server. Please wait.",
            });
            return;
          }
          const [chalBusy, oppBusy] = await Promise.all([
            discordUserHasAnyActiveEventParticipation(pool, guildRowId, discordUserId),
            discordUserHasAnyActiveEventParticipation(pool, guildRowId, opponentId),
          ]);
          if (chalBusy) {
            json(res, 409, { ok: false, error: EVENT_JOIN_BLOCKED_MESSAGE });
            return;
          }
          if (oppBusy) {
            json(res, 409, {
              ok: false,
              error: "That player is already in an event or 1v1.",
            });
            return;
          }
          const [chalLink, oppLink, chalClan, oppClan] = await Promise.all([
            getLinkByDiscordUser(pool, guildRowId, discordUserId),
            getLinkByDiscordUser(pool, guildRowId, opponentId),
            getClanForEventParticipation(pool, guildRowId, discordUserId),
            getClanForEventParticipation(pool, guildRowId, opponentId),
          ]);
          if (!chalLink || !oppLink) {
            json(res, 403, { ok: false, error: "Both players must be linked." });
            return;
          }
          if (!chalClan || !oppClan) {
            json(res, 403, { ok: false, error: "Both players must be in a clan." });
            return;
          }
          const servers = await listRustServersForGuild(pool, guildRowId);
          const nick =
            servers.find((s) => String(s.id) === String(onev1Website.serverId))?.nickname ?? "Server";
          const created = await createAndAnnounceOneV1Match(client, pool, {
            guildRowId,
            rustServerId: onev1Website.serverId,
            challengerDiscordId: discordUserId,
            opponentDiscordId: opponentId,
            serverNickname: nick,
            announcementChannelId: cfg.announcementChannelId,
          });
          if (!created.ok) {
            json(res, 400, { ok: false, error: created.error });
            return;
          }
          let chName = "A player";
          try {
            const u = await client.users.fetch(discordUserId);
            chName = u.globalName ?? u.username;
          } catch {
            /* ignore */
          }
          void insertSiteInboxMessage(
            pool,
            opponentId,
            "onev1_nominated",
            "1v1 nomination",
            `${chName} nominated you for a 1v1 on **${nick}**. Accept or duck on the website or in Discord.`,
            { matchId: created.matchId, rustServerId: onev1Website.serverId }
          ).catch(() => {});
          json(res, 200, { ok: true, matchId: created.matchId });
          return;
        }

        if (onev1Website.kind === "match" && req.method === "POST") {
          if (onev1Website.action === "accept") {
            const v = await validateOneV1Accept(pool, onev1Website.matchId, discordUserId);
            if (!v.ok) {
              json(res, 400, { ok: false, error: v.error });
              return;
            }
            if (v.data.match.rustServerId !== onev1Website.serverId) {
              json(res, 400, { ok: false, error: "This match is not for this server." });
              return;
            }
            try {
              await commitOneV1Accept(client, pool, v.data);
            } catch (e) {
              console.error("[1v1] web accept failed", e);
              json(res, 500, { ok: false, error: "Failed to accept challenge." });
              return;
            }
            json(res, 200, { ok: true });
            return;
          }
          if (onev1Website.action === "duck") {
            const v = await validateOneV1Duck(pool, onev1Website.matchId, discordUserId);
            if (!v.ok) {
              json(res, 400, { ok: false, error: v.error });
              return;
            }
            if (v.match.rustServerId !== onev1Website.serverId) {
              json(res, 400, { ok: false, error: "This match is not for this server." });
              return;
            }
            try {
              await commitOneV1Duck(client, pool, v.match);
            } catch (e) {
              console.error("[1v1] web duck failed", e);
              json(res, 500, { ok: false, error: "Failed to duck challenge." });
              return;
            }
            json(res, 200, { ok: true });
            return;
          }
        }

        json(res, 405, { ok: false, error: "Method not allowed." });
        return;
      }

      // Best-effort cleanup of expired snapshots (cheap).
      if (Math.random() < 0.02) {
        void deleteExpiredSnapshots(pool).catch(() => {});
      }

      // --- Events (KOTH + Maze) ---
      if (path.startsWith("/api/server/") && path.endsWith("/events") && req.method === "GET") {
        const serverId = parseServerIdFromPath(path, "/api/server/");
        if (!serverId) {
          json(res, 400, { ok: false, error: "Invalid server id." });
          return;
        }
        const guildRowId = await getGuildRowIdForRustServerId(pool, serverId);
        if (!guildRowId) {
          json(res, 404, { ok: false, error: "Server not found." });
          return;
        }

        const [kCfg, kMeta, mCfg, mMeta, nCfg, nMeta, ov1Cfg, ov1Match, dCfg] = await Promise.all([
          getKothConfig(pool, guildRowId, serverId),
          getActiveKothEventMeta(pool, guildRowId, serverId),
          getMazeConfig(pool, guildRowId, serverId),
          getActiveMazeEventMeta(pool, guildRowId, serverId),
          getNuketownConfig(pool, guildRowId, serverId),
          getActiveNuketownEventMeta(pool, guildRowId, serverId),
          getOneV1Config(pool, guildRowId, serverId),
          getMatchForServer(pool, serverId),
          getDockedCargoConfig(pool, guildRowId, serverId),
        ]);

        const [kEnded, mEnded, nEnded, ov1Ended] = await Promise.all([
          getLatestUnexpiredSnapshot(pool, guildRowId, serverId, "koth"),
          getLatestUnexpiredSnapshot(pool, guildRowId, serverId, "maze"),
          getLatestUnexpiredSnapshot(pool, guildRowId, serverId, "nuketown"),
          getLatestUnexpiredSnapshot(pool, guildRowId, serverId, "onev1"),
        ]);

        const kEventId = kMeta?.id ?? null;
        const mEventId = mMeta?.id ?? null;
        const nEventId = nMeta?.id ?? null;

        const kothDoorMs = getKothDoorDelayMs();

        let kothPhase: "door_delay" | "wave_active" | "between_waves" | null = null;
        let kothPhaseEndsAtMs: number | null = null;

        if (
          kMeta?.status === "running" &&
          kMeta.waveStartedAtMs != null &&
          kMeta.durationPerWaveMin != null &&
          kMeta.durationPerWaveMin > 0
        ) {
          const t0 = kMeta.waveStartedAtMs;
          const durMs = kMeta.durationPerWaveMin * 60_000;
          const tDoors = t0 + kothDoorMs;
          const tWaveEnd = t0 + kothDoorMs + durMs;
          const now = Date.now();

          if (now < tDoors) {
            kothPhase = "door_delay";
            kothPhaseEndsAtMs = tDoors;
          } else if (now < tWaveEnd) {
            kothPhase = "wave_active";
            kothPhaseEndsAtMs = tWaveEnd;
          } else if (kMeta.wavesTotal != null && kMeta.currentWave < kMeta.wavesTotal) {
            kothPhase = "between_waves";
            kothPhaseEndsAtMs = null;
          }
        }

        const [kMembers, kParticipants, mMembers, mSpawns, nMembers, nTeams, nParticipants] = await Promise.all([
          kEventId ? countEventMembers(pool, kEventId) : Promise.resolve(0),
          kEventId ? listKothParticipantsWithGatesAndClan(pool, guildRowId, kEventId) : Promise.resolve([]),
          mEventId ? countMazeEventMembers(pool, mEventId) : Promise.resolve(0),
          mEventId ? listMazeSpawnViews(pool, guildRowId, mEventId) : Promise.resolve([]),
          nEventId ? countNuketownMembers(pool, nEventId) : Promise.resolve(0),
          nEventId ? listNuketownTeams(pool, nEventId) : Promise.resolve([]),
          nEventId ? listNuketownParticipants(pool, guildRowId, nEventId) : Promise.resolve([]),
        ]);

        const kStatus =
          kMeta?.status === "running" ? "active" : kMeta?.status === "lobby" ? "pending" : "none";
        const mStatus =
          mMeta?.status === "running" ? "active" : mMeta?.status === "lobby" ? "pending" : "none";
        const nStatus =
          nMeta?.status === "running" ? "active" : nMeta?.status === "lobby" ? "pending" : "none";

        const ov1Status = ov1Match
          ? ov1Match.status === "pending"
            ? "pending"
            : "running"
          : "none";

        let onev1MatchOut: {
          matchId: number;
          challengerDiscordId: string;
          opponentDiscordId: string;
          challenger: {
            discordUserId: string;
            ingameName: string;
            clanTag: string;
            clanName: string;
            clanColor: string | null;
          };
          opponent: {
            discordUserId: string;
            ingameName: string;
            clanTag: string;
            clanName: string;
            clanColor: string | null;
          };
          state: unknown;
        } | null = null;
        if (ov1Match) {
          const uid1 = ov1Match.challengerDiscordId;
          const uid2 = ov1Match.opponentDiscordId;
          const [l1, c1, l2, c2] = await Promise.all([
            getLinkByDiscordUser(pool, guildRowId, uid1),
            getMemberClan(pool, guildRowId, uid1),
            getLinkByDiscordUser(pool, guildRowId, uid2),
            getMemberClan(pool, guildRowId, uid2),
          ]);
          const pack = (
            uid: string,
            link: typeof l1,
            clan: typeof c1
          ): {
            discordUserId: string;
            ingameName: string;
            clanTag: string;
            clanName: string;
            clanColor: string | null;
          } => ({
            discordUserId: uid,
            ingameName: link?.ingameName ?? "",
            clanTag: clan?.clanTag ?? "",
            clanName: clan?.clanName ?? "",
            clanColor: clan?.clanColor ?? null,
          });
          onev1MatchOut = {
            matchId: ov1Match.id,
            challengerDiscordId: uid1,
            opponentDiscordId: uid2,
            challenger: pack(uid1, l1, c1),
            opponent: pack(uid2, l2, c2),
            state: ov1Match.stateJson,
          };
        }

        json(res, 200, {
          ok: true,
          serverId,
          /** Wall time on the bot host when this payload was built — clients should derive countdowns from this + monotonic elapsed time to avoid device clock skew. */
          serverNowMs: Date.now(),
          koth: {
            status: kStatus,
            phase: kothPhase,
            phaseEndsAtMs: kothPhaseEndsAtMs,
            currentWave: kMeta?.currentWave ?? null,
            wavesTotal: kMeta?.wavesTotal ?? null,
            teleportCountdownMs: 0,
            doorDelayMs: kothDoorMs,
            gatesTotal: kCfg?.gates ?? null,
            teamLimit: kCfg?.teamLimit ?? null,
            automationStarted: kCfg?.automationStarted ?? false,
            nextLobbyAtMs: kCfg?.nextLobbyAtMs ?? null,
            lobbyEndsAtMs: kMeta?.lobbyEndsAtMs ?? null,
            joined: kMembers,
            participants: kParticipants.map((p) => ({
              discordUserId: p.discordUserId,
              ingameName: p.ingameName,
              clanId: p.clanId,
              clanName: (p as { clanName: string }).clanName,
              gateNumber: p.gateNumber,
            })),
            ended: kEnded
              ? { status: "ended", expiresAtMs: kEnded.expiresAtMs, payload: kEnded.payload }
              : null,
          },
          maze: {
            status: mStatus,
            spawnPointsTotal: mCfg ? Math.min(mCfg.spawnPoints, MAZE_MAX_SPAWN_POINTS) : null,
            automationStarted: mCfg?.automationStarted ?? false,
            nextLobbyAtMs: mCfg?.nextLobbyAtMs ?? null,
            lobbyEndsAtMs: mMeta?.lobbyEndsAtMs ?? null,
            joined: mMembers,
            participants: mSpawns.map((p) => ({
              discordUserId: p.discordUserId,
              ingameName: p.ingameName,
              clanName: p.clanName,
              spawnNumber: p.spawnNumber,
            })),
            ended: mEnded
              ? { status: "ended", expiresAtMs: mEnded.expiresAtMs, payload: mEnded.payload }
              : null,
          },
          nuketown: {
            status: nStatus,
            lobbyEndsAtMs: nMeta?.lobbyEndsAtMs ?? null,
            teamLimit: nCfg?.teamLimit ?? nMeta?.teamLimit ?? null,
            joined: nMembers,
            teams: nTeams.map((t) => ({ slot: t.slot, clanId: t.clanId })),
            participants: nParticipants.map((p) => ({
              discordUserId: p.discordUserId,
              ingameName: p.ingameName,
              clanId: p.clanId,
              clanName: p.clanName,
              clanTag: p.clanTag,
              clanColor: (p as any).clanColor ?? null,
              teamSlot: nTeams.find((t) => t.clanId === p.clanId)?.slot ?? null,
            })),
            bracket: nMeta?.bracketJson ?? null,
            ended: nEnded
              ? { status: "ended", expiresAtMs: nEnded.expiresAtMs, payload: nEnded.payload }
              : null,
          },
          onev1: {
            enabled: ov1Cfg?.enabled ?? false,
            configured: Boolean(ov1Cfg),
            status: ov1Status,
            match: onev1MatchOut,
            ended: ov1Ended
              ? { status: "ended", expiresAtMs: ov1Ended.expiresAtMs, payload: ov1Ended.payload }
              : null,
          },
          dockedCargo: {
            configured: isDockedCargoConfigComplete(dCfg),
            automationStarted: dCfg?.automationStarted ?? false,
            phase: getDockedCargoRuntimePhaseFromConfig(dCfg),
            active: getDockedCargoRuntimePhaseFromConfig(dCfg) === "docked",
            phaseEndsAtMs: dCfg?.phaseDeadlineMs ?? null,
          },
        });
        return;
      }

      // --- Event actions (join/leave from website) ---
      if (path.startsWith("/api/server/") && path.includes("/events/") && req.method === "POST") {
        const serverId = parseServerIdFromPath(path, "/api/server/");
        if (!serverId) {
          json(res, 400, { ok: false, error: "Invalid server id." });
          return;
        }
        const discordUserId = String(req.headers["x-discord-user-id"] ?? "").trim();
        if (!discordUserId) {
          json(res, 401, { ok: false, error: "Missing user." });
          return;
        }
        const guildRowId = await getGuildRowIdForRustServerId(pool, serverId);
        if (!guildRowId) {
          json(res, 404, { ok: false, error: "Server not found." });
          return;
        }

        const settings = await getClanSettings(pool, guildRowId);
        if (!settings.enabled) {
          json(res, 403, { ok: false, error: "Clan system disabled." });
          return;
        }

        const link = await getLinkByDiscordUser(pool, guildRowId, discordUserId);
        if (!link) {
          json(res, 403, { ok: false, error: "You must link before joining events." });
          return;
        }

        const suffix = path.slice(`/api/server/${serverId}/events/`.length); // e.g. koth/join
        const [eventTypeRaw, actionRaw] = suffix.split("/").filter(Boolean);
        const eventType = String(eventTypeRaw ?? "").toLowerCase();
        const action = String(actionRaw ?? "").toLowerCase();
        if (!["koth", "maze", "nuketown"].includes(eventType) || !["join", "leave"].includes(action)) {
          json(res, 404, { ok: false, error: "Unknown event action." });
          return;
        }

        const guildDiscordId = await getDiscordGuildIdByRowId(pool, guildRowId);
        const guild =
          client && guildDiscordId ? client.guilds.cache.get(guildDiscordId) ?? (await client.guilds.fetch(guildDiscordId).catch(() => null)) : null;

        const servers = await listRustServersForGuild(pool, guildRowId);
        const srv = servers.find((s) => String(s.id) === String(serverId));
        const serverName = srv?.nickname ?? "Server";

        if (eventType === "nuketown") {
          const modeParam = new URL(req.url ?? "http://localhost").searchParams.get("mode") ?? "nuketown";
          const mode = modeParam === "tournament" ? "tournament" : "nuketown";
          const config = await getNuketownConfig(pool, guildRowId, serverId, mode);
          if (!config || !config.messageId) {
            json(res, 409, { ok: false, error: "Nuketown is not setup." });
            return;
          }

          if (action === "join") {
            const clan = await getMemberClan(pool, guildRowId, discordUserId);
            if (!clan) {
              json(res, 403, { ok: false, error: "You must be in a clan to join Nuketown." });
              return;
            }
            const slotsNt = await listActiveEventParticipationSlots(pool, guildRowId, discordUserId);
            if (joinTargetConflictsWithExistingSlots({ kind: "nuketown", rustServerId: serverId }, slotsNt)) {
              json(res, 409, { ok: false, error: EVENT_JOIN_BLOCKED_MESSAGE });
              return;
            }
            const lobby = await ensureLobbyNuketownForJoin(pool, guildRowId, serverId, 5, mode);
            if (!lobby.ok) {
              json(res, 409, { ok: false, error: "Nuketown already started. You can't join mid-match." });
              return;
            }
            const eventId = lobby.eventId;

            let slot = await getNuketownTeamSlot(pool, eventId, clan.clanId);
            if (slot == null) {
              const currentTeams = await listNuketownTeams(pool, eventId);
              const maxClans = mode === "tournament" ? 4 : 2;
              if (currentTeams.length >= maxClans) {
                json(res, 409, { ok: false, error: `This Nuketown lobby already has ${maxClans} clans.` });
                return;
              }
              const used = new Set(currentTeams.map((t) => t.slot));
              let found: number | null = null;
              for (let i = 1; i <= maxClans; i++) {
                if (!used.has(i)) {
                  found = i;
                  break;
                }
              }
              if (found == null) {
                json(res, 409, { ok: false, error: "All team slots are taken." });
                return;
              }
              await assignNuketownTeamSlot(pool, eventId, found, clan.clanId);
              slot = found;
            }

            const r = await addNuketownEventMember(pool, eventId, clan.clanId, discordUserId, config.teamLimit);
            if (r === "already_joined") {
              json(res, 200, { ok: true, joined: false, already: true, message: "Already joined." });
              return;
            }
            if (r === "team_full") {
              json(res, 409, { ok: false, error: `Your clan already has ${config.teamLimit} member(s) in this event.` });
              return;
            }

            if (guild && config.messageId) {
              const meta = await getActiveNuketownEventMeta(pool, guildRowId, serverId);
              const teams = await listNuketownTeams(pool, eventId);
              const participants = await listNuketownParticipants(pool, guildRowId, eventId);
              const byClan = new Map<number, string[]>();
              const metaClan = new Map<number, { clanName: string; clanTag: string }>();
              for (const p of participants) {
                metaClan.set(p.clanId, { clanName: p.clanName, clanTag: p.clanTag });
                const arr = byClan.get(p.clanId) ?? [];
                arr.push(p.ingameName);
                byClan.set(p.clanId, arr);
              }
              const views = teams
                .map((t) => ({
                  slot: t.slot,
                  clanTag: metaClan.get(t.clanId)?.clanTag ?? "",
                  clanName: metaClan.get(t.clanId)?.clanName ?? "Clan",
                  members: (byClan.get(t.clanId) ?? []).slice(0, 20),
                }))
                .sort((a, b) => a.slot - b.slot);
              await updateNuketownMessage(
                client!,
                config.announcementChannelId,
                config.messageId,
                serverName,
                serverName,
                views,
                meta?.lobbyEndsAtMs ?? null,
                config.teamLimit,
                mode === "tournament" ? "tournament" : "nuketown",
                meta?.id ?? eventId
              ).catch(() => {});
            }

            json(res, 200, { ok: true, joined: true, teamSlot: slot });
            return;
          }

          // leave
          const activeEv = await getActiveNuketownEventMeta(pool, guildRowId, serverId);
          if (!activeEv) {
            json(res, 409, { ok: false, error: "No active Nuketown lobby or match." });
            return;
          }
          if (activeEv.status !== "lobby") {
            json(res, 409, { ok: false, error: "You can only leave during the lobby (before start)." });
            return;
          }
          const clan = await getMemberClan(pool, guildRowId, discordUserId);
          if (!clan) {
            json(res, 409, { ok: false, error: "You are not in a clan." });
            return;
          }
          const removed = await removeNuketownEventMember(pool, activeEv.id, discordUserId);
          if (!removed) {
            json(res, 200, { ok: true, left: false, already: true, message: "Not joined." });
            return;
          }
          await removeNuketownTeamIfEmpty(pool, activeEv.id, clan.clanId);

          if (guild && config?.messageId) {
            const teams = await listNuketownTeams(pool, activeEv.id);
            const participants = await listNuketownParticipants(pool, guildRowId, activeEv.id);
            const byClan = new Map<number, string[]>();
            const metaClan = new Map<number, { clanName: string; clanTag: string }>();
            for (const p of participants) {
              metaClan.set(p.clanId, { clanName: p.clanName, clanTag: p.clanTag });
              const arr = byClan.get(p.clanId) ?? [];
              arr.push(p.ingameName);
              byClan.set(p.clanId, arr);
            }
            const views = teams
              .map((t) => ({
                slot: t.slot,
                clanTag: metaClan.get(t.clanId)?.clanTag ?? "",
                clanName: metaClan.get(t.clanId)?.clanName ?? "Clan",
                members: (byClan.get(t.clanId) ?? []).slice(0, 20),
              }))
              .sort((a, b) => a.slot - b.slot);
            await updateNuketownMessage(
              client!,
              config!.announcementChannelId,
              config!.messageId!,
              serverName,
              serverName,
              views,
              activeEv.lobbyEndsAtMs,
              config!.teamLimit,
              mode === "tournament" ? "tournament" : "nuketown",
              activeEv.id
            ).catch(() => {});
          }

          json(res, 200, { ok: true, left: true });
          return;
        }

        if (eventType === "koth") {
          const config = await getKothConfig(pool, guildRowId, serverId);
          if (!config || !config.messageId) {
            json(res, 409, { ok: false, error: "KOTH is not setup." });
            return;
          }

          if (action === "join") {
            const clan = await getMemberClan(pool, guildRowId, discordUserId);
            if (!clan) {
              json(res, 403, { ok: false, error: "You must be in a clan to join KOTH." });
              return;
            }
            const slotsK = await listActiveEventParticipationSlots(pool, guildRowId, discordUserId);
            if (joinTargetConflictsWithExistingSlots({ kind: "koth", rustServerId: serverId }, slotsK)) {
              json(res, 409, { ok: false, error: EVENT_JOIN_BLOCKED_MESSAGE });
              return;
            }
            const lobby = await ensureLobbyEventForJoin(pool, guildRowId, serverId);
            if (!lobby.ok) {
              json(res, 409, { ok: false, error: "KOTH already started. You can't join mid-match." });
              return;
            }
            const eventId = lobby.eventId;

            let gate = await getClanGate(pool, eventId, clan.clanId);
            if (gate == null) {
              const gates = await listGateViews(pool, eventId);
              const used = new Set(gates.map((g) => g.gateNumber));
              let found: number | null = null;
              for (let i = 1; i <= config.gates; i++) {
                if (!used.has(i)) {
                  found = i;
                  break;
                }
              }
              if (found == null) {
                json(res, 409, { ok: false, error: "All gates are taken." });
                return;
              }
              await assignGate(pool, eventId, found, clan.clanId);
              gate = found;
            }

            const r = await addEventMember(pool, eventId, clan.clanId, discordUserId, config.teamLimit);
            if (r === "already_joined") {
              json(res, 200, { ok: true, joined: false, already: true, message: "Already joined." });
              return;
            }
            if (r === "team_full") {
              json(res, 409, { ok: false, error: `Your clan already has ${config.teamLimit} member(s) in this event.` });
              return;
            }

            if (guild && config.messageId) {
              const views = await listGateViews(pool, eventId);
              const meta = await getActiveKothEventMeta(pool, guildRowId, serverId);
              const countdownEndsAtMs =
                meta?.status === "lobby"
                  ? meta.lobbyEndsAtMs ?? null
                  : meta?.status === "running" && meta.waveStartedAtMs != null && meta.durationPerWaveMin != null
                    ? meta.waveStartedAtMs + meta.durationPerWaveMin * 60_000
                    : null;
              await updateKothMessage(
                client!,
                config.announcementChannelId,
                config.messageId,
                serverName,
                serverName,
                views,
                meta?.id ?? eventId,
                countdownEndsAtMs
              ).catch(() => {});
            }

            json(res, 200, { ok: true, joined: true, gateNumber: gate });
            return;
          }

          // leave
          const activeEv = await getActiveKothEvent(pool, guildRowId, serverId);
          if (!activeEv) {
            json(res, 409, { ok: false, error: "No active KOTH lobby or match." });
            return;
          }
          if (activeEv.status !== "lobby") {
            json(res, 409, { ok: false, error: "You can only leave during the lobby (before start)." });
            return;
          }
          const clan = await getMemberClan(pool, guildRowId, discordUserId);
          if (!clan) {
            json(res, 409, { ok: false, error: "You are not in a clan." });
            return;
          }
          const removed = await removeEventMember(pool, activeEv.id, discordUserId);
          if (!removed) {
            json(res, 200, { ok: true, left: false, already: true, message: "Not joined." });
            return;
          }
          await removeGateIfEmpty(pool, activeEv.id, clan.clanId);
          if (guild && config?.messageId) {
            const views = await listGateViews(pool, activeEv.id);
            const meta = await getActiveKothEventMeta(pool, guildRowId, serverId);
            const countdownEndsAtMs =
              meta?.status === "lobby"
                ? meta.lobbyEndsAtMs ?? null
                : meta?.status === "running" && meta.waveStartedAtMs != null && meta.durationPerWaveMin != null
                  ? meta.waveStartedAtMs + meta.durationPerWaveMin * 60_000
                  : null;
            await updateKothMessage(
              client!,
              config!.announcementChannelId,
              config!.messageId!,
              serverName,
              serverName,
              views,
              meta?.id ?? activeEv.id,
              countdownEndsAtMs
            ).catch(() => {});
          }
          json(res, 200, { ok: true, left: true });
          return;
        }

        // Maze
        const config = await getMazeConfig(pool, guildRowId, serverId);
        if (!config || !config.messageId) {
          json(res, 409, { ok: false, error: "Maze is not setup." });
          return;
        }

        if (action === "join") {
          const clan = await getClanForEventParticipation(pool, guildRowId, discordUserId);
          if (!clan) {
            json(res, 403, { ok: false, error: "You must be in a clan (or be the clan owner) to join Maze." });
            return;
          }
          const slotsM = await listActiveEventParticipationSlots(pool, guildRowId, discordUserId);
          if (joinTargetConflictsWithExistingSlots({ kind: "maze", rustServerId: serverId }, slotsM)) {
            json(res, 409, { ok: false, error: EVENT_JOIN_BLOCKED_MESSAGE });
            return;
          }
          const lobby = await ensureLobbyMazeForJoin(pool, guildRowId, serverId);
          if (!lobby.ok) {
            json(res, 409, { ok: false, error: "Maze already started. You can't join mid-event." });
            return;
          }
          const eventId = lobby.eventId;
          const cap = Math.min(config.spawnPoints, MAZE_MAX_PLAYERS);
          const current = await countMazeEventMembers(pool, eventId);
          if (current >= cap) {
            json(res, 409, { ok: false, error: "Maze lobby is full." });
            return;
          }
          const spawn = await findFreeMazeSpawn(pool, eventId, cap);
          if (spawn == null) {
            json(res, 409, { ok: false, error: "No free spawn slot." });
            return;
          }
          const r = await addMazeEventMember(pool, eventId, clan.clanId, discordUserId, spawn);
          if (r === "already_joined") {
            json(res, 200, { ok: true, joined: false, already: true, message: "Already joined." });
            return;
          }
          if (guild && config.messageId) {
            const views = await listMazeSpawnViews(pool, guildRowId, eventId);
            const meta = await getActiveMazeEventMeta(pool, guildRowId, serverId);
            const durationMinutes = meta?.durationMinutes ?? null;
            const countdownEndsAtMs =
              meta?.status === "lobby"
                ? meta.lobbyEndsAtMs ?? null
                : meta?.startedAtMs != null && meta?.durationMinutes != null
                  ? meta.startedAtMs + meta.durationMinutes * 60_000
                  : null;
            await updateMazeMessage(
              client!,
              config.announcementChannelId,
              config.messageId,
              serverName,
              serverName,
              views,
              durationMinutes,
              countdownEndsAtMs
            ).catch(() => {});
          }
          json(res, 200, { ok: true, joined: true, spawnNumber: spawn });
          return;
        }

        // leave
        const activeEv = await getActiveMazeEvent(pool, guildRowId, serverId);
        if (!activeEv) {
          json(res, 409, { ok: false, error: "No active Maze lobby or match." });
          return;
        }
        if (activeEv.status !== "lobby") {
          json(res, 409, { ok: false, error: "You can only leave during the lobby (before start)." });
          return;
        }
        const clan = await getClanForEventParticipation(pool, guildRowId, discordUserId);
        if (!clan) {
          json(res, 409, { ok: false, error: "You are not eligible for this event roster." });
          return;
        }
        const removed = await removeMazeEventMember(pool, activeEv.id, discordUserId);
        if (!removed) {
          json(res, 200, { ok: true, left: false, already: true, message: "Not joined." });
          return;
        }
        if (guild && config.messageId) {
          const views = await listMazeSpawnViews(pool, guildRowId, activeEv.id);
          const meta = await getActiveMazeEventMeta(pool, guildRowId, serverId);
          const durationMinutes = meta?.durationMinutes ?? null;
          const countdownEndsAtMs =
            meta?.status === "lobby"
              ? meta.lobbyEndsAtMs ?? null
              : meta?.startedAtMs != null && meta?.durationMinutes != null
                ? meta.startedAtMs + meta.durationMinutes * 60_000
                : null;
          await updateMazeMessage(
            client!,
            config.announcementChannelId,
            config.messageId,
            serverName,
            serverName,
            views,
            durationMinutes,
            countdownEndsAtMs
          ).catch(() => {});
        }
        json(res, 200, { ok: true, left: true });
        return;
      }

      // --- Leaderboard (linked players only) ---
      if (path.startsWith("/api/server/") && path.endsWith("/leaderboard") && req.method === "GET") {
        const serverId = parseServerIdFromPath(path, "/api/server/");
        if (!serverId) {
          json(res, 400, { ok: false, error: "Invalid server id." });
          return;
        }
        const guildRowId = await getGuildRowIdForRustServerId(pool, serverId);
        if (!guildRowId) {
          json(res, 404, { ok: false, error: "Server not found." });
          return;
        }

        const rows = await getTopClansForServerLeaderboard(pool, guildRowId, serverId, 12);
        const list = rows.map((r) => ({
          clanId: r.clanId,
          clanName: r.clanName,
          clanTag: r.clanTag,
          memberCount: r.memberCount,
          kills: r.kills,
          deaths: r.deaths,
          kdRatio: formatKdRatio(r.kills, r.deaths),
        }));

        json(res, 200, { ok: true, serverId, leaderboard: list });
        return;
      }

      // --- My stats + linking (per server -> guild) ---
      if (path.startsWith("/api/server/") && path.endsWith("/me/stats") && req.method === "GET") {
        const serverId = parseServerIdFromPath(path, "/api/server/");
        if (!serverId) {
          json(res, 400, { ok: false, error: "Invalid server id." });
          return;
        }
        const discordUserId = String(req.headers["x-discord-user-id"] ?? "").trim();
        if (!discordUserId) {
          json(res, 401, { ok: false, error: "Missing user." });
          return;
        }
        const guildRowId = await getGuildRowIdForRustServerId(pool, serverId);
        if (!guildRowId) {
          json(res, 404, { ok: false, error: "Server not found." });
          return;
        }
        const link = await getLinkByDiscordUser(pool, guildRowId, discordUserId);
        if (!link) {
          json(res, 200, { ok: true, linked: false });
          return;
        }
        const [rows] = await pool.query(
          `SELECT kills, deaths FROM rust_player_kd
           WHERE guild_id = :gid AND rust_server_id = :sid AND LOWER(TRIM(ingame_name)) = LOWER(TRIM(:name))
           LIMIT 1`,
          { gid: guildRowId, sid: serverId, name: link.ingameName }
        );
        const r = (rows as { kills: number; deaths: number }[])[0];
        const kills = r ? Number(r.kills) : 0;
        const deaths = r ? Number(r.deaths) : 0;
        json(res, 200, { ok: true, linked: true, ingameName: link.ingameName, kills, deaths, kdRatio: formatKdRatio(kills, deaths) });
        return;
      }

      if (path.startsWith("/api/server/") && path.endsWith("/me/link") && req.method === "POST") {
        const serverId = parseServerIdFromPath(path, "/api/server/");
        if (!serverId) {
          json(res, 400, { ok: false, error: "Invalid server id." });
          return;
        }
        const discordUserId = String(req.headers["x-discord-user-id"] ?? "").trim();
        if (!discordUserId) {
          json(res, 401, { ok: false, error: "Missing user." });
          return;
        }
        const guildRowId = await getGuildRowIdForRustServerId(pool, serverId);
        if (!guildRowId) {
          json(res, 404, { ok: false, error: "Server not found." });
          return;
        }
        const body = (await readJsonBody(req)) as { ingameName?: string } | null;
        const ingameName = String(body?.ingameName ?? "").trim();
        if (!ingameName) {
          json(res, 400, { ok: false, error: "Missing ingameName." });
          return;
        }

        const existingUserLink = await getLinkByDiscordUser(pool, guildRowId, discordUserId);
        if (existingUserLink) {
          json(res, 409, { ok: false, error: "This Discord account is already linked.", ingameName: existingUserLink.ingameName });
          return;
        }
        const existingNameLink = await getLinkByIngameNameCi(pool, guildRowId, ingameName);
        if (existingNameLink) {
          json(res, 409, { ok: false, error: "That in-game name is already linked to another Discord user." });
          return;
        }

        await insertLink(pool, guildRowId, discordUserId, ingameName);
        json(res, 200, { ok: true, linked: true, ingameName });
        return;
      }

      // --- Clan System (guild-wide; serverId used only to resolve guild) ---
      if (path.startsWith("/api/server/") && path.includes("/clan/")) {
        const serverId = parseServerIdFromPath(path, "/api/server/");
        if (!serverId) {
          json(res, 400, { ok: false, error: "Invalid server id." });
          return;
        }
        const discordUserId = String(req.headers["x-discord-user-id"] ?? "").trim();
        if (!discordUserId) {
          json(res, 401, { ok: false, error: "Missing user." });
          return;
        }
        const guildRowId = await getGuildRowIdForRustServerId(pool, serverId);
        if (!guildRowId) {
          json(res, 404, { ok: false, error: "Server not found." });
          return;
        }

        const settings = await getClanSettings(pool, guildRowId);
        if (!settings.enabled) {
          json(res, 403, { ok: false, error: "Clan system disabled." });
          return;
        }

        const link = await getLinkByDiscordUser(pool, guildRowId, discordUserId);
        if (!link) {
          json(res, 403, { ok: false, error: "You must link before using the clan system." });
          return;
        }

        const guildDiscordId = await getDiscordGuildIdByRowId(pool, guildRowId);
        const guild =
          client && guildDiscordId ? client.guilds.cache.get(guildDiscordId) ?? (await client.guilds.fetch(guildDiscordId).catch(() => null)) : null;

        const tail = path.slice(`/api/server/${serverId}/clan/`.length);

        if (tail === "me" && req.method === "GET") {
          const clan = await getMemberClan(pool, guildRowId, discordUserId);
          if (!clan) {
            json(res, 200, { ok: true, linked: true, inClan: false });
            return;
          }
          const [rows] = await pool.query(
            `SELECT CAST(m.discord_user_id AS CHAR) AS discordUserId, l.ingame_name AS ingameName
             FROM clan_members m
             JOIN discord_links l ON l.guild_id = :gid AND l.discord_user_id = m.discord_user_id
             WHERE m.clan_id = :cid
             ORDER BY l.ingame_name ASC`,
            { gid: guildRowId, cid: clan.clanId }
          );
          const rawMembers = (rows as { discordUserId: string; ingameName: string }[]).map((r) => ({
            discordUserId: String(r.discordUserId),
            ingameName: String(r.ingameName),
          }));

          const fallbackAvatar = (id: string) =>
            `https://cdn.discordapp.com/embed/avatars/${Number.parseInt(id, 10) % 5}.png`;

          // Fetch real avatars from the guild when possible (keeps website looking correct).
          const members = await Promise.all(
            rawMembers.map(async (m) => {
              if (!guild) return { ...m, avatarUrl: fallbackAvatar(m.discordUserId) };
              try {
                const gm = await guild.members.fetch(m.discordUserId);
                return {
                  ...m,
                  avatarUrl: gm.displayAvatarURL({ size: 64, extension: "png" }),
                };
              } catch {
                return { ...m, avatarUrl: fallbackAvatar(m.discordUserId) };
              }
            })
          );
          json(res, 200, {
            ok: true,
            linked: true,
            inClan: true,
            clan: {
              clanId: clan.clanId,
              clanName: clan.clanName,
              clanTag: clan.clanTag,
              clanColor: clan.clanColor,
              ownerDiscordUserId: clan.ownerDiscordUserId,
            },
            members,
          });
          return;
        }

        if (tail === "create" && req.method === "POST") {
          if (!guild) {
            json(res, 500, { ok: false, error: "Discord client not available for clan creation." });
            return;
          }
          const existing = await getMemberClan(pool, guildRowId, discordUserId);
          if (existing) {
            json(res, 409, { ok: false, error: "Already in a clan." });
            return;
          }
          const body = (await readJsonBody(req)) as { name?: string; tag?: string; color?: string } | null;
          const clanName = String(body?.name ?? "").trim();
          const tag = String(body?.tag ?? "").trim().toUpperCase();
          const color = String(body?.color ?? "").trim();
          if (!clanName) {
            json(res, 400, { ok: false, error: "Missing clan name." });
            return;
          }
          if (!/^[A-Z]{4}$/.test(tag)) {
            json(res, 400, { ok: false, error: "Tag must be exactly 4 letters (A-Z)." });
            return;
          }
          const allowed = new Set(["red","orange","yellow","green","blue","purple","black","white","brown","pink","cyan","lime"]);
          if (!allowed.has(color)) {
            json(res, 400, { ok: false, error: "Invalid color." });
            return;
          }

          await deleteExpiredInvites(pool);

          // Create Discord assets first (to keep behavior like Discord commands).
          const role = await createClanRole(guild, clanName, color);
          const category = await ensureClansCategory(guild);
          const channel = await createPrivateClanChannel(guild, category, clanName, role);

          try {
            const member = await guild.members.fetch(discordUserId);
            await member.roles.add(role, "Clan owner role grant");
          } catch {
            /* ignore */
          }

          try {
            await createClan(pool, guildRowId, {
              name: clanName,
              tag,
              color,
              ownerDiscordUserId: discordUserId,
              discordRoleId: role.id,
              discordChannelId: channel.id,
            });
          } catch (e: unknown) {
            const code = typeof e === "object" && e && "code" in e ? String((e as { code: string }).code) : "";
            if (code === "ER_DUP_ENTRY") {
              try { await channel.delete("Rolling back duplicate clan create"); } catch {}
              try { await role.delete("Rolling back duplicate clan create"); } catch {}
              json(res, 409, { ok: false, error: "Clan name or tag already taken in this Discord." });
              return;
            }
            throw e;
          }

          json(res, 200, { ok: true, message: `Your clan ${clanName} has been created.`, clanName, tag, color });
          if (client && guildDiscordId) {
            await refreshActiveClansPanelsForGuild(client, guildDiscordId).catch(() => {});
          }
          return;
        }

        if (tail === "edit" && req.method === "POST") {
          if (!guild) {
            json(res, 500, { ok: false, error: "Discord client not available for clan editing." });
            return;
          }
          const clan = await getMemberClan(pool, guildRowId, discordUserId);
          if (!clan) {
            json(res, 403, { ok: false, error: "No clan." });
            return;
          }
          if (!clan.ownerDiscordUserId || String(clan.ownerDiscordUserId) !== discordUserId) {
            json(res, 403, { ok: false, error: "Only owner can edit." });
            return;
          }

          const body = (await readJsonBody(req)) as { name?: string; tag?: string; color?: string } | null;
          const clanName = String(body?.name ?? "").trim();
          const tag = String(body?.tag ?? "").trim().toUpperCase();
          const color = String(body?.color ?? "").trim();
          if (!clanName) {
            json(res, 400, { ok: false, error: "Missing clan name." });
            return;
          }
          if (!/^[A-Z]{3,4}$/.test(tag)) {
            json(res, 400, { ok: false, error: "Tag must be 3–4 letters (A-Z)." });
            return;
          }
          const allowed = new Set(["red","orange","yellow","green","blue","purple","black","white","brown","pink","cyan","lime"]);
          if (!allowed.has(color)) {
            json(res, 400, { ok: false, error: "Invalid color." });
            return;
          }

          const toChannelName = (s: string) =>
            (s || "clan")
              .trim()
              .toLowerCase()
              .replace(/['"]/g, "")
              .replace(/[^a-z0-9]+/g, "-")
              .replace(/-+/g, "-")
              .replace(/^-|-$/g, "")
              .slice(0, 100);

          try {
            const r = await updateClanDetails(pool, guildRowId, clan.clanId, discordUserId, { name: clanName, tag, color });
            if (r !== "ok") {
              json(res, 403, { ok: false, error: "Only owner can edit." });
              return;
            }
          } catch (e: unknown) {
            const code = typeof e === "object" && e && "code" in e ? String((e as { code: string }).code) : "";
            if (code === "ER_DUP_ENTRY") {
              json(res, 409, { ok: false, error: "Clan name or tag already taken in this Discord." });
              return;
            }
            throw e;
          }

          // Best-effort: rename role/channel to match.
          if (clan.discordRoleId) {
            try {
              const role = await guild.roles.fetch(String(clan.discordRoleId));
              await role?.edit({ name: clanName, color: resolveRoleColor(color), reason: "Clan edited via command center" });
            } catch {}
          }
          if (clan.discordChannelId) {
            try {
              const ch = await guild.channels.fetch(String(clan.discordChannelId));
              if (ch && "setName" in ch) {
                await (ch as { setName: (name: string, reason?: string) => Promise<unknown> }).setName(
                  toChannelName(clanName),
                  "Clan edited via command center"
                );
              }
            } catch {}
          }

          json(res, 200, { ok: true, clanName, tag, color });
          if (client && guildDiscordId) {
            await refreshActiveClansPanelsForGuild(client, guildDiscordId).catch(() => {});
            // Tag may have changed; sync nicknames for all members.
            if (guild) {
              await syncLinkedNicknamesForClan({ pool, guildRowId, guild, clanId: clan.clanId }).catch(() => {});
            }
          }
          return;
        }

        if (tail === "invite" && req.method === "POST") {
          const clan = await getMemberClan(pool, guildRowId, discordUserId);
          if (!clan) {
            json(res, 403, { ok: false, error: "You must be in a clan to invite." });
            return;
          }
          await deleteExpiredInvites(pool);
          const random4 = () => String(Math.floor(Math.random() * 10_000)).padStart(4, "0");
          let code = random4();
          for (let i = 0; i < 15; i++) {
            if (!(await inviteCodeExists(pool, guildRowId, code))) break;
            code = random4();
          }
          const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
          await createInvite(pool, guildRowId, clan.clanId, code, expiresAt);
          json(res, 200, { ok: true, code, expiresAt: expiresAt.toISOString(), clanName: clan.clanName });
          return;
        }

        if (tail === "join" && req.method === "POST") {
          const already = await getMemberClan(pool, guildRowId, discordUserId);
          if (already) {
            json(res, 409, { ok: false, error: "Already in a clan." });
            return;
          }
          const body = (await readJsonBody(req)) as { code?: string } | null;
          const code = String(body?.code ?? "").trim();
          if (!/^\d{4}$/.test(code)) {
            json(res, 400, { ok: false, error: "Invite code must be 4 digits." });
            return;
          }
          const inv = await findInviteByCode(pool, guildRowId, code);
          if (!inv) {
            json(res, 404, { ok: false, error: "Invite code not found." });
            return;
          }
          if (new Date(inv.expiresAt).getTime() <= Date.now()) {
            json(res, 410, { ok: false, error: "Invite code expired." });
            return;
          }

          const members = await countClanMembers(pool, inv.clanId);
          if (members >= settings.maxMembers) {
            json(res, 409, { ok: false, error: "Clan is full." });
            return;
          }

          await addClanMember(pool, inv.clanId, discordUserId);
          if (guild && inv.discordRoleId) {
            try {
              const member = await guild.members.fetch(discordUserId);
              await member.roles.add(inv.discordRoleId, "Clan join");
            } catch {
              /* ignore */
            }
          }
          json(res, 200, { ok: true, clanName: inv.clanName });
          if (client && guildDiscordId) {
            await refreshActiveClansPanelsForGuild(client, guildDiscordId).catch(() => {});
            if (guild) {
              await syncLinkedNicknameForUser({ pool, guildRowId, guild, discordUserId }).catch(() => {});
            }
          }
          return;
        }

        if (tail === "leave" && req.method === "POST") {
          const clan = await getMemberClan(pool, guildRowId, discordUserId);
          if (!clan) {
            json(res, 200, { ok: true, left: false });
            return;
          }
          if (clan.ownerDiscordUserId && String(clan.ownerDiscordUserId) === discordUserId) {
            json(res, 403, { ok: false, error: "Owner can't leave. Promote someone or delete clan." });
            return;
          }
          await removeClanMember(pool, clan.clanId, discordUserId);
          if (guild && clan.discordRoleId) {
            try {
              const member = await guild.members.fetch(discordUserId);
              await member.roles.remove(clan.discordRoleId, "Clan leave");
            } catch {
              /* ignore */
            }
          }
          json(res, 200, { ok: true, left: true });
          if (client && guildDiscordId) {
            await refreshActiveClansPanelsForGuild(client, guildDiscordId).catch(() => {});
            if (guild) {
              await syncLinkedNicknameForUser({ pool, guildRowId, guild, discordUserId }).catch(() => {});
            }
          }
          return;
        }

        if (tail === "kick" && req.method === "POST") {
          const body = (await readJsonBody(req)) as { userId?: string } | null;
          const targetId = String(body?.userId ?? "").trim();
          const myClan = await getMemberClan(pool, guildRowId, discordUserId);
          if (!myClan) return json(res, 403, { ok: false, error: "No clan." });
          if (!myClan.ownerDiscordUserId || String(myClan.ownerDiscordUserId) !== discordUserId) {
            json(res, 403, { ok: false, error: "Only owner can kick." });
            return;
          }
          if (!targetId || targetId === discordUserId) {
            json(res, 400, { ok: false, error: "Invalid target." });
            return;
          }
          const targetClan = await getMemberClan(pool, guildRowId, targetId);
          if (!targetClan || targetClan.clanId !== myClan.clanId) {
            json(res, 404, { ok: false, error: "User not in your clan." });
            return;
          }
          if (String(myClan.ownerDiscordUserId) === targetId) {
            json(res, 403, { ok: false, error: "Can't kick owner." });
            return;
          }
          await removeClanMember(pool, myClan.clanId, targetId);
          if (guild && myClan.discordRoleId) {
            try {
              const member = await guild.members.fetch(targetId);
              await member.roles.remove(myClan.discordRoleId, "Clan kick");
            } catch {}
          }
          json(res, 200, { ok: true });
          if (client && guildDiscordId) {
            await refreshActiveClansPanelsForGuild(client, guildDiscordId).catch(() => {});
            if (guild) {
              await syncLinkedNicknameForUser({ pool, guildRowId, guild, discordUserId: targetId }).catch(() => {});
            }
          }
          return;
        }

        if (tail === "promote" && req.method === "POST") {
          const body = (await readJsonBody(req)) as { userId?: string } | null;
          const targetId = String(body?.userId ?? "").trim();
          const myClan = await getMemberClan(pool, guildRowId, discordUserId);
          if (!myClan) return json(res, 403, { ok: false, error: "No clan." });
          if (!myClan.ownerDiscordUserId || String(myClan.ownerDiscordUserId) !== discordUserId) {
            json(res, 403, { ok: false, error: "Only owner can promote." });
            return;
          }
          const targetClan = await getMemberClan(pool, guildRowId, targetId);
          if (!targetClan || targetClan.clanId !== myClan.clanId) {
            json(res, 404, { ok: false, error: "User not in your clan." });
            return;
          }
          await promoteClanOwner(pool, guildRowId, myClan.clanId, targetId);
          json(res, 200, { ok: true });
          return;
        }

        if (tail === "delete" && req.method === "POST") {
          const body = (await readJsonBody(req)) as { confirm?: string } | null;
          if (String(body?.confirm ?? "") !== "DELETE") {
            json(res, 400, { ok: false, error: "Type DELETE to confirm." });
            return;
          }
          const clan = await getMemberClan(pool, guildRowId, discordUserId);
          if (!clan) return json(res, 403, { ok: false, error: "No clan." });
          if (!clan.ownerDiscordUserId || String(clan.ownerDiscordUserId) !== discordUserId) {
            json(res, 403, { ok: false, error: "Only owner can delete." });
            return;
          }
          const memberIds = await listClanMemberDiscordUserIds(pool, clan.clanId).catch(() => []);
          await deleteClan(pool, guildRowId, clan.clanId);
          if (guild) {
            if (clan.discordChannelId) {
              try { const ch = await guild.channels.fetch(String(clan.discordChannelId)); await ch?.delete("Clan deleted"); } catch {}
            }
            if (clan.discordRoleId) {
              try { const role = await guild.roles.fetch(String(clan.discordRoleId)); await role?.delete("Clan deleted"); } catch {}
            }
          }
          json(res, 200, { ok: true });
          if (client && guildDiscordId) {
            await refreshActiveClansPanelsForGuild(client, guildDiscordId).catch(() => {});
            if (guild) {
              await Promise.all(
                memberIds.map((uid) => syncLinkedNicknameForUser({ pool, guildRowId, guild, discordUserId: uid }).catch(() => {}))
              );
            }
          }
          return;
        }

        if (tail === "stats" && req.method === "GET") {
          const clan = await getMemberClan(pool, guildRowId, discordUserId);
          if (!clan) {
            json(res, 403, { ok: false, error: "You must be in a clan." });
            return;
          }
          const [rows] = await pool.query(
            `SELECT l.ingame_name AS ingameName,
                    CAST(u.discord_user_id AS CHAR) AS discordUserId,
                    COALESCE(k.kills, 0) AS kills,
                    COALESCE(k.deaths, 0) AS deaths
             FROM (
               SELECT CAST(cm.discord_user_id AS CHAR) AS discord_user_id
               FROM clan_members cm
               WHERE cm.clan_id = :cid
               UNION
               SELECT CAST(c.owner_discord_user_id AS CHAR) AS discord_user_id
               FROM clans c
               WHERE c.id = :cid
             ) u
             JOIN discord_links l ON l.guild_id = :gid AND CAST(l.discord_user_id AS CHAR) = u.discord_user_id
             LEFT JOIN rust_player_kd k
               ON k.guild_id = :gid AND k.rust_server_id = :sid AND LOWER(TRIM(k.ingame_name)) = LOWER(TRIM(l.ingame_name))
             `,
            { gid: guildRowId, sid: serverId, cid: clan.clanId }
          );
          const list = (rows as { ingameName: string; discordUserId: string; kills: number; deaths: number }[]).map((r) => ({
            ingameName: String(r.ingameName),
            discordUserId: String(r.discordUserId),
            kills: Number.isFinite(Number(r.kills)) ? Number(r.kills) : 0,
            deaths: Number.isFinite(Number(r.deaths)) ? Number(r.deaths) : 0,
          }));
          const totalKills = list.reduce((s, x) => s + x.kills, 0);
          const totalDeaths = list.reduce((s, x) => s + x.deaths, 0);
          const leaderboard = [...list].sort((a, b) => {
            if (b.kills !== a.kills) return b.kills - a.kills;
            if (a.deaths !== b.deaths) return a.deaths - b.deaths;
            return a.ingameName.localeCompare(b.ingameName);
          });
          const top3 = leaderboard.slice(0, 3);
          json(res, 200, {
            ok: true,
            clan: { clanId: clan.clanId, clanName: clan.clanName, clanTag: clan.clanTag, clanColor: clan.clanColor },
            totalMembers: list.length,
            totalKills,
            totalDeaths,
            kdRatio: formatKdRatio(totalKills, totalDeaths),
            top3,
            leaderboard: leaderboard.slice(0, 12),
          });
          return;
        }

        json(res, 404, { ok: false, error: "Unknown clan endpoint." });
        return;
      }

      if (path === "/api/servers" && req.method === "GET") {
        const now = Date.now();
        // Fast-path: return cached response to keep the dashboard snappy.
        if (serversCache && now - serversCache.atMs < SERVERS_CACHE_TTL_MS) {
          json(res, 200, { ok: true, servers: serversCache.payload, cached: true, ageMs: now - serversCache.atMs });
          return;
        }

        // If we're already refreshing, wait briefly and then return cache if it finished.
        if (serversRefreshInFlight) {
          try {
            await withTimeout(serversRefreshInFlight, 3_000, "servers refresh");
          } catch {
            // ignore; fall through and do our own refresh attempt
          }
          if (serversCache && Date.now() - serversCache.atMs < SERVERS_CACHE_TTL_MS) {
            json(res, 200, { ok: true, servers: serversCache.payload, cached: true, ageMs: Date.now() - serversCache.atMs });
            return;
          }
        }

        const rows = await listAllRustServers(pool);
        // One server at a time: each Rust host already shares a single WebSocket + queue,
        // but overlapping *different* servers still meant concurrent RCON work. Serializing
        // keeps load predictable for picky hosts.
        serversRefreshInFlight = (async () => {
          const results = await mapWithConcurrency(rows, 3, async (row) => {
          const rustServerId = Number(row.id);
          let password: string | null = null;
          try {
            password = decryptSecret(row.rcon_password_encrypted, config.encryptionKeyHex);
          } catch {
            password = null;
          }

          let info: Serverinfo | null = null;
          let hostnameSegments: HostnameSegment[] = [];
          let hostnamePlain = row.nickname;
          let error: string | null = null;

          if (!password) {
            error = "Unable to decrypt RCON password (check ENCRYPTION_KEY).";
          } else {
            // Prefer global.serverinfo, but keep the whole request bounded so one dead server doesn't stall the UI.
            const rGlobal = await runWebRconCommand(
              rustServerId,
              row.server_ip,
              row.rcon_port,
              password,
              "global.serverinfo"
            );
            let r = rGlobal;
            if (!rGlobal.ok) {
              r = await runWebRconCommand(rustServerId, row.server_ip, row.rcon_port, password, "serverinfo");
            } else {
              const parsedGlobal = parseServerinfoJson(rGlobal.message);
              if (!parsedGlobal) {
                r = await runWebRconCommand(rustServerId, row.server_ip, row.rcon_port, password, "serverinfo");
              }
            }
            if (!r.ok) {
              error = r.error;
            } else {
              info = parseServerinfoJson(r.message);
              if (info?.Hostname) {
                const parsed = parseColoredHostname(info.Hostname);
                hostnameSegments = parsed.segments;
                hostnamePlain = parsed.plain || hostnamePlain;
              }
            }
          }

          const slug = slugify(`${row.id}-${hostnamePlain || row.nickname}`);

          return {
            id: row.id,
            guildId: row.guild_id,
            nickname: row.nickname,
            slug,
            ip: row.server_ip,
            rconPort: row.rcon_port,
            hostnameSegments,
            hostnamePlain,
            players: info?.Players ?? null,
            maxPlayers: info?.MaxPlayers ?? null,
            map: info?.Map ?? null,
            uptime: info?.Uptime ?? null,
            ok: error === null,
            error,
          };
          });
          serversCache = { atMs: Date.now(), payload: results };
          return results;
        })().finally(() => {
          serversRefreshInFlight = null;
        });

        const results = (await serversRefreshInFlight) as unknown;

        json(res, 200, { ok: true, servers: results, cached: false });
        return;
      }

      notFound(res);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      json(res, 500, { ok: false, error: msg });
    }
  });

  server.listen(port, "0.0.0.0", () => {
    console.log(`[command-center api] listening on 0.0.0.0:${port}`);
    const vapidOk = Boolean(getEnvOptional("VAPID_PUBLIC_KEY") && getEnvOptional("VAPID_PRIVATE_KEY"));
    if (!vapidOk) {
      console.warn(
        "[command-center api] Web push: set VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, and VAPID_SUBJECT on the bot host (same keys as Netlify public key for subscribe)."
      );
    }
  });
}

