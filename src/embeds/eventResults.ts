import { EmbedBuilder } from "discord.js";
import { BOT_DISPLAY_NAME, EMBED_COLOR } from "../constants.js";

/** Separator between body and “Powered by” (matches user-facing layout). */
export const EVENT_RESULT_SEPARATOR = "━━━━━━━━━━━━━━━━━━";

/** Embeds for event results: no default footer — “Powered by” lives in the description. */
export function eventResultEmbed(): EmbedBuilder {
  return new EmbedBuilder().setColor(EMBED_COLOR);
}

export function medalForRank(rank: number): string {
  if (rank === 1) return "🥇";
  if (rank === 2) return "🥈";
  if (rank === 3) return "🥉";
  return "🏅";
}

export function killWord(n: number): string {
  return n === 1 ? "kill" : "kills";
}

export type RankedKillRow = {
  discordUserId: string;
  kills: number;
  clanName: string;
};

export function formatRankedLeaderboardLines(players: RankedKillRow[]): string {
  if (players.length === 0) return "_No kill scores recorded._";
  return players
    .map((p, i) => {
      const rank = i + 1;
      const m = medalForRank(rank);
      return `${m} **${rank}** │ <@${p.discordUserId}> **[${p.clanName}]** — **${p.kills} ${killWord(p.kills)}**`;
    })
    .join("\n");
}

export function formatClanTotalsLines(
  clans: { clanName: string; total: number }[],
  emptyLabel: string
): string {
  if (clans.length === 0) return emptyLabel;
  return clans.map((c) => `**${c.clanName}**: ${c.total}`).join("\n");
}

export function poweredByFooterBlock(): string {
  return `${EVENT_RESULT_SEPARATOR}\n⚡ Powered by **${BOT_DISPLAY_NAME}**`;
}

/** Discord embed description max length. */
export function truncateEmbedDescription(s: string, max = 4096): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}
