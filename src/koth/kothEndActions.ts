import type { Pool } from "mysql2/promise";
import { config } from "../config.js";
import { decryptSecret } from "../crypto/passwordVault.js";
import {
  deleteKothEventRow,
  getActiveKothEvent,
  getKothConfig,
  mergeKothConfig,
  getKothEventTopKillerWithLink,
  listKothParticipantsWithGatesAndClan,
  listWaveKillsDetailed,
  sumKillsByClanForWave,
} from "../db/koth.js";
import { getRustServerByIdForGuild } from "../db/rustServers.js";
import { insertEventSnapshot } from "../db/eventSnapshots.js";
import { kothKillTracker } from "../koth/killTracker.js";
import { requestStopKoth } from "../koth/runner.js";
import { buildKothEndedSay, runSayRcon } from "../rcon/eventBroadcasts.js";
import { runWebRconCommand } from "../rcon/webrcon.js";

/**
 * Shared KOTH end logic (Discord `/koth-end` and website admin panel).
 */
export async function performKothEnd(pool: Pool, guildRowId: number, serverId: number): Promise<{
  ok: true;
  hadActive: boolean;
  stoppedRunner: boolean;
} | { ok: false; error: string }> {
  const active = await getActiveKothEvent(pool, guildRowId, serverId);
  if (!active) {
    return { ok: true, hadActive: false, stoppedRunner: false };
  }

  const stopped = requestStopKoth(serverId);

  try {
    const cfg = await getKothConfig(pool, guildRowId, serverId);
    const srv = await getRustServerByIdForGuild(pool, guildRowId, serverId);
    if (cfg && srv) {
      const password = decryptSecret(srv.rcon_password_encrypted, config.encryptionKeyHex);
      await runWebRconCommand(serverId, srv.server_ip, srv.rcon_port, password, "rf.removefakeboardcaster");
      try {
        await kothKillTracker.drain(serverId);
        const top = await getKothEventTopKillerWithLink(pool, guildRowId, active.id);
        const endedCmd = buildKothEndedSay(top?.clanName ?? "N/A", top?.ingameName ?? "N/A");
        void runSayRcon(serverId, srv.server_ip, srv.rcon_port, password, endedCmd, "koth-end");
      } catch (err) {
        console.error("[koth-end] in-game say failed:", err);
      }
    }
  } catch (err) {
    console.error("[koth-end] rf.removefakeboardcaster failed:", err);
  }

  try {
    const top = await getKothEventTopKillerWithLink(pool, guildRowId, active.id);
    const participants = await listKothParticipantsWithGatesAndClan(pool, guildRowId, active.id);
    const perWave: unknown[] = [];
    for (let w = 1; w <= 10; w++) {
      const players = await listWaveKillsDetailed(pool, active.id, w);
      if (players.length === 0 && w > 1) break;
      const clans = await sumKillsByClanForWave(pool, active.id, w);
      perWave.push({ wave: w, players, clans });
    }
    await insertEventSnapshot({
      pool,
      guildRowId,
      rustServerId: serverId,
      type: "koth",
      payload: { kind: "koth", endedAtMs: Date.now(), topKiller: top, participants, perWave },
    });
  } catch (err) {
    console.error("[koth-end] failed to snapshot ended event:", err);
  }

  await deleteKothEventRow(pool, guildRowId, active.id);
  const cfgAfter = await getKothConfig(pool, guildRowId, serverId);
  if (cfgAfter?.automationStarted && cfgAfter.howOftenHours && cfgAfter.howOftenHours > 0) {
    await mergeKothConfig(pool, guildRowId, serverId, {
      nextLobbyAtMs: Date.now() + cfgAfter.howOftenHours * 3600_000,
    });
  } else {
    await pool.query(`DELETE FROM koth_configs WHERE guild_id = :gid AND rust_server_id = :sid`, {
      gid: guildRowId,
      sid: serverId,
    });
  }

  return { ok: true, hadActive: true, stoppedRunner: stopped };
}
