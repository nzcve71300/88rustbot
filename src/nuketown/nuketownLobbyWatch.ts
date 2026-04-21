import { TextChannel, type Client } from "discord.js";
import type { Pool } from "mysql2/promise";
import { config } from "../config.js";
import { decryptSecret } from "../crypto/passwordVault.js";
import { insertEventSnapshot } from "../db/eventSnapshots.js";
import {
  deleteNuketownEventOnly,
  finishNuketownEvent,
  getActiveNuketownEventMeta,
  listNuketownParticipants,
  listNuketownTeams,
  setNuketownLobbyEndsAtNow,
  startNuketownEvent,
} from "../db/nuketown.js";
import { getRustServerByIdForGuild } from "../db/rustServers.js";
import { baseEmbed } from "../embeds/standard.js";
import { notifyGuildWebPush } from "../push/webPushNotify.js";
import { runNuketownBracket } from "./runner.js";

/**
 * Same background loop as `/nuketown-setup` — wait for teams / timeout, then start bracket or cancel.
 */
export function scheduleNuketownLobbyWatch(
  client: Client,
  pool: Pool,
  guildRowId: number,
  serverId: number,
  channelId: string,
  kitName: string,
  teamLimit: number,
  gateFrequency: number,
  maxClans: number = 4
): void {
  void (async () => {
    try {
      while (true) {
        const m = await getActiveNuketownEventMeta(pool, guildRowId, serverId);
        if (!m || m.status !== "lobby") return;
        const teams = await listNuketownTeams(pool, m.id);
        const now = Date.now();
        if (teams.length >= Math.max(2, Math.min(4, maxClans))) {
          await setNuketownLobbyEndsAtNow(pool, m.id);
          break;
        }
        if (m.lobbyEndsAtMs != null && now >= m.lobbyEndsAtMs) break;
        await new Promise((r) => setTimeout(r, 2000));
      }

      const m2 = await getActiveNuketownEventMeta(pool, guildRowId, serverId);
      if (!m2 || m2.status !== "lobby") return;

      const teams = await listNuketownTeams(pool, m2.id);
      if (teams.length < 2) {
        const ch = await client.channels.fetch(channelId).catch(() => null);
        if (ch && ch instanceof TextChannel) {
          await ch.send({
            embeds: [baseEmbed().setTitle("Nuketown cancelled").setDescription("Not enough clans joined (need at least **2**).")],
          });
        }

        try {
          await insertEventSnapshot({
            pool,
            guildRowId,
            rustServerId: serverId,
            type: "nuketown",
            payload: { kind: "nuketown", cancelled: true, reason: "Not enough clans joined (need at least 2)." },
          });
        } catch (snapErr) {
          console.error("[nuketown-setup] cancel snapshot failed:", snapErr);
        }
        await finishNuketownEvent(pool, m2.id).catch(() => {});
        await deleteNuketownEventOnly(pool, m2.id).catch(() => {});
        return;
      }

      const participants = await listNuketownParticipants(pool, guildRowId, m2.id);
      const clanMeta = new Map<number, { clanTag: string; clanName: string; clanColor: string | null }>();
      for (const p of participants) clanMeta.set(p.clanId, { clanTag: p.clanTag, clanName: p.clanName, clanColor: (p as { clanColor?: string | null }).clanColor ?? null });
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
          .sort((a, b) => a.slot - b.slot),
        stage: "running" as const,
        currentMatch: null,
        winners: { semi1: null, semi2: null, champion: null },
      };

      const started = await startNuketownEvent(pool, m2.id, kitName, teamLimit, bracket);
      if (!started) return;

      const rustRow = await getRustServerByIdForGuild(pool, guildRowId, serverId);
      if (!rustRow) return;

      void notifyGuildWebPush(pool, guildRowId, serverId, {
        title: "Grindset",
        body: "Nuketown Started. Join now!",
        tag: `nuketown-${m2.id}`,
      });
      const password = decryptSecret(rustRow.rcon_password_encrypted, config.encryptionKeyHex);
      void runNuketownBracket({
        client,
        pool,
        guildRowId,
        rustServerId: serverId,
        eventId: m2.id,
        announcementChannelId: channelId,
        serverNickname: rustRow.nickname,
        host: rustRow.server_ip,
        port: rustRow.rcon_port,
        password,
        kitName,
        gateFrequency,
      });
    } catch (err) {
      console.error("[nuketown-setup] auto-start loop failed:", err);
    }
  })();
}
