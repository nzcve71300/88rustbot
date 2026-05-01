import { Client, TextChannel } from "discord.js";
import type { Pool } from "mysql2/promise";
import {
  eventResultEmbed,
  formatRankedLeaderboardLines,
  poweredByFooterBlock,
  truncateEmbedDescription,
} from "../embeds/eventResults.js";
import {
  finishMazeEvent,
  getMazeEventTopKillerWithLink,
  listMazeKillLogForEvent,
  listMazeKillsDetailedForEvent,
  listMazeParticipantsForTeleport,
  listMazeSpawnViews,
  getMazeConfig,
  removeMazeEventAndApplyConfigOutcome,
  sumMazeTotalKillsForEvent,
} from "../db/maze.js";
import { buildMazeEndedSay, MAZE_RCON_START, runSayRcon } from "../rcon/eventBroadcasts.js";
import type { RowDataPacket } from "mysql2/promise";
import { mazeKillTracker } from "./killTracker.js";
import { runMazeInitialSpawnWithZones } from "./mazeZones.js";
import { insertEventSnapshot } from "../db/eventSnapshots.js";
import { rewardPlayerLucids } from "../rewards/eventRewards.js";
import { runWebRconCommand } from "../rcon/webrcon.js";
import { applyEventZoneConfigIfPresent } from "../zones/eventZones.js";

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function sleepAbortable(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) throw new Error("Maze aborted");
  const started = Date.now();
  while (Date.now() - started < ms) {
    if (signal.aborted) throw new Error("Maze aborted");
    await sleep(500);
  }
}

function formatMazeKillLogLine(r: import("../db/maze.js").MazeKillLogRow): string {
  const k = `<@${r.killerDiscordUserId}>`;
  if (r.victimDiscordUserId) {
    return `• ${k} eliminated <@${r.victimDiscordUserId}>`;
  }
  return `• ${k} eliminated ${r.victimLabel}`;
}

async function postMazeEndEmbed(
  client: Client,
  pool: Pool,
  guildRowId: number,
  channelId: string,
  eventId: number
): Promise<void> {
  const ch = await client.channels.fetch(channelId);
  if (!ch || !(ch instanceof TextChannel)) return;

  const totalKills = await sumMazeTotalKillsForEvent(pool, eventId);
  const players = await listMazeKillsDetailedForEvent(pool, eventId);
  const killLog = await listMazeKillLogForEvent(pool, guildRowId, eventId);

  const leaderboardBlock = formatRankedLeaderboardLines(players);

  const logSlice = killLog.slice(0, 25);
  let logBlock =
    logSlice.length === 0
      ? "_No individual kill lines logged._"
      : logSlice.map(formatMazeKillLogLine).join("\n");
  if (killLog.length > 25) logBlock += `\n_${killLog.length - 25} more in the log._`;

  const description = truncateEmbedDescription(
    [
      `📊 **Total Kills (Event):** ${totalKills}`,
      "",
      "🏆 **Leaderboard**",
      leaderboardBlock,
      "",
      "📜 **Kill Log**",
      logBlock,
      "",
      poweredByFooterBlock(),
    ].join("\n")
  );

  const embed = eventResultEmbed().setTitle("🧭 **Maze Event — Finished**").setDescription(description);

  await ch.send({ embeds: [embed] });
}

export type MazeRunnerArgs = {
  client: Client;
  pool: Pool;
  guildRowId: number;
  rustServerId: number;
  eventId: number;
  announcementChannelId: string;
  serverNickname: string;
  host: string;
  port: number;
  password: string;
  durationMinutes: number;
  kitName: string;
  /** From maze-setup: all spawn slots 1..spawnPointCount must have coords before /maze-start. */
  spawnPointCount: number;
};

type Running = { rustServerId: number; eventId: number; abort: AbortController };

const running = new Map<number, Running>();

export function requestStopMaze(rustServerId: number): boolean {
  const r = running.get(rustServerId);
  if (!r) return false;
  r.abort.abort();
  return true;
}

export async function runMazeEvent(args: MazeRunnerArgs): Promise<void> {
  const {
    client,
    pool,
    guildRowId,
    rustServerId,
    eventId,
    announcementChannelId,
    serverNickname,
    host,
    port,
    password,
    durationMinutes,
    kitName,
    spawnPointCount,
  } = args;

  const abort = new AbortController();
  running.set(rustServerId, { rustServerId, eventId, abort });

  const [respRows] = await pool.query<RowDataPacket[]>(
    `SELECT respawn_enabled AS r FROM maze_events WHERE id = :eid LIMIT 1`,
    { eid: eventId }
  );
  const respawn = (respRows[0] as { r: number } | undefined)?.r === 1;

  try {
    // Event zones: ensure ACTIVE zone (and remove INACTIVE) while the event is running.
    await applyEventZoneConfigIfPresent({
      pool,
      guildRowId,
      rustServerId,
      eventType: "maze",
      desired: "active",
      rcon: { host, port, password },
    }).catch(() => {});

    // Maze tuning for the duration of the event (best-effort).
    try {
      const res = await runWebRconCommand(rustServerId, host, port, password, "server.corpsedespawn 10");
      if (!res.ok) console.error(`[maze] corpsedespawn(10) failed: ${res.error}`);
    } catch (e) {
      console.error("[maze] corpsedespawn(10) start best-effort failed:", e);
    }

    const participants = await listMazeParticipantsForTeleport(pool, guildRowId, eventId);
    const eligibleForRewards = participants.length / Math.max(1, spawnPointCount) >= 0.6;

    /** Register + roster before initial teleports so console kills / `has entered the game` match this event (and MySQL `id` vs JS number stays consistent via killTracker normalization). */
    mazeKillTracker.register(rustServerId, {
      guildRowId,
      eventId,
      rustServerId,
      respawnEnabled: respawn,
      spawnPointCount,
      kitName,
      rcon: { host, port, password },
      abortSignal: abort.signal,
    });
    await mazeKillTracker.refreshRoster(pool, rustServerId, guildRowId, eventId);

    await runMazeInitialSpawnWithZones({
      pool,
      guildRowId,
      rustServerId,
      kitName,
      host,
      port,
      password,
      signal: abort.signal,
      participants,
    });

    /** “STARTED” say after spawns finish — avoids overlapping RCON with parallel kit/teleport/zone commands. */
    void runSayRcon(rustServerId, host, port, password, MAZE_RCON_START, "maze-start");

    mazeKillTracker.clearEnterGameBuffersForServer(rustServerId);

    await sleepAbortable(durationMinutes * 60_000, abort.signal);

    await mazeKillTracker.drain(rustServerId);
    await postMazeEndEmbed(client, pool, guildRowId, announcementChannelId, eventId);

    try {
      const top = await getMazeEventTopKillerWithLink(pool, guildRowId, eventId);
      const endedCmd = buildMazeEndedSay(top?.clanName ?? "N/A", top?.ingameName ?? "N/A");
      void runSayRcon(rustServerId, host, port, password, endedCmd, "maze-finish");
    } catch (err) {
      console.error("[maze] ended in-game say failed:", err);
    }

    // Safe website support: snapshot results for 10 minutes, then keep existing delete behavior unchanged.
    try {
      const totalKills = await sumMazeTotalKillsForEvent(pool, eventId);
      const players = await listMazeKillsDetailedForEvent(pool, eventId);
      const roster = await listMazeSpawnViews(pool, guildRowId, eventId);
      const top = await getMazeEventTopKillerWithLink(pool, guildRowId, eventId);
      await insertEventSnapshot({
        pool,
        guildRowId,
        rustServerId,
        type: "maze",
        payload: {
          kind: "maze",
          endedAtMs: Date.now(),
          durationMinutes,
          kitName,
          totalKills,
          topKiller: top,
          roster,
          leaderboard: players,
        },
      });
    } catch (err) {
      console.error("[maze] failed to snapshot ended event:", err);
    }

    await removeMazeEventAndApplyConfigOutcome(pool, guildRowId, rustServerId, eventId);

    // Event zones: after event ends, ensure INACTIVE zone (and remove ACTIVE).
    await applyEventZoneConfigIfPresent({
      pool,
      guildRowId,
      rustServerId,
      eventType: "maze",
      desired: "inactive",
      rcon: { host, port, password },
    }).catch(() => {});

    // Restore default despawn once the event is fully over (best-effort).
    try {
      const res = await runWebRconCommand(rustServerId, host, port, password, "server.corpsedespawn 120");
      if (!res.ok) console.error(`[maze] corpsedespawn(120) failed: ${res.error}`);
    } catch (e) {
      console.error("[maze] corpsedespawn(120) end best-effort failed:", e);
    }

    const cfgAfter = await getMazeConfig(pool, guildRowId, rustServerId);
    const doneCh = await client.channels.fetch(announcementChannelId);
    if (doneCh && doneCh instanceof TextChannel) {
      let rewardLine = "";
      try {
        if (eligibleForRewards) {
          const players = await listMazeKillsDetailedForEvent(pool, eventId);
          const winner = players[0];
          if (winner && winner.kills > 0) {
            await rewardPlayerLucids(pool, winner.discordUserId, 15);
            rewardLine = `The clan member **<@${winner.discordUserId}>** got rewarded with **15 Lucids**.`;
          }
        }
      } catch (e) {
        console.error("[maze rewards] failed:", e);
      }
      const nextLine =
        cfgAfter?.automationStarted && cfgAfter.howOftenHours && cfgAfter.howOftenHours > 0
          ? "The next **automatic lobby** is scheduled per your **How often** interval."
          : "Run **/maze-setup** again before the next manual event. **Maze spawn-point** coordinates from **/manage-positions** are kept.";
      const clearedDesc = truncateEmbedDescription(
        [
          `**${serverNickname}** — the Maze event is complete.`,
          "",
          ...(rewardLine ? [rewardLine, ""] : []),
          nextLine,
          "",
          poweredByFooterBlock(),
        ].join("\n")
      );
      await doneCh.send({
        embeds: [
          eventResultEmbed()
            .setTitle(cfgAfter?.automationStarted ? "🧭 **Maze — Round Complete**" : "🧭 **Maze Setup Cleared**")
            .setDescription(clearedDesc),
        ],
      });
    }
  } catch (err) {
    console.error("[maze] runner failed:", err);
    await finishMazeEvent(pool, eventId).catch(() => {});
    const errCh = await client.channels.fetch(announcementChannelId);
    if (errCh && errCh instanceof TextChannel) {
      const errDesc = truncateEmbedDescription(
        [
          `**${serverNickname}** — the event ended early. Check bot logs if this was unexpected.`,
          "",
          poweredByFooterBlock(),
        ].join("\n")
      );
      await errCh.send({
        embeds: [eventResultEmbed().setTitle("🧭 **Maze Event — Stopped**").setDescription(errDesc)],
      });
    }
    try {
      await removeMazeEventAndApplyConfigOutcome(pool, guildRowId, rustServerId, eventId);
    } catch {
      /* ignore */
    }
  } finally {
    mazeKillTracker.unregister(rustServerId);
    running.delete(rustServerId);
  }
}
