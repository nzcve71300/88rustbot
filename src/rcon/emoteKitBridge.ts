import type { Pool } from "mysql2/promise";
import {
  EMOTE_KIT_COOLDOWN_SEC,
  EMOTE_TRIGGER_WOOD,
  FREE_KIT_NAME,
} from "../constants.js";
import { config } from "../config.js";
import { decryptSecret } from "../crypto/passwordVault.js";
import { listAllRustServers } from "../db/rustServers.js";
import { runWebRconCommand, startConsoleStream, type ConsoleStreamHandle } from "./webrcon.js";
import { quoteForRconArg } from "./quote.js";
import { kothKillTracker } from "../koth/killTracker.js";
import { mazeKillTracker } from "../maze/killTracker.js";
import { nuketownKillTracker } from "../nuketown/killTracker.js";
import { onev1KillTracker } from "../onev1/killTracker.js";
import { onev1RespawnWait } from "../onev1/respawnWait.js";
import { parseAnyKillLine, parseRustPlayerEnteredGame } from "../koth/killParse.js";
import { kdTracker } from "../stats/kdTracker.js";
import { onKillfeedConsoleLine, refreshKillfeedCaches } from "../killfeed/service.js";

function buildKitCommand(playerName: string): string {
  const p = playerName.trim();
  return `kit givetoplayer "${FREE_KIT_NAME}" "${quoteForRconArg(p)}"`;
}

/**
 * Parse player name from a Rust log line. We anchor at `[CHAT …]` so colons in the
 * timestamp (`04/08/2026 20:18:16:LOG:`) never break the match.
 *
 * Example:
 *   04/08/2026 20:18:16:LOG: [CHAT SERVER] nzcve7130 : d11_quick_chat_i_need_phrase_format wood
 */
export function extractPlayerFromQuickChatWood(line: string): string | null {
  const normalized = line.replace(/\r/g, "").trim();
  if (!normalized.includes(EMOTE_TRIGGER_WOOD)) return null;

  const chatIdx = normalized.search(/\[CHAT\s+(?:SERVER|LOCAL|TEAM)\]/i);
  if (chatIdx === -1) return null;

  const fromChat = normalized.slice(chatIdx);
  const emoteIdx = fromChat.indexOf(EMOTE_TRIGGER_WOOD);
  if (emoteIdx === -1) return null;

  const beforeEmote = fromChat.slice(0, emoteIdx).trimEnd();
  const m = beforeEmote.match(/\[CHAT\s+(?:SERVER|LOCAL|TEAM)\]\s+([^:\n]+)\s*:\s*$/i);
  return m?.[1]?.trim() ?? null;
}

export class EmoteKitBridge {
  private streams = new Map<number, ConsoleStreamHandle>();
  private cooldown = new Map<string, number>();
  private inFlight = new Set<string>();
  /** Incomplete tail when one console line is split across WebSocket frames. */
  private lineBuffers = new Map<number, string>();

  async start(pool: Pool): Promise<void> {
    await this.refresh(pool);
  }

  /** Stop all listeners and reconnect from DB (new servers, removed servers, credential changes). */
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
        console.error(`[emote kit] skip server id=${row.id} (${row.nickname}): cannot decrypt password`, err);
        continue;
      }

      const serverId = Number(row.id);
      const label = `${row.nickname} (#${serverId})`;
      const handle = startConsoleStream(
        serverId,
        row.server_ip,
        row.rcon_port,
        password,
        (text) => this.handleConsoleChunk(serverId, row.server_ip, row.rcon_port, password, label, text),
        label
      );
      this.streams.set(serverId, handle);
    }

    try {
      await refreshKillfeedCaches(pool);
    } catch (err) {
      console.error("[killfeed] refresh caches failed:", err);
    }

    console.log(`[emote kit] listening on ${this.streams.size} Rust server(s) for "${EMOTE_TRIGGER_WOOD}"`);
  }

  private handleConsoleChunk(
    serverId: number,
    host: string,
    port: number,
    password: string,
    label: string,
    text: string
  ): void {
    if (process.env.DEBUG_EMOTE_KIT === "1" && text.includes("d11_quick")) {
      console.log(`[emote kit debug] ${label}:`, text.slice(0, 600));
    }

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
        this.tryEmoteOnLine(serverId, host, port, password, label, line);
      }
    }

    // Lines that arrive without a trailing newline stay in `tail` — still process kills.
    // Maze respawn also needs "has entered the game" lines; those are NOT kill lines, so forward them explicitly.
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

    if (tail.includes(EMOTE_TRIGGER_WOOD)) {
      const player = extractPlayerFromQuickChatWood(tail);
      if (player) {
        this.queueKit(serverId, host, port, password, label, player);
        this.lineBuffers.set(serverId, "");
      }
    }
  }

  private tryEmoteOnLine(
    serverId: number,
    host: string,
    port: number,
    password: string,
    label: string,
    line: string
  ): void {
    const player = extractPlayerFromQuickChatWood(line);
    if (!player) return;
    this.queueKit(serverId, host, port, password, label, player);
  }

  private queueKit(
    serverId: number,
    host: string,
    port: number,
    password: string,
    label: string,
    playerName: string
  ): void {
    if (!playerName) return;

    const cdKey = `${serverId}:${playerName.toLowerCase()}`;
    const now = Date.now();
    const last = this.cooldown.get(cdKey) ?? 0;
    if (now - last < EMOTE_KIT_COOLDOWN_SEC * 1000) return;
    if (this.inFlight.has(cdKey)) return;

    this.cooldown.set(cdKey, now);
    this.inFlight.add(cdKey);

    const cmd = buildKitCommand(playerName);
    void runWebRconCommand(serverId, host, port, password, cmd)
      .then((res) => {
        if (res.ok) {
          console.log(`[emote kit] ${label} → kit for "${playerName}"`);
        } else {
          console.error(`[emote kit] ${label} → kit failed for "${playerName}": ${res.error}`);
        }
      })
      .finally(() => {
        this.inFlight.delete(cdKey);
      });
  }
}

export const emoteKitBridge = new EmoteKitBridge();
