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
  const countdown =
    countdownEndsAtMs != null ? `<t:${Math.floor(countdownEndsAtMs / 1000)}:R>` : "";
  const startsLine = countdown ? `Wave ends **${countdown}**` : "";

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
        "**Event Starting**",
        startsLine,
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

