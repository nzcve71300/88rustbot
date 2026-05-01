import type { Pool } from "mysql2/promise";
import { config } from "../config.js";
import { decryptSecret } from "../crypto/passwordVault.js";
import {
  getActiveMazeEvent,
  getMazeEventTopKillerWithLink,
  listMazeKillsDetailedForEvent,
  listMazeSpawnViews,
  removeMazeEventAndApplyConfigOutcome,
  sumMazeTotalKillsForEvent,
} from "../db/maze.js";
import { getRustServerByIdForGuild } from "../db/rustServers.js";
import { insertEventSnapshot } from "../db/eventSnapshots.js";
import { mazeKillTracker } from "../maze/killTracker.js";
import { requestStopMaze } from "../maze/runner.js";
import { buildMazeEndedSay, runSayRcon } from "../rcon/eventBroadcasts.js";
import { applyEventZoneConfigIfPresent } from "../zones/eventZones.js";

export async function performMazeDelete(pool: Pool, guildRowId: number, serverId: number): Promise<{
  ok: true;
  hadActive: boolean;
  stoppedRunner: boolean;
} | { ok: false; error: string }> {
  const active = await getActiveMazeEvent(pool, guildRowId, serverId);
  if (!active) {
    return { ok: true, hadActive: false, stoppedRunner: false };
  }

  const stopped = requestStopMaze(serverId);

  try {
    const srv = await getRustServerByIdForGuild(pool, guildRowId, serverId);
    if (srv) {
      const password = decryptSecret(srv.rcon_password_encrypted, config.encryptionKeyHex);
      await mazeKillTracker.drain(serverId);
      const top = await getMazeEventTopKillerWithLink(pool, guildRowId, active.id);
      const endedCmd = buildMazeEndedSay(top?.clanName ?? "N/A", top?.ingameName ?? "N/A");
      void runSayRcon(serverId, srv.server_ip, srv.rcon_port, password, endedCmd, "maze-delete");
    }
  } catch (err) {
    console.error("[maze-delete] in-game say failed:", err);
  }

  try {
    const totalKills = await sumMazeTotalKillsForEvent(pool, active.id);
    const leaderboard = await listMazeKillsDetailedForEvent(pool, active.id);
    const roster = await listMazeSpawnViews(pool, guildRowId, active.id);
    const top = await getMazeEventTopKillerWithLink(pool, guildRowId, active.id);
    await insertEventSnapshot({
      pool,
      guildRowId,
      rustServerId: serverId,
      type: "maze",
      payload: { kind: "maze", endedAtMs: Date.now(), totalKills, topKiller: top, roster, leaderboard },
    });
  } catch (err) {
    console.error("[maze-delete] failed to snapshot ended event:", err);
  }

  await removeMazeEventAndApplyConfigOutcome(pool, guildRowId, serverId, active.id);

  // Zone swap: event ended -> ensure inactive zone is applied (if configured).
  try {
    const srv = await getRustServerByIdForGuild(pool, guildRowId, serverId);
    if (srv) {
      const password = decryptSecret(srv.rcon_password_encrypted, config.encryptionKeyHex);
      await applyEventZoneConfigIfPresent({
        pool,
        guildRowId,
        rustServerId: serverId,
        eventType: "maze",
        desired: "inactive",
        rcon: { host: srv.server_ip, port: srv.rcon_port, password },
      });
    }
  } catch (e) {
    console.error("[maze zones] failed to apply inactive on end:", e);
  }

  return { ok: true, hadActive: true, stoppedRunner: stopped };
}
