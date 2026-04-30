import { baseEmbed } from "../embeds/standard.js";

export type GateView = {
  gateNumber: number;
  clanName: string;
  members: string[];
};

export function renderKothEmbed(
  serverName: string,
  serverNickname: string,
  gates: GateView[],
  eventNumber?: number | null,
  countdownEndsAtMs?: number | null
) {
  const eventNo = eventNumber != null ? ` #${eventNumber}` : "";
  const countdownUnix = countdownEndsAtMs != null ? Math.floor(countdownEndsAtMs / 1000) : null;
  const rel = countdownUnix != null ? `<t:${countdownUnix}:R>` : "";
  const at = countdownUnix != null ? `<t:${countdownUnix}:t>` : "";
  const timerLine = countdownUnix != null ? `Lobby closes **${rel}** (at ${at})` : "";

  const lines: string[] = [];

  if (gates.length === 0) {
    lines.push("_No clans joined yet._");
  } else {
    for (const g of gates) {
      lines.push(`**Gate ${g.gateNumber}** — ${g.clanName}`);
      if (g.members.length === 0) {
        lines.push("_No members listed._");
      } else {
        for (const m of g.members) lines.push(`- ${m}`);
      }
      lines.push("");
    }
  }

  return baseEmbed()
    .setTitle(`🏆 King of the Hill${eventNo} — ${serverName}`)
    .setDescription(
      [
        "**KOTH Event is starting soon!**",
        "",
        "**How it works**",
        "- Join as a clan member (requires **/link** + being in a **clan**).",
        "- When the lobby closes, the bot will **kit + teleport** participants to their gate.",
        `- Doors open after a **${Math.round(60_000 / 1000)}s** prep window.`,
        "",
        "**Lobby timer**",
        timerLine,
        "",
        `Use **/koth-join** with server **${serverNickname}** to participate.`,
        "",
        "**Gates**",
        lines.join("\n").trim(),
      ]
        .filter(Boolean)
        .join("\n")
        .trim()
    );
}

