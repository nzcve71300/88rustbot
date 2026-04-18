import { pool } from "../db/pool.js";
import { incrementPlayerDeaths, incrementPlayerKills } from "../db/playerKd.js";
import { getGuildRowIdForRustServerId } from "../db/rustServers.js";
import { parseAnyKillLine } from "../koth/killParse.js";

class KdTracker {
  private guildCache = new Map<number, number>();

  private isNpcOrEntity(name: string): boolean {
    const t = name.replace(/\0/g, "").trim();
    if (!t) return true;
    // Your rule: NPC/animal kills often appear as numeric "names".
    if (/^\d+$/.test(t)) return true;
    // Rust entity identifiers / non-player sources.
    if (t.includes(".entity")) return true;
    return false;
  }

  async onConsoleLine(rustServerId: number, line: string): Promise<void> {
    try {
      const parsed = parseAnyKillLine(line);
      if (!parsed) return;

      if (this.isNpcOrEntity(parsed.killer) || this.isNpcOrEntity(parsed.victim)) return;

      let guildRowId = this.guildCache.get(rustServerId);
      if (!guildRowId) {
        const gid = await getGuildRowIdForRustServerId(pool, rustServerId);
        if (!gid) return;
        this.guildCache.set(rustServerId, gid);
        guildRowId = gid;
      }

      // No /link required: track by in-game names directly (server-scoped, guild-scoped).
      await Promise.all([
        incrementPlayerKills(pool, guildRowId, rustServerId, parsed.killer, 1),
        incrementPlayerDeaths(pool, guildRowId, rustServerId, parsed.victim, 1),
      ]);
    } catch (err) {
      console.error("[kd] failed to record kill/death:", err);
    }
  }
}

export const kdTracker = new KdTracker();

