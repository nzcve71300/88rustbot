import type { Pool } from "mysql2/promise";
import { config } from "../config.js";
import { decryptSecret } from "../crypto/passwordVault.js";
import { listAllRustServers } from "../db/rustServers.js";
import { startConsoleStream, type ConsoleStreamHandle } from "./webrcon.js";
import { kothKillTracker } from "../koth/killTracker.js";
import { mazeKillTracker } from "../maze/killTracker.js";
import { nuketownKillTracker } from "../nuketown/killTracker.js";
import { onev1KillTracker } from "../onev1/killTracker.js";
import { onev1RespawnWait } from "../onev1/respawnWait.js";
import { parseAnyKillLine, parseRustPlayerEnteredGame } from "../koth/killParse.js";
import { kdTracker } from "../stats/kdTracker.js";
import { onKillfeedConsoleLine, refreshKillfeedCaches } from "../killfeed/service.js";

/**
 * Subscribes to each Rust server’s RCON console stream and forwards lines to event kill trackers,
 * stats, and killfeed. (Previously this file also granted a “free kit” on a quick-chat emote — removed.)
 */
export class RconConsoleFanout {
  private streams = new Map<number, ConsoleStreamHandle>();
  /** Incomplete tail when one console line is split across WebSocket frames. */
  private lineBuffers = new Map<number, string>();

  async start(pool: Pool): Promise<void> {
    await this.refresh(pool);
  }

  /** Reconnect from DB (new servers, removed servers, credential changes). */
  async refresh(pool: Pool): Promise<void> {
    for (const h of this.streams.values()) {
      h.stop();
    }
    this.streams.clear();
    this.lineBuffers.clear();

    const rows = await listAllRustServers(pool);
    for (const row of rows) {
      let password: string;
      try {
        password = decryptSecret(row.rcon_password_encrypted, config.encryptionKeyHex);
      } catch (err) {
        console.error(`[rcon console] skip server id=${row.id} (${row.nickname}): cannot decrypt password`, err);
        continue;
      }

      const serverId = Number(row.id);
      const label = `${row.nickname} (#${serverId})`;
      const handle = startConsoleStream(
        serverId,
        row.server_ip,
        row.rcon_port,
        password,
        (text) => this.handleConsoleChunk(serverId, text),
        label
      );
      this.streams.set(serverId, handle);
    }

    try {
      await refreshKillfeedCaches(pool);
    } catch (err) {
      console.error("[killfeed] refresh caches failed:", err);
    }

    console.log(`[rcon console] streaming logs from ${this.streams.size} Rust server(s) for events / killfeed.`);
  }

  private handleConsoleChunk(serverId: number, text: string): void {
    const buf = (this.lineBuffers.get(serverId) ?? "") + text;
    const parts = buf.split(/\r?\n/);
    const tail = parts.pop() ?? "";
    this.lineBuffers.set(serverId, tail);

    for (const raw of parts) {
      const lines = raw.split("\0").map((s) => s.trimEnd()).filter((s) => s.length > 0);
      if (lines.length === 0) continue;
      for (const line of lines) {
        kothKillTracker.onConsoleLine(serverId, line);
        mazeKillTracker.onConsoleLine(serverId, line);
        nuketownKillTracker.onConsoleLine(serverId, line);
        onev1KillTracker.onConsoleLine(serverId, line);
        onev1RespawnWait.onConsoleLine(serverId, line);
        void kdTracker.onConsoleLine(serverId, line);
        onKillfeedConsoleLine(serverId, line);
      }
    }

    const tailTrim = tail.trimEnd();
    for (const seg of tailTrim.split("\0")) {
      const t = seg.trimEnd();
      const isKill = t && Boolean(parseAnyKillLine(t));
      const isEnterGame = t && Boolean(parseRustPlayerEnteredGame(t));
      if (isKill || isEnterGame) {
        mazeKillTracker.onConsoleLine(serverId, t);
        onev1RespawnWait.onConsoleLine(serverId, t);
      }
      if (isKill) {
        kothKillTracker.onConsoleLine(serverId, t);
        nuketownKillTracker.onConsoleLine(serverId, t);
        onev1KillTracker.onConsoleLine(serverId, t);
        void kdTracker.onConsoleLine(serverId, t);
        onKillfeedConsoleLine(serverId, t);
        this.lineBuffers.set(serverId, "");
      } else if (isEnterGame) {
        this.lineBuffers.set(serverId, "");
      }
    }
  }
}

export const rconConsoleFanout = new RconConsoleFanout();
