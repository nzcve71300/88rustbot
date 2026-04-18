import { Client, TextChannel, EmbedBuilder } from "discord.js";
import type { Pool } from "mysql2/promise";
import { runWebRconCommand } from "../rcon/webrcon.js";
import { quoteForRconArg } from "../rcon/quote.js";
import { config } from "../config.js";
import { decryptSecret } from "../crypto/passwordVault.js";
import { getRustServerByIdForGuild } from "../db/rustServers.js";
import { getOneV1GateCoord, deleteMatch, updateMatchStateJson } from "../db/onev1.js";
import { insertEventSnapshot } from "../db/eventSnapshots.js";
import { onev1KillTracker } from "./killTracker.js";
import { onev1RespawnWait } from "./respawnWait.js";

const DOOR_OPEN_THEN_CLOSE_MS = 10_000;

/** Quiet period at gates before door RF (lower = faster rounds). */
function parsePrepBeforeDoorsMs(): number {
  const v = process.env.ONEV1_PREP_BEFORE_DOORS_MS?.trim();
  if (v === undefined || v === "") return 30_000;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) && n >= 0 ? n : 30_000;
}

/** Wait for `has entered the game` after admin kills (both players must respawn). */
function parseRespawnWaitMs(): number {
  const v = process.env.ONEV1_RESPAWN_WAIT_MS?.trim();
  if (v === undefined || v === "") return 60_000;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) && n >= 15_000 && n <= 300_000 ? n : 60_000;
}

/** After "entered the game" wait (or between-round loser respawn), delay before kit + teleport so clients can load. */
function parsePostRespawnSettleMs(): number {
  const v = process.env.ONEV1_POST_RESPAWN_SETTLE_MS?.trim();
  if (v === undefined || v === "") return 1200;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) && n >= 0 ? n : 1200;
}

/** Max `global.teleportpos` attempts when RCON reports failure (default 3). */
function parseTeleportMaxAttempts(): number {
  const v = process.env.ONEV1_TELEPORT_MAX_ATTEMPTS?.trim();
  if (v === undefined || v === "") return 3;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) && n >= 1 && n <= 10 ? n : 3;
}

/** Delay between failed teleport retries (default 1500 ms). */
function parseTeleportRetryDelayMs(): number {
  const v = process.env.ONEV1_TELEPORT_RETRY_DELAY_MS?.trim();
  if (v === undefined || v === "") return 1500;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) && n >= 0 ? n : 1500;
}

/**
 * After a *successful* RCON teleport, wait this long and send the same teleport again (backup).
 * Default off — adds a long pause per player when enabled.
 */
function parseTeleportBackupAfterOkMs(): number {
  const v = process.env.ONEV1_TELEPORT_BACKUP_AFTER_OK_MS?.trim();
  if (v === undefined || v === "") return 0;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/** Kit `givetoplayer` retries on failure (default 2 attempts). */
function parseKitMaxAttempts(): number {
  const v = process.env.ONEV1_KIT_MAX_ATTEMPTS?.trim();
  if (v === undefined || v === "") return 2;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) && n >= 1 && n <= 5 ? n : 2;
}

function parseKitRetryDelayMs(): number {
  const v = process.env.ONEV1_KIT_RETRY_DELAY_MS?.trim();
  if (v === undefined || v === "") return 400;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) && n >= 0 ? n : 400;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

const runningOneV1 = new Map<number, AbortController>();

export function requestStopOneV1(rustServerId: number): boolean {
  const a = runningOneV1.get(rustServerId);
  if (!a) return false;
  a.abort();
  return true;
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new Error("1v1 aborted");
}

async function sleepAbortable(ms: number, signal: AbortSignal): Promise<void> {
  throwIfAborted(signal);
  const end = Date.now() + ms;
  while (Date.now() < end) {
    throwIfAborted(signal);
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

/** Same as maze `formatParenXyz` — some Zentro stacks only apply `global.teleportposrot` reliably. */
function formatTeleportPosParen(xyz: [number, number, number]): string {
  return `(${xyz[0].toFixed(2)},${xyz[1].toFixed(2)},${xyz[2].toFixed(2)})`;
}

/**
 * `posrot` — `global.teleportposrot … "0"` (placement mode for this host). Default.
 * `pos` — `global.teleportpos` only (KOTH-style).
 * `both` — try posrot then pos if RCON fails (opt-in).
 */
function parseTeleportMode(): "posrot" | "pos" | "both" {
  const v = process.env.ONEV1_TELEPORT_MODE?.trim().toLowerCase();
  if (v === "pos" || v === "posrot" || v === "both") return v;
  return "posrot";
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
  const custom = process.env.NUKETOWN_KILL_CMD?.trim();
  if (custom) attempts.push(custom.replace(/\{name\}/g, q));
  attempts.push(`global.killplayer "${q}"`);
  attempts.push(`kill "${q}"`);
  attempts.push(`global.kill "${q}"`);
  for (const cmd of attempts) {
    const res = await runWebRconCommand(rustServerId, host, port, password, cmd);
    if (res.ok) return true;
  }
  console.error(`[1v1] all kill attempts failed for ${ingameName}`);
  return false;
}

async function openThenCloseDoors(
  rustServerId: number,
  host: string,
  port: number,
  password: string,
  gateFrequency: number,
  broadcasterXyz: [number, number, number]
): Promise<void> {
  const [x, y, z] = broadcasterXyz;
  const spawnCmd = `rf.spawnfakebroadcaster ${gateFrequency} 1000 ${x} ${y} ${z}`;
  const spawnRes = await runWebRconCommand(rustServerId, host, port, password, spawnCmd);
  if (!spawnRes.ok) console.error(`[1v1] ${spawnCmd}: ${spawnRes.error}`);
  await sleep(DOOR_OPEN_THEN_CLOSE_MS);
  const removeCmd = `rf.removefakeboardcaster`;
  const removeRes = await runWebRconCommand(rustServerId, host, port, password, removeCmd);
  if (!removeRes.ok) console.error(`[1v1] ${removeCmd}: ${removeRes.error}`);
}

async function runTeleportWithRetriesAndBackup(
  rustServerId: number,
  host: string,
  port: number,
  password: string,
  commands: string[],
  ingameName: string
): Promise<boolean> {
  const maxAttempts = parseTeleportMaxAttempts();
  const retryDelayMs = parseTeleportRetryDelayMs();
  const backupAfterOkMs = parseTeleportBackupAfterOkMs();

  if (commands.length === 0) return false;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let lastErr = "unknown";
    for (const tpCmd of commands) {
      const tpRes = await runWebRconCommand(rustServerId, host, port, password, tpCmd);
      if (tpRes.ok) {
        if (attempt > 1) {
          console.log(`[1v1] teleport succeeded for ${ingameName} on attempt ${attempt}/${maxAttempts}`);
        }
        const msg = tpRes.message.replace(/\s+/g, " ").trim();
        if (msg) {
          const preview = msg.length > 220 ? `${msg.slice(0, 220)}…` : msg;
          console.log(`[1v1] teleport rcon reply for ${ingameName}: ${preview}`);
        }
        if (backupAfterOkMs > 0) {
          await sleep(backupAfterOkMs);
          const backupRes = await runWebRconCommand(rustServerId, host, port, password, tpCmd);
          if (!backupRes.ok) {
            console.error(`[1v1] backup teleport failed for ${ingameName}: ${backupRes.error}`);
          }
        }
        return true;
      }
      lastErr = tpRes.error ?? "unknown";
    }
    console.error(
      `[1v1] teleport attempt ${attempt}/${maxAttempts} failed for ${ingameName} (tried ${commands.length} cmd variant(s)): ${lastErr}`
    );
    if (attempt < maxAttempts) await sleep(retryDelayMs);
  }
  console.error(`[1v1] teleport exhausted all ${maxAttempts} attempts for ${ingameName}`);
  return false;
}

async function giveKitAndTeleport(
  pool: Pool,
  guildRowId: number,
  rustServerId: number,
  host: string,
  port: number,
  password: string,
  kitName: string,
  ingameName: string,
  gateCoord: string
): Promise<void> {
  const nameQ = quoteForRconArg(ingameName);
  const kitCmd = `kit givetoplayer "${quoteForRconArg(kitName.trim())}" "${nameQ}"`;
  const kitAttempts = parseKitMaxAttempts();
  const kitDelayMs = parseKitRetryDelayMs();
  let kitOk = false;
  for (let k = 1; k <= kitAttempts; k++) {
    const kitRes = await runWebRconCommand(rustServerId, host, port, password, kitCmd);
    if (kitRes.ok) {
      kitOk = true;
      break;
    }
    console.error(`[1v1] kit attempt ${k}/${kitAttempts} failed for ${ingameName}: ${kitRes.error ?? "unknown"}`);
    if (k < kitAttempts) await sleep(kitDelayMs);
  }
  if (!kitOk) console.error(`[1v1] kit failed for ${ingameName} after ${kitAttempts} attempt(s); still attempting teleport.`);

  const xyz = parseCoordTriple(gateCoord);
  if (!xyz) return;
  const mode = parseTeleportMode();
  const posComma = formatTeleportPosComma(xyz);
  const posParen = formatTeleportPosParen(xyz);
  const tpPos = `global.teleportpos ${posComma} "${nameQ}"`;
  /** Third arg `"0"` — required for correct ground placement on this Zentro stack (not `"1"`). */
  const tpPosRot = `global.teleportposrot ${posParen} "${nameQ}" "0"`;

  const commands: string[] = [];
  if (mode === "posrot" || mode === "both") commands.push(tpPosRot);
  if (mode === "pos" || mode === "both") commands.push(tpPos);

  console.log(
    `[1v1] teleport ${mode} for ${ingameName} → ${posComma} (commands: ${commands.length})`
  );
  await runTeleportWithRetriesAndBackup(rustServerId, host, port, password, commands, ingameName);
}

export type OneV1RunnerArgs = {
  client: Client;
  pool: Pool;
  guildRowId: number;
  rustServerId: number;
  matchId: number;
  announcementChannelId: string;
  challengerDiscordId: string;
  opponentDiscordId: string;
  challengerIngame: string;
  opponentIngame: string;
  kitName: string;
  gateFrequency: number;
};

export async function runOneV1Match(args: OneV1RunnerArgs): Promise<void> {
  const {
    client,
    pool,
    guildRowId,
    rustServerId,
    matchId,
    announcementChannelId,
    challengerDiscordId,
    opponentDiscordId,
    challengerIngame,
    opponentIngame,
    kitName,
    gateFrequency,
  } = args;

  const rustRow = await getRustServerByIdForGuild(pool, guildRowId, rustServerId);
  if (!rustRow) {
    console.error("[1v1] missing rust server row");
    await deleteMatch(pool, matchId);
    return;
  }
  let password: string;
  try {
    password = decryptSecret(rustRow.rcon_password_encrypted, config.encryptionKeyHex);
  } catch (e) {
    console.error("[1v1] decrypt password failed", e);
    await deleteMatch(pool, matchId);
    return;
  }
  const host = rustRow.server_ip;
  const port = rustRow.rcon_port;

  const gate1 = await getOneV1GateCoord(pool, guildRowId, rustServerId, 1);
  const gate2 = await getOneV1GateCoord(pool, guildRowId, rustServerId, 2);
  if (!gate1 || !gate2) {
    const ch = await client.channels.fetch(announcementChannelId).catch(() => null);
    if (ch?.isTextBased() && "send" in ch) {
      await ch.send({
        embeds: [
          new EmbedBuilder()
            .setTitle("1v1 — setup incomplete")
            .setDescription("Admin must set **1v1 Gate 1** and **1v1 Gate 2** in `/manage-positions`.")
            .setColor(0xed4245),
        ],
      });
    }
    await deleteMatch(pool, matchId);
    return;
  }

  const bcXyz = parseCoordTriple(gate1);
  if (!bcXyz) {
    await deleteMatch(pool, matchId);
    return;
  }

  onev1KillTracker.register(rustServerId);

  const abortCtl = new AbortController();
  runningOneV1.set(rustServerId, abortCtl);
  const signal = abortCtl.signal;

  const names: [string, string] = [challengerIngame, opponentIngame];
  const postRespawnSettleMs = parsePostRespawnSettleMs();
  const respawnWaitMs = parseRespawnWaitMs();

  try {
    /** Clear any stuck wait from a prior crash before registering a fresh listener. */
    onev1RespawnWait.cancel(rustServerId);
    throwIfAborted(signal);

    /** Register respawn listener *before* kills — otherwise the first player's `has entered the game` can arrive before we subscribe and is lost (common between rounds). */
    const preRoundRespawnDone = onev1RespawnWait.waitForBothRespawns(rustServerId, names, respawnWaitMs);
    const killChallengerOk = await killPlayerWithFallbacks(rustServerId, host, port, password, challengerIngame);
    await sleepAbortable(250, signal);
    const killOpponentOk = await killPlayerWithFallbacks(rustServerId, host, port, password, opponentIngame);

    if (!killChallengerOk || !killOpponentOk) {
      onev1RespawnWait.cancel(rustServerId);
      void preRoundRespawnDone.catch(() => {});
      console.error(
        `[1v1] pre-round kill failed (challengerOk=${killChallengerOk}, opponentOk=${killOpponentOk}) — cannot wait for respawn lines.`
      );
      const ch = await client.channels.fetch(announcementChannelId).catch(() => null);
      if (ch?.isTextBased() && "send" in ch) {
        await ch.send({
          embeds: [
            new EmbedBuilder()
              .setTitle("1v1 — cancelled")
              .setDescription(
                "RCON could not kill one or both players (check in-game names vs `/link`). Without a kill + respawn, the match cannot start."
              )
              .setColor(0xed4245),
          ],
        });
      }
      return;
    }

    console.log(
      `[1v1] waiting up to ${respawnWaitMs}ms for "has entered the game" for ${JSON.stringify(names)} (rustServerId=${rustServerId})`
    );

    try {
      await preRoundRespawnDone;
    } catch (e) {
      if (signal.aborted) throw new Error("1v1 aborted");
      console.error("[1v1] respawn wait:", e);
      const ch = await client.channels.fetch(announcementChannelId).catch(() => null);
      if (ch?.isTextBased() && "send" in ch) {
        await ch.send({
          embeds: [
            new EmbedBuilder()
              .setTitle("1v1 — cancelled")
              .setDescription(
                [
                  "Could not detect **both** `has entered the game` lines in time after the pre-match kills.",
                  "",
                  `• Check **/link** names match the server console (including tags).`,
                  `• Slow loads: increase wait with \`ONEV1_RESPAWN_WAIT_MS\` on the bot (default 60000).`,
                  `• Debug name matching: set \`DEBUG_1V1=1\` and watch logs when someone respawns.`,
                ].join("\n")
              )
              .setColor(0xed4245),
          ],
        });
      }
      return;
    }

    await sleepAbortable(postRespawnSettleMs, signal);

    let scoreA = 0;
    let scoreB = 0;
    const roundWinners: ("challenger" | "opponent")[] = [];

    for (let round = 1; round <= 3; round++) {
      throwIfAborted(signal);
      await updateMatchStateJson(pool, matchId, {
        phase: "running",
        round,
        scoreChallenger: scoreA,
        scoreOpponent: scoreB,
        challengerIngame,
        opponentIngame,
        roundWinners: [...roundWinners],
        betweenRounds: false,
      });

      await Promise.all([
        giveKitAndTeleport(pool, guildRowId, rustServerId, host, port, password, kitName, challengerIngame, gate1),
        giveKitAndTeleport(pool, guildRowId, rustServerId, host, port, password, kitName, opponentIngame, gate2),
      ]);

      /** Arm kill tracking only after teleports so stale RCON lines from between-round `killplayer` cannot end the round early or strand the tracker. */
      onev1KillTracker.setRoundRoster(rustServerId, challengerIngame, opponentIngame);

      await sleepAbortable(parsePrepBeforeDoorsMs(), signal);
      await openThenCloseDoors(rustServerId, host, port, password, gateFrequency, bcXyz);

      const winnerSide = await onev1KillTracker.waitForRoundWinner(rustServerId);
      throwIfAborted(signal);
      await onev1KillTracker.drain(rustServerId);
      onev1KillTracker.clearAfterRound(rustServerId);

      if (winnerSide === "a") {
        scoreA++;
        roundWinners.push("challenger");
      } else {
        scoreB++;
        roundWinners.push("opponent");
      }

      await updateMatchStateJson(pool, matchId, {
        phase: "running",
        round,
        scoreChallenger: scoreA,
        scoreOpponent: scoreB,
        challengerIngame,
        opponentIngame,
        roundWinners: [...roundWinners],
        /** True while waiting for loser respawn before the next round (website can hide “live” ring). */
        betweenRounds: round < 3,
      });

      /** Always play 3 rounds; match winner is best score after round 3. */
      if (round === 3) break;

      const roundLoserIngame = winnerSide === "a" ? opponentIngame : challengerIngame;
      /** Subscribe immediately — loser is already dead from the round; no admin kill. Wait for their natural respawn, then kit + TP both. */
      const loserRespawnDone = onev1RespawnWait.waitForOneRespawn(rustServerId, roundLoserIngame, respawnWaitMs);
      try {
        await loserRespawnDone;
      } catch (e) {
        if (signal.aborted) throw new Error("1v1 aborted");
        console.error("[1v1] between-round respawn (loser):", e);
        break;
      }

      await sleepAbortable(postRespawnSettleMs, signal);
    }

    const challengerWon = scoreA > scoreB;
    const winnerId = challengerWon ? challengerDiscordId : opponentDiscordId;
    const loserId = challengerWon ? opponentDiscordId : challengerDiscordId;
    const matchWinnerIngame = challengerWon ? challengerIngame : opponentIngame;

    /** Run before Discord/DB so a failed embed or snapshot cannot skip the end-of-match kill. */
    const endKillOk = await killPlayerWithFallbacks(rustServerId, host, port, password, matchWinnerIngame);
    if (!endKillOk) {
      console.error(`[1v1] end-match kill failed for winner ${matchWinnerIngame} (check RCON / in-game name)`);
    }

    try {
      const ch = await client.channels.fetch(announcementChannelId);
      if (ch && ch instanceof TextChannel) {
        const roundLines = [1, 2, 3]
          .map((r) => {
            const w = roundWinners[r - 1];
            if (!w) return `**Round ${r}:** _(not played)_`;
            const who = w === "challenger" ? `<@${challengerDiscordId}>` : `<@${opponentDiscordId}>`;
            return `**Round ${r}:** ${who} won`;
          })
          .join("\n");

        const embed = new EmbedBuilder()
          .setTitle("⚔️ 1v1 — Match complete")
          .setDescription(
            [
              `<@${winnerId}> is **ultimately** better than <@${loserId}>.`,
              "",
              "**Match stats**",
              roundLines,
              "",
              `**Final score:** ${scoreA}–${scoreB}`,
            ].join("\n")
          )
          .setColor(0x57f287);

        await ch.send({ embeds: [embed] });
      }
    } catch (e) {
      console.error("[1v1] match-complete announcement failed:", e);
    }

    try {
      await insertEventSnapshot({
        pool,
        guildRowId,
        rustServerId,
        type: "onev1",
        payload: {
          kind: "onev1",
          matchId,
          winnerDiscordId: winnerId,
          loserDiscordId: loserId,
          scoreChallenger: scoreA,
          scoreOpponent: scoreB,
          roundWinners,
          challengerIngame,
          opponentIngame,
          endedAtMs: Date.now(),
        },
      });
    } catch (e) {
      console.error("[1v1] insertEventSnapshot failed:", e);
    }
  } catch (e) {
    if (e instanceof Error && e.message === "1v1 aborted") {
      console.log("[1v1] match stopped by admin");
    } else {
      throw e;
    }
  } finally {
    runningOneV1.delete(rustServerId);
    onev1RespawnWait.cancel(rustServerId);
    onev1KillTracker.unregister(rustServerId);
    await deleteMatch(pool, matchId).catch(() => {});
  }
}
