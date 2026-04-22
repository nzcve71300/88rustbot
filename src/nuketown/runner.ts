import { Client, TextChannel } from "discord.js";
import type { Pool } from "mysql2/promise";
import { baseEmbed } from "../embeds/standard.js";
import { poweredByFooterBlock, truncateEmbedDescription } from "../embeds/eventResults.js";
import { runWebRconCommand } from "../rcon/webrcon.js";
import { quoteForRconArg } from "../rcon/quote.js";
import { nuketownKillTracker } from "./killTracker.js";
import { rewardDiscordUsersLucids } from "../rewards/eventRewards.js";
import {
  deleteNuketownEventAndClearConfig,
  finishNuketownEvent,
  getNuketownGateCoord,
  listNuketownEventClanDiscordUserIds,
  listNuketownParticipants,
  listNuketownTeams,
  updateNuketownBracketJson,
} from "../db/nuketown.js";

function parseMsEnv(name: string, fallback: number): number {
  const v = process.env[name]?.trim();
  if (v === undefined || v === "") return fallback;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

const ROUND_PREP_MS = parseMsEnv("NUKETOWN_PREP_MS", 60_000);
const DOOR_OPEN_MS = parseMsEnv("NUKETOWN_DOOR_OPEN_MS", 15_000);
const FINAL_PREP_MS = parseMsEnv("NUKETOWN_FINAL_PREP_MS", 30_000);
/** Max wait for one team to be fully eliminated (PvP); avoids hanging forever if killfeed breaks. */
const ROUND_TIMEOUT_MS = parseMsEnv("NUKETOWN_ROUND_TIMEOUT_MS", 45 * 60_000);
const KILL_RETRY_GAP_MS = parseMsEnv("NUKETOWN_KILL_RETRY_GAP_MS", 250);

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function sleepAbortable(ms: number, signal: AbortSignal): Promise<void> {
  if (ms <= 0) return;
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (signal.aborted) throw new Error("Nuketown aborted");
    await sleep(Math.min(500, end - Date.now()));
  }
}

function parseCoordTriple(coord: string): [number, number, number] | null {
  const parts = coord
    .trim()
    .split(/[\s,]+/)
    .map((x) => Number.parseFloat(x))
    .filter((x) => Number.isFinite(x));
  if (parts.length < 3) return null;
  return [parts[0], parts[1], parts[2]];
}

function formatTeleportPosComma(xyz: [number, number, number]): string {
  return `${xyz[0].toFixed(2)},${xyz[1].toFixed(2)},${xyz[2].toFixed(2)}`;
}

async function giveKit(pool: Pool, rustServerId: number, host: string, port: number, password: string, kitName: string, ingameName: string) {
  const kitCmd = `kit givetoplayer "${quoteForRconArg(kitName)}" "${quoteForRconArg(ingameName)}"`;
  const res = await runWebRconCommand(rustServerId, host, port, password, kitCmd);
  if (!res.ok) console.error(`[nuketown] kit failed for ${ingameName}: ${res.error}`);
}

async function teleportPlayer(rustServerId: number, host: string, port: number, password: string, ingameName: string, posComma: string) {
  const tpCmd = `global.teleportpos ${posComma} "${quoteForRconArg(ingameName)}"`;
  const res = await runWebRconCommand(rustServerId, host, port, password, tpCmd);
  if (!res.ok) console.error(`[nuketown] teleport failed for ${ingameName}: ${res.error}`);
}

/**
 * Tries several RCON patterns — servers differ (Oxide `global.killplayer`, Carbon `kill`, etc.).
 * Optional: set `NUKETOWN_KILL_CMD` to a full command with `{name}` replaced by the quoted name.
 */
async function killPlayerWithFallbacks(
  rustServerId: number,
  host: string,
  port: number,
  password: string,
  ingameName: string
): Promise<boolean> {
  const q = quoteForRconArg(ingameName);
  const attempts: string[] = [];
  const custom = process.env.NUKETOWN_KILL_CMD?.trim();
  if (custom) {
    attempts.push(custom.replace(/\{name\}/g, q));
  }
  attempts.push(`global.killplayer "${q}"`);
  attempts.push(`kill "${q}"`);
  attempts.push(`global.kill "${q}"`);

  let lastErr = "";
  for (const cmd of attempts) {
    const res = await runWebRconCommand(rustServerId, host, port, password, cmd);
    if (res.ok) return true;
    lastErr = res.error ?? "unknown";
  }
  console.error(`[nuketown] all kill attempts failed for ${ingameName}: ${lastErr}`);
  return false;
}

async function killRosterSequential(
  rustServerId: number,
  host: string,
  port: number,
  password: string,
  ingameNames: string[]
): Promise<void> {
  for (const name of ingameNames) {
    await killPlayerWithFallbacks(rustServerId, host, port, password, name);
    if (KILL_RETRY_GAP_MS > 0) await sleep(KILL_RETRY_GAP_MS);
  }
}

async function openThenCloseDoors(
  rustServerId: number,
  host: string,
  port: number,
  password: string,
  gateFrequency: number,
  broadcasterXyz: [number, number, number],
  signal: AbortSignal
): Promise<void> {
  const [x, y, z] = broadcasterXyz;
  const spawnCmd = `rf.spawnfakebroadcaster ${gateFrequency} 1000 ${x} ${y} ${z}`;
  const spawnRes = await runWebRconCommand(rustServerId, host, port, password, spawnCmd);
  if (!spawnRes.ok) console.error(`[nuketown] ${spawnCmd}: ${spawnRes.error}`);
  await sleepAbortable(DOOR_OPEN_MS, signal);
  const removeCmd = `rf.removefakeboardcaster`;
  const removeRes = await runWebRconCommand(rustServerId, host, port, password, removeCmd);
  if (!removeRes.ok) console.error(`[nuketown] ${removeCmd}: ${removeRes.error}`);
}

export type NuketownRunnerArgs = {
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
  kitName: string;
  gateFrequency: number;
};

type Running = { rustServerId: number; eventId: number; abort: AbortController };
const running = new Map<number, Running>();

function fmtClanLabel(t: { clanTag: string; clanName: string }): string {
  const tag = t.clanTag?.trim() ? `[${t.clanTag.trim()}] ` : "";
  return `${tag}${t.clanName}`.trim();
}

export function requestStopNuketown(rustServerId: number): boolean {
  const r = running.get(rustServerId);
  if (!r) return false;
  console.warn("[nuketown] abort requested", {
    rustServerId,
    eventId: r.eventId,
    stack: new Error("requestStopNuketown stack").stack,
  });
  r.abort.abort();
  return true;
}

async function postInfo(client: Client, channelId: string, title: string, desc: string): Promise<void> {
  const ch = await client.channels.fetch(channelId);
  if (!ch || !(ch instanceof TextChannel)) return;
  await ch.send({
    embeds: [
      baseEmbed()
        .setTitle(title)
        .setDescription(truncateEmbedDescription([desc, "", poweredByFooterBlock()].join("\n"))),
    ],
  });
}

export async function runNuketownBracket(args: NuketownRunnerArgs): Promise<void> {
  const { client, pool, guildRowId, rustServerId, eventId, announcementChannelId, serverNickname, host, port, password, kitName, gateFrequency } =
    args;

  const abort = new AbortController();
  running.set(rustServerId, { rustServerId, eventId, abort });
  nuketownKillTracker.register(rustServerId, { guildRowId, rustServerId, abortSignal: abort.signal });

  try {
    const teams = await listNuketownTeams(pool, eventId);
    if (teams.length < 2) throw new Error("Not enough teams for Nuketown (need at least 2 clans).");

    const participants = await listNuketownParticipants(pool, guildRowId, eventId);
    const clanMetaById = new Map<number, { clanTag: string; clanName: string; clanColor: string | null }>();
    for (const p of participants) clanMetaById.set(p.clanId, { clanTag: p.clanTag, clanName: p.clanName, clanColor: (p as any).clanColor ?? null });
    const teamsMeta = teams.map((t) => ({
      slot: t.slot,
      clanId: t.clanId,
      clanTag: clanMetaById.get(t.clanId)?.clanTag ?? "",
      clanName: clanMetaById.get(t.clanId)?.clanName ?? "Clan",
      clanColor: clanMetaById.get(t.clanId)?.clanColor ?? null,
    }));

    const bracket: any = {
      kind: "nuketown",
      teams: teamsMeta,
      stage: "running",
      currentMatch: null,
      winners: { semi1: null, semi2: null, champion: null },
      /** Each completed Bo3 (3 rounds): scores + per-round winners for website/debug. */
      matchHistory: {} as Record<string, { winnerSlot: number; scoreA: number; scoreB: number; roundWinners: number[] }>,
    };

    await updateNuketownBracketJson(pool, eventId, bracket);

    const slotMap = new Map<number, number>();
    for (const t of teams) slotMap.set(t.clanId, t.slot);

    const slots = teams.map((t) => t.slot).sort((a, b) => a - b);

    const playMatch = async (
      label: "Semi 1" | "Semi 2" | "Final",
      aSlot: number,
      bSlot: number
    ): Promise<{ winnerSlot: number; scoreA: number; scoreB: number; roundWinners: number[] }> => {
      let scoreA = 0;
      let scoreB = 0;
      const roundWinners: number[] = [];

      for (let round = 1; round <= 3; round++) {
        if (abort.signal.aborted) throw new Error("Nuketown aborted");

        bracket.currentMatch = {
          label,
          teamA: { slot: aSlot, clanTag: teamsMeta.find((t: any) => t.slot === aSlot)?.clanTag ?? "" },
          teamB: { slot: bSlot, clanTag: teamsMeta.find((t: any) => t.slot === bSlot)?.clanTag ?? "" },
          round,
          scoreA,
          scoreB,
        };
        await updateNuketownBracketJson(pool, eventId, bracket);

        await postInfo(
          client,
          announcementChannelId,
          `🏙️ Nuketown — ${label} (Round ${round}/3)`,
          `**${serverNickname}** — Team ${aSlot} vs Team ${bSlot}. Get ready (kits + teleport now). Doors open in **${Math.round(ROUND_PREP_MS / 1000)}s**.`
        );

        // Teleport + kit for both teams.
        const gateA = await getNuketownGateCoord(pool, guildRowId, rustServerId, aSlot);
        const gateB = await getNuketownGateCoord(pool, guildRowId, rustServerId, bSlot);
        if (!gateA || !gateB) throw new Error("Missing Nuketown gate coordinates (use /manage-positions).");
        const xyzA = parseCoordTriple(gateA);
        const xyzB = parseCoordTriple(gateB);
        if (!xyzA || !xyzB) throw new Error("Invalid Nuketown gate coordinates.");
        const posA = formatTeleportPosComma(xyzA);
        const posB = formatTeleportPosComma(xyzB);

        const roster = participants
          .map((p) => ({ ...p, slot: slotMap.get(p.clanId) ?? 0 }))
          .filter((p) => p.slot === aSlot || p.slot === bSlot)
          .map((p) => ({ ingameName: p.ingameName, clanId: p.clanId, slot: p.slot }));

        await nuketownKillTracker.setRoundRoster(pool, rustServerId, roster);

        await Promise.all(
          roster.map(async (p) => {
            const pos = p.slot === aSlot ? posA : posB;
            await giveKit(pool, rustServerId, host, port, password, kitName, p.ingameName);
            await teleportPlayer(rustServerId, host, port, password, p.ingameName, pos);
          })
        );

        await sleepAbortable(ROUND_PREP_MS, abort.signal);

        // Open doors (broadcaster uses gate 1 for placement).
        const bcGate1 = await getNuketownGateCoord(pool, guildRowId, rustServerId, 1);
        const bcXyz = bcGate1 ? parseCoordTriple(bcGate1) : null;
        if (!bcXyz) throw new Error("Missing Nuketown Gate 1 (needed to open/close doors).");
        await openThenCloseDoors(rustServerId, host, port, password, gateFrequency, bcXyz, abort.signal);

        let winnerSlot: number;
        try {
          winnerSlot = await Promise.race([
            nuketownKillTracker.waitForTeamWipe(rustServerId),
            new Promise<number>((_, reject) => {
              setTimeout(() => reject(new Error(`Nuketown round timed out after ${ROUND_TIMEOUT_MS}ms`)), ROUND_TIMEOUT_MS);
            }),
          ]);
        } catch (e) {
          console.error("[nuketown] waitForTeamWipe:", e);
          throw e;
        }

        roundWinners.push(winnerSlot);
        if (winnerSlot === aSlot) scoreA++;
        else scoreB++;

        await postInfo(
          client,
          announcementChannelId,
          `🏙️ Nuketown — ${label} Result`,
          `Round ${round}/3 winner: **Team ${winnerSlot}**. Running score: **${scoreA}–${scoreB}** (best-of-3 over three rounds).`
        );

        // Stop tracking before RCON kills so stray console lines cannot affect the next round.
        nuketownKillTracker.clearAfterRound(rustServerId);

        // Kill everyone in this matchup so the next round (or next match) starts clean.
        const toKill = roster.map((p) => p.ingameName);
        await killRosterSequential(rustServerId, host, port, password, toKill);

        await sleepAbortable(2_000, abort.signal);
      }

      const matchWinner = scoreA > scoreB ? aSlot : bSlot;
      bracket.currentMatch = null;
      await updateNuketownBracketJson(pool, eventId, bracket);
      return { winnerSlot: matchWinner, scoreA, scoreB, roundWinners };
    };

    const recordMatchHistory = (
      key: string,
      res: { winnerSlot: number; scoreA: number; scoreB: number; roundWinners: number[] }
    ) => {
      bracket.matchHistory[key] = {
        winnerSlot: res.winnerSlot,
        scoreA: res.scoreA,
        scoreB: res.scoreB,
        roundWinners: res.roundWinners.slice(),
      };
      void updateNuketownBracketJson(pool, eventId, bracket);
    };

    await postInfo(
      client,
      announcementChannelId,
      "🏙️ Nuketown started",
      `**${serverNickname}** — bracket is live with **${teams.length}** clan(s).`
    );

    let finalistA: number;
    let finalistB: number;

    if (slots.length >= 4) {
      const semi1: [number, number] = [slots[0]!, slots[1]!];
      const semi2: [number, number] = [slots[2]!, slots[3]!];

      const r1 = await playMatch("Semi 1", semi1[0], semi1[1]);
      bracket.winners.semi1 = { slot: r1.winnerSlot, clanTag: teamsMeta.find((t: any) => t.slot === r1.winnerSlot)?.clanTag ?? "" };
      recordMatchHistory("semi1", r1);

      const r2 = await playMatch("Semi 2", semi2[0], semi2[1]);
      bracket.winners.semi2 = { slot: r2.winnerSlot, clanTag: teamsMeta.find((t: any) => t.slot === r2.winnerSlot)?.clanTag ?? "" };
      recordMatchHistory("semi2", r2);

      finalistA = r1.winnerSlot;
      finalistB = r2.winnerSlot;
    } else if (slots.length === 3) {
      // Semi between first two, third gets a bye to finals.
      const r1 = await playMatch("Semi 1", slots[0]!, slots[1]!);
      bracket.winners.semi1 = { slot: r1.winnerSlot, clanTag: teamsMeta.find((t: any) => t.slot === r1.winnerSlot)?.clanTag ?? "" };
      recordMatchHistory("semi1", r1);
      finalistA = r1.winnerSlot;
      finalistB = slots[2]!;
    } else {
      // 2 clans: straight to finals.
      finalistA = slots[0]!;
      finalistB = slots[1]!;
    }

    await postInfo(
      client,
      announcementChannelId,
      "🏙️ Nuketown — Finals",
      `Finals start in **${Math.round(FINAL_PREP_MS / 1000)}s**: Team ${finalistA} vs Team ${finalistB}.`
    );
    await sleepAbortable(FINAL_PREP_MS, abort.signal);

    const finalRes = await playMatch("Final", finalistA, finalistB);
    const champ = finalRes.winnerSlot;
    bracket.winners.champion = { slot: champ, clanTag: teamsMeta.find((t: any) => t.slot === champ)?.clanTag ?? "" };
    recordMatchHistory("final", finalRes);

    const isTournament = slots.length >= 3;
    const winnerMeta = teamsMeta.find((t: any) => t.slot === champ) ?? { clanTag: "", clanName: `Team ${champ}` };
    const winnerName = fmtClanLabel(winnerMeta);
    const winnerClanId = Number((winnerMeta as any).clanId ?? 0);

    const loserSlot = champ === finalistA ? finalistB : finalistA;
    const loserMeta = teamsMeta.find((t: any) => t.slot === loserSlot) ?? { clanTag: "", clanName: `Team ${loserSlot}` };
    const loserName = fmtClanLabel(loserMeta);

    const winnerScore = champ === finalistA ? finalRes.scoreA : finalRes.scoreB;
    const loserScore = champ === finalistA ? finalRes.scoreB : finalRes.scoreA;

    const pointsRaw = Number.parseInt(process.env.NUKETOWN_EVENT_POINTS ?? "", 10);
    const pointsText = Number.isFinite(pointsRaw) ? String(pointsRaw) : "(x)";
    const lucidsReward = isTournament ? 25 : 15;
    const eligibleForRewards = slots.length / (isTournament ? 4 : 2) >= 0.6;
    let rewardLine = "";
    try {
      if (eligibleForRewards && winnerClanId > 0) {
        const ids = await listNuketownEventClanDiscordUserIds(pool, eventId, winnerClanId);
        await rewardDiscordUsersLucids(pool, ids, lucidsReward);
        rewardLine = `The clan **${winnerName}** got rewarded with **${lucidsReward} Lucids**.`;
      }
    } catch (e) {
      console.error("[nuketown rewards] failed:", e);
    }

    const title = isTournament
      ? `🏆 Nuketown Team Tournament #${eventId} - Final Complete`
      : `🏆 Nuketown Team vs Team #${eventId} - Match Complete`;

    const winLine = isTournament ? `🏆 **${winnerName}** wins the final match!` : `🏆 **${winnerName}** wins the Bo3 match!`;

    const formatBo3Block = (title: string, entry: { scoreA: number; scoreB: number; roundWinners: number[] } | undefined) => {
      if (!entry) return "";
      const roundLines = entry.roundWinners
        .map((slot, i) => {
          const t = teamsMeta.find((x: any) => x.slot === slot) ?? { clanTag: "", clanName: `Team ${slot}` };
          return `  • Round ${i + 1}: ${fmtClanLabel(t)}`;
        })
        .join("\n");
      return [`**${title}** — score **${entry.scoreA}-${entry.scoreB}** (3 rounds)`, roundLines].filter(Boolean).join("\n");
    };

    const mh = bracket.matchHistory as Record<string, { scoreA: number; scoreB: number; roundWinners: number[] }>;

    const completedTs = Math.floor(Date.now() / 1000);

    const semifinalSummary =
      slots.length >= 4
        ? [
            "",
            "**Semifinals (best-of-3, three rounds each)**",
            formatBo3Block("Semi 1", mh.semi1),
            "",
            formatBo3Block("Semi 2", mh.semi2),
            "",
          ].join("\n")
        : "";

    const finalBo3 = formatBo3Block(
      "Grand final",
      mh.final ?? { scoreA: finalRes.scoreA, scoreB: finalRes.scoreB, roundWinners: finalRes.roundWinners }
    );

    const desc = [
      winLine,
      semifinalSummary,
      "**Final (best-of-3, three rounds)**",
      finalBo3,
      "",
      "**Match Summary**",
      `**Final:** ${winnerName} vs ${loserName} — **${winnerScore}-${loserScore}**`,
      "",
      "**Champion**",
      `🥇 ${winnerName}`,
      "",
      ...(rewardLine ? [rewardLine, ""] : []),
      `**Reward:** Team gets **${pointsText}** Event Points 🤑`,
      `**Event:** #${eventId}`,
      "",
      `Match completed • ${serverNickname} • <t:${completedTs}:t>`,
    ].join("\n");

    await postInfo(client, announcementChannelId, title, desc);

    await finishNuketownEvent(pool, eventId).catch(() => {});
    await deleteNuketownEventAndClearConfig(pool, guildRowId, rustServerId, eventId);
  } catch (err) {
    console.error("[nuketown] runner failed:", err);
    await finishNuketownEvent(pool, eventId).catch(() => {});
    await postInfo(client, announcementChannelId, "🏙️ Nuketown stopped", `**${serverNickname}** — ended due to an error. Check bot logs.`);
  } finally {
    nuketownKillTracker.unregister(rustServerId);
    running.delete(rustServerId);
  }
}

