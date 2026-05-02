import { Client, TextChannel } from "discord.js";
import type { Pool } from "mysql2/promise";
import {
  eventResultEmbed,
  formatClanTotalsLines,
  formatRankedLeaderboardLines,
  poweredByFooterBlock,
  truncateEmbedDescription,
} from "../embeds/eventResults.js";
import {
  countKothKillsForWave,
  countAssignedGatesForEvent,
  finalizeKothAfterSuccessfulRun,
  finishKothEvent,
  getGateCoord,
  getKothConfig,
  getKothDoorDelayMs,
  getKothEventStatus,
  getKothEventTopKillerWithLink,
  type KothKillLogRow,
  listKothKillLogForWave,
  listKothEventClanDiscordUserIds,
  listKothParticipantsWithGatesAndClan,
  listWaveKillsDetailed,
  setKothWave,
  sumKillsByClanForEvent,
  sumKillsByClanForWave,
} from "../db/koth.js";
import { buildKothEndedSay, KOTH_RCON_START, runSayRcon } from "../rcon/eventBroadcasts.js";
import { runWebRconCommand } from "../rcon/webrcon.js";
import { quoteForRconArg } from "../rcon/quote.js";
import { kothKillTracker } from "./killTracker.js";
import { insertEventSnapshot } from "../db/eventSnapshots.js";
import { rewardDiscordUsersLucids } from "../rewards/eventRewards.js";
import { applyEventZoneConfigIfPresent } from "../zones/eventZones.js";

function parseMsEnv(name: string, fallback: number): number {
  const v = process.env[name]?.trim();
  if (v === undefined || v === "") return fallback;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/** Between waves (was 15s; tunable via KOTH_WAVE_GAP_MS). */
const WAVE_GAP_MS = parseMsEnv("KOTH_WAVE_GAP_MS", 10_000);
/** After teleports: wait before/after rf.spawnfakebroadcaster (was 15s each; tunable KOTH_BROADCASTER_PAUSE_MS). */
const BROADCASTER_PAUSE_MS = parseMsEnv("KOTH_BROADCASTER_PAUSE_MS", 5_000);
/** After teleport + kits: wait before doors / broadcaster, then wave duration timer. */
const KOTH_DOOR_DELAY_MS = getKothDoorDelayMs();
/** Retry kit+teleport a few times to reduce missed RCON actions. */
const TELEPORT_KIT_MAX_ATTEMPTS = parseMsEnv("KOTH_TELEPORT_KIT_MAX_ATTEMPTS", 3);
const TELEPORT_KIT_RETRY_MS = parseMsEnv("KOTH_TELEPORT_KIT_RETRY_MS", 250);
/** After fast retries fail, wait then try again (helps when RCON is saturated). */
const KOTH_TP_SLOW_WAIT_MS = parseMsEnv("KOTH_TP_SLOW_WAIT_MS", 5000);
const KOTH_TP_SLOW_EXTRA = parseMsEnv("KOTH_TP_SLOW_EXTRA", 2);
/** Space out players so the server/bot RCON queue does not drop commands. */
const KOTH_INTER_PLAYER_RCON_MS = parseMsEnv("KOTH_INTER_PLAYER_RCON_MS", 180);

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function sleepAbortable(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) throw new Error("KOTH aborted");
  const started = Date.now();
  while (Date.now() - started < ms) {
    if (signal.aborted) throw new Error("KOTH aborted");
    await sleep(500);
  }
}

/** Full wave duration, unless ≥2 clans and one clan is eliminated (same idea as Nuketown team wipe). */
async function sleepWaveDurationOrEarlyEnd(
  rustServerId: number,
  waveMs: number,
  signal: AbortSignal,
  wave: number,
  waves: number
): Promise<"timer" | "early"> {
  const early = kothKillTracker.waitForLastClanStanding(rustServerId);
  if (!early) {
    await sleepAbortable(waveMs, signal);
    return "timer";
  }
  return await new Promise<"timer" | "early">((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error("KOTH aborted"));
      return;
    }
    const onAbort = () => {
      cleanup();
      reject(new Error("KOTH aborted"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    const timer = setTimeout(() => {
      cleanup();
      resolve("timer");
    }, waveMs);
    early.then(() => {
      cleanup();
      console.log(`[koth] wave ${wave}/${waves} ended early — one clan left (or all eliminated)`);
      resolve("early");
    });
    function cleanup() {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
    }
  });
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

/** Parse stored gate coords (spaces or commas) into x,y,z. */
export function parseGateCoordTriple(raw: string): [number, number, number] | null {
  return parseCoordTriple(raw);
}

/** `792.00,0.00,-368.00` for `global.teleportpos` (no spaces inside the triple). */
function formatTeleportPosComma(xyz: [number, number, number]): string {
  return `${xyz[0].toFixed(2)},${xyz[1].toFixed(2)},${xyz[2].toFixed(2)}`;
}

/**
 * Exact plugin spellings: rf.spawnfakebroadcaster freq range x y z — then rf.removefakeboardcaster
 * Example: rf.spawnfakebroadcaster 1111 1000 792 0 -368
 */
async function runFakeBroadcasterSequence(
  rustServerId: number,
  host: string,
  port: number,
  password: string,
  gateFrequency: number,
  gate1Xyz: [number, number, number],
  signal: AbortSignal
): Promise<void> {
  // Back-compat wrapper kept for callers, but behavior is now "open and keep open".
  await sleepAbortable(BROADCASTER_PAUSE_MS, signal);
  const [gx, gy, gz] = gate1Xyz;
  const spawnCmd = `rf.spawnfakebroadcaster ${gateFrequency} 1000 ${gx} ${gy} ${gz}`;
  const spawnRes = await runWebRconCommand(rustServerId, host, port, password, spawnCmd);
  if (!spawnRes.ok) console.error(`[koth] ${spawnCmd}: ${spawnRes.error}`);
  await sleepAbortable(BROADCASTER_PAUSE_MS, signal);
}

async function closeDoorsAfterMatch(rustServerId: number, host: string, port: number, password: string): Promise<void> {
  const removeCmd = `rf.removefakeboardcaster`;
  const removeRes = await runWebRconCommand(rustServerId, host, port, password, removeCmd);
  if (!removeRes.ok) console.error(`[koth] ${removeCmd}: ${removeRes.error}`);
}

async function killPlayerWithFallbacks(
  rustServerId: number,
  host: string,
  port: number,
  password: string,
  ingameName: string
): Promise<boolean> {
  const q = quoteForRconArg(ingameName);
  const attempts: string[] = [];
  const custom = process.env.KOTH_KILL_CMD?.trim();
  if (custom) attempts.push(custom.replace(/\{name\}/g, q));
  attempts.push(`global.killplayer "${q}"`);
  attempts.push(`kill "${q}"`);
  attempts.push(`global.kill "${q}"`);

  let lastErr = "";
  for (const cmd of attempts) {
    const res = await runWebRconCommand(rustServerId, host, port, password, cmd);
    if (res.ok) return true;
    lastErr = res.error ?? "unknown";
  }
  console.error(`[koth] all kill attempts failed for ${ingameName}: ${lastErr}`);
  return false;
}

async function killRosterSequential(rustServerId: number, host: string, port: number, password: string, ingameNames: string[]): Promise<void> {
  for (const name of ingameNames) {
    await killPlayerWithFallbacks(rustServerId, host, port, password, name);
  }
}

async function giveKitsAndTeleports(opts: {
  pool: Pool;
  guildRowId: number;
  rustServerId: number;
  eventId: number;
  kitName: string;
  host: string;
  port: number;
  password: string;
  signal: AbortSignal;
}): Promise<void> {
  const { pool, guildRowId, rustServerId, eventId, kitName, host, port, password, signal } = opts;
  const status = await getKothEventStatus(pool, eventId);
  if (status !== "running") {
    console.warn(`[koth] kit/teleport skipped — event ${eventId} is not running (status=${status ?? "?"})`);
    return;
  }

  const participants = await listKothParticipantsWithGatesAndClan(pool, guildRowId, eventId);
  const kit = kitName.trim();

  /** Serial RCON with pacing — parallel spikes saturate WebRCON and drops kit/teleport during lobby overlap or busy servers. */
  for (let pi = 0; pi < participants.length; pi++) {
    const p = participants[pi]!;
    if (signal.aborted) throw new Error("KOTH aborted");
    if (pi > 0 && KOTH_INTER_PLAYER_RCON_MS > 0) {
      await sleepAbortable(KOTH_INTER_PLAYER_RCON_MS, signal);
    }

    const coordStr = await getGateCoord(pool, guildRowId, rustServerId, p.gateNumber);
    if (!coordStr) {
      console.warn(
        `[koth] teleport skipped — no /manage-positions coordinates for **KOTH Gate ${p.gateNumber}** (player ${p.ingameName})`
      );
      continue;
    }
    const xyz = parseCoordTriple(coordStr);
    if (!xyz) {
      console.warn(`[koth] bad gate coord for gate ${p.gateNumber}: ${coordStr}`);
      continue;
    }
    const posArg = formatTeleportPosComma(xyz);

    const name = quoteForRconArg(p.ingameName);
    const kitCmd = `kit givetoplayer "${quoteForRconArg(kit)}" "${name}"`;
    const tpCmd = `global.teleportpos ${posArg} "${name}"`;

    let okPair = false;
    for (let attempt = 1; attempt <= TELEPORT_KIT_MAX_ATTEMPTS; attempt++) {
      if (signal.aborted) throw new Error("KOTH aborted");
      const kitRes = await runWebRconCommand(rustServerId, host, port, password, kitCmd);
      const tpRes = await runWebRconCommand(rustServerId, host, port, password, tpCmd);
      if (kitRes.ok && tpRes.ok) {
        console.log(`[koth] teleport ok: ${p.ingameName} → gate ${p.gateNumber} (${p.clanName}) → ${posArg}`);
        okPair = true;
        break;
      }
      if (!kitRes.ok) console.error(`[koth] kit failed for ${p.ingameName}: ${kitRes.error}`);
      if (!tpRes.ok) console.error(`[koth] teleport failed for ${p.ingameName}: ${tpRes.error} (cmd: ${tpCmd})`);
      if (attempt < TELEPORT_KIT_MAX_ATTEMPTS) await sleepAbortable(TELEPORT_KIT_RETRY_MS, signal);
    }

    if (!okPair && KOTH_TP_SLOW_EXTRA > 0) {
      console.warn(`[koth] entering slow RCON retry (${KOTH_TP_SLOW_WAIT_MS}ms) for ${p.ingameName}`);
      await sleepAbortable(KOTH_TP_SLOW_WAIT_MS, signal);
      for (let slow = 1; slow <= KOTH_TP_SLOW_EXTRA; slow++) {
        if (signal.aborted) throw new Error("KOTH aborted");
        const kitRes = await runWebRconCommand(rustServerId, host, port, password, kitCmd);
        const tpRes = await runWebRconCommand(rustServerId, host, port, password, tpCmd);
        if (kitRes.ok && tpRes.ok) {
          console.log(`[koth] teleport ok (slow retry): ${p.ingameName} → gate ${p.gateNumber}`);
          okPair = true;
          break;
        }
        if (slow < KOTH_TP_SLOW_EXTRA) await sleepAbortable(KOTH_TP_SLOW_WAIT_MS, signal);
      }
    }
  }
}

function formatKothKillLogLine(row: KothKillLogRow): string {
  const killer = `<@${row.killerDiscordUserId}>`;
  if (row.victimDiscordUserId) {
    return `• ${killer} killed <@${row.victimDiscordUserId}>`;
  }
  return `• ${killer} killed ${row.victimLabel}`;
}

async function postWaveEmbed(
  client: Client,
  pool: Pool,
  guildRowId: number,
  channelId: string,
  eventId: number,
  wave: number,
  waves: number
): Promise<void> {
  const ch = await client.channels.fetch(channelId);
  if (!ch || !(ch instanceof TextChannel)) return;

  const clanTotals = await sumKillsByClanForWave(pool, eventId, wave);
  const players = await listWaveKillsDetailed(pool, eventId, wave);
  const killLog = await listKothKillLogForWave(pool, guildRowId, eventId, wave);

  const clanBlock = formatClanTotalsLines(clanTotals, "_No kills recorded this wave._");

  const leaderboardBlock = formatRankedLeaderboardLines(players);

  const logSlice = killLog.slice(0, 25);
  let killLogLines =
    logSlice.length === 0
      ? "_No scored kills were logged to this event this wave._"
      : logSlice.map(formatKothKillLogLine).join("\n") +
        (killLog.length > 25 ? `\n_${killLog.length - 25} more not shown._` : "");

  const description = truncateEmbedDescription(
    [
      `📊 **Wave Kills (Total):** ${players.reduce((s, p) => s + p.kills, 0)}`,
      "",
      "📛 **Clan Totals**",
      clanBlock,
      "",
      "🏆 **Leaderboard**",
      leaderboardBlock,
      "",
      "📜 **Kill Log**",
      killLogLines,
      "",
      poweredByFooterBlock(),
    ].join("\n")
  );

  const embed = eventResultEmbed()
    .setTitle(`⚔️ **KOTH — Wave ${wave}/${waves} Complete**`)
    .setDescription(description);

  await ch.send({ embeds: [embed] });
}

export type KothRunnerArgs = {
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
  waves: number;
  durationPerWaveMin: number;
  kitName: string;
  /** From /koth-setup `gate_frequency`. */
  gateFrequency: number;
  /** Gate 1 position for rf.spawnfakebroadcaster (space-separated in RCON). */
  gate1Xyz: [number, number, number];
};

type Running = {
  rustServerId: number;
  eventId: number;
  abort: AbortController;
};

const running = new Map<number, Running>();

export function requestStopKoth(rustServerId: number): boolean {
  const r = running.get(rustServerId);
  if (!r) return false;
  r.abort.abort();
  return true;
}

export async function runKothWaves(args: KothRunnerArgs): Promise<void> {
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
    waves,
    durationPerWaveMin,
    kitName,
    gateFrequency,
    gate1Xyz,
  } = args;

  // Event zones: ensure ACTIVE zone (and remove INACTIVE) while the event is running.
  await applyEventZoneConfigIfPresent({
    pool,
    guildRowId,
    rustServerId,
    eventType: "koth",
    desired: "active",
    rcon: { host, port, password },
  }).catch(() => {});

  const abort = new AbortController();
  running.set(rustServerId, { rustServerId, eventId, abort });
  kothKillTracker.register(rustServerId, { guildRowId, eventId, wave: 1 });
  await kothKillTracker.refreshRoster(pool, rustServerId, guildRowId, eventId);

  try {
    // Doors should stay open for the entire match (all waves).
    let doorsOpened = false;
    for (let wave = 1; wave <= waves; wave++) {
      if (abort.signal.aborted) throw new Error("KOTH aborted");
      if (wave > 1) {
        await sleepAbortable(WAVE_GAP_MS, abort.signal);
        kothKillTracker.setWave(rustServerId, wave);
        await kothKillTracker.refreshRoster(pool, rustServerId, guildRowId, eventId);
      }

      // Stamp wave start in DB so the website phase timers (door delay → wave) match the runner.
      await setKothWave(pool, eventId, wave);

      // 1) Kits + teleports
      await giveKitsAndTeleports({
        pool,
        guildRowId,
        rustServerId,
        eventId,
        kitName,
        host,
        port,
        password,
        signal: abort.signal,
      });

      /** In-game “STARTED” say runs on wave 1 only (after kits). */
      if (wave === 1) {
        void runSayRcon(rustServerId, host, port, password, KOTH_RCON_START, "koth-start");
      }

      // 2) Configurable wait (e.g. 1 min) with doors still closed, then open doors + start wave duration timer.
      if (KOTH_DOOR_DELAY_MS > 0) {
        await sleepAbortable(KOTH_DOOR_DELAY_MS, abort.signal);
      }

      // Doors: open once on wave 1 and keep open until the match is finished.
      if (!doorsOpened) {
        await runFakeBroadcasterSequence(rustServerId, host, port, password, gateFrequency, gate1Xyz, abort.signal);
        doorsOpened = true;
      }

      await sleepWaveDurationOrEarlyEnd(rustServerId, durationPerWaveMin * 60_000, abort.signal, wave, waves);

      await kothKillTracker.drain(rustServerId);
      const rawKillRows = await countKothKillsForWave(pool, eventId, wave);
      console.log(`[koth] wave ${wave}/${waves} summary: ${rawKillRows} row(s) in koth_kills for event ${eventId}`);
      await postWaveEmbed(client, pool, guildRowId, announcementChannelId, eventId, wave, waves);
    }
    // Match finished: close doors, then respawn players out of the arena.
    if (doorsOpened) {
      await closeDoorsAfterMatch(rustServerId, host, port, password);
      try {
        const participants = await listKothParticipantsWithGatesAndClan(pool, guildRowId, eventId);
        const names = [...new Set(participants.map((p) => p.ingameName).filter(Boolean))];
        await killRosterSequential(rustServerId, host, port, password, names);
      } catch (e) {
        console.error("[koth] failed to respawn roster after close:", e);
      }
    }

    const doneCh = await client.channels.fetch(announcementChannelId);
    if (doneCh && doneCh instanceof TextChannel) {
      let rewardLine = "";
      try {
        const cfg = await getKothConfig(pool, guildRowId, rustServerId);
        const gatesTotal = cfg?.gates ?? null;
        const assigned = gatesTotal != null ? await countAssignedGatesForEvent(pool, eventId) : 0;
        const eligible =
          gatesTotal != null && gatesTotal > 0 ? assigned / Math.max(1, gatesTotal) >= 0.6 : false;
        if (eligible) {
          const totals = await sumKillsByClanForEvent(pool, eventId);
          const winner = totals[0];
          if (winner && winner.total > 0) {
            const ids = await listKothEventClanDiscordUserIds(pool, eventId, winner.clanId);
            await rewardDiscordUsersLucids(pool, ids, 50);
            rewardLine = `The clan **${winner.clanName}** got rewarded with **50 Lucids**.`;
          }
        }
      } catch (e) {
        console.error("[koth rewards] failed:", e);
      }
      const kothDoneDesc = truncateEmbedDescription(
        [
          `**${serverNickname}** — all **${waves}** wave(s) complete.`,
          "",
          ...(rewardLine ? [rewardLine, ""] : []),
          "Run **/koth-setup** again before the next event (configuration was cleared; **KOTH Gate** positions from **/manage-positions** are kept).",
          "",
          poweredByFooterBlock(),
        ].join("\n")
      );
      await doneCh.send({
        embeds: [eventResultEmbed().setTitle("⚔️ **KOTH — Finished**").setDescription(kothDoneDesc)],
      });
    }

    try {
      const top = await getKothEventTopKillerWithLink(pool, guildRowId, eventId);
      const endedCmd = buildKothEndedSay(top?.clanName ?? "N/A", top?.ingameName ?? "N/A");
      void runSayRcon(rustServerId, host, port, password, endedCmd, "koth-finish");
    } catch (err) {
      console.error("[koth] ended in-game say failed:", err);
    }

    // Safe website support: snapshot results for 10 minutes, then keep existing delete behavior unchanged.
    try {
      const top = await getKothEventTopKillerWithLink(pool, guildRowId, eventId);
      // Use the last wave number we completed (current `wave` in loop scope is available below; if not, just snapshot top + totals)
      const perWave = [];
      for (let w = 1; w <= waves; w++) {
        const players = await listWaveKillsDetailed(pool, eventId, w);
        const clans = await sumKillsByClanForWave(pool, eventId, w);
        perWave.push({ wave: w, players, clans });
      }
      const participants = await listKothParticipantsWithGatesAndClan(pool, guildRowId, eventId);
      await insertEventSnapshot({
        pool,
        guildRowId,
        rustServerId,
        type: "koth",
        payload: {
          kind: "koth",
          endedAtMs: Date.now(),
          waves,
          durationPerWaveMin,
          kitName,
          topKiller: top,
          participants,
          perWave,
        },
      });
    } catch (err) {
      console.error("[koth] failed to snapshot ended event:", err);
    }

    await finalizeKothAfterSuccessfulRun(pool, guildRowId, rustServerId, eventId);
  } catch (err) {
    console.error("[koth] runner failed:", err);
    await finishKothEvent(pool, eventId).catch(() => {});
    const errCh = await client.channels.fetch(announcementChannelId);
    if (errCh && errCh instanceof TextChannel) {
      const errDesc = truncateEmbedDescription(
        [`**${serverNickname}** — the event ended due to an error. Check bot logs.`, "", poweredByFooterBlock()].join("\n")
      );
      await errCh.send({
        embeds: [eventResultEmbed().setTitle("⚔️ **KOTH — Stopped**").setDescription(errDesc)],
      });
    }
  } finally {
    // If aborted/error path, best-effort close doors so we don't leave them open.
    try {
      await closeDoorsAfterMatch(rustServerId, host, port, password);
    } catch {
      /* ignore */
    }
    // Event zones: after event finishes or errors, ensure INACTIVE zone (and remove ACTIVE).
    await applyEventZoneConfigIfPresent({
      pool,
      guildRowId,
      rustServerId,
      eventType: "koth",
      desired: "inactive",
      rcon: { host, port, password },
    }).catch(() => {});
    kothKillTracker.unregister(rustServerId);
    running.delete(rustServerId);
  }
}
