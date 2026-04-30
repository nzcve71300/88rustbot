import { baseEmbed } from "../embeds/standard.js";

export type NuketownTeamView = {
  slot: number;
  clanTag: string;
  clanName: string;
  members: string[];
};

export type NuketownBracketState =
  | {
      kind: "nuketown";
      teams: { slot: number; clanId: number; clanTag: string; clanName: string }[];
      stage: "lobby";
      lobbyEndsAtMs: number | null;
    }
  | {
      kind: "nuketown";
      teams: { slot: number; clanId: number; clanTag: string; clanName: string }[];
      stage: "running";
      currentMatch:
        | null
        | {
            label: "Semi 1" | "Semi 2" | "Final";
            teamA: { slot: number; clanTag: string };
            teamB: { slot: number; clanTag: string };
            round: number;
            scoreA: number;
            scoreB: number;
          };
      winners: {
        semi1?: { slot: number; clanTag: string } | null;
        semi2?: { slot: number; clanTag: string } | null;
        champion?: { slot: number; clanTag: string } | null;
      };
    };

function fmtTeam(t: { clanTag: string; clanName: string }): string {
  const tag = t.clanTag?.trim() ? `[${t.clanTag.trim()}] ` : "";
  return `${tag}${t.clanName}`;
}

export function renderNuketownEmbed(
  serverName: string,
  serverNickname: string,
  teams: NuketownTeamView[],
  lobbyEndsAtMs: number | null,
  teamLimit: number,
  mode?: "nuketown" | "tournament" | null,
  eventNumber?: number | null
) {
  const inferredTournament = teams.length >= 3;
  const isTournament = mode === "tournament" ? true : mode === "nuketown" ? false : inferredTournament;
  const eventName = isTournament
    ? "Nuketown Tournament (4 clans • Bo3)"
    : "Nuketown (2 clans • Bo3)";
  const eventNo = eventNumber != null ? ` #${eventNumber}` : "";

  const countdown = lobbyEndsAtMs != null ? `<t:${Math.floor(lobbyEndsAtMs / 1000)}:R>` : "";
  const startsLine = countdown ? `Starts **${countdown}**` : "";

  const teamLines: string[] = [];
  if (teams.length === 0) {
    teamLines.push("_No teams yet._");
  } else {
    for (const t of teams.slice().sort((a, b) => a.slot - b.slot)) {
      teamLines.push(`**Team ${t.slot}** — ${fmtTeam(t)}`);
    }
  }

  return baseEmbed()
    .setTitle(`${eventName}${eventNo}`)
    .setDescription(
      [
        `**Max ${teamLimit} players / team**`,
        "",
        "**Nuketown Event is starting soon!**",
        "",
        "**How it works**",
        "- Join as a clan member (requires **/link** + being in a **clan**).",
        "- When the lobby closes, the bot will **kit + teleport** your team into the arena.",
        "- Rounds are **Best of 3**. If it’s a tournament, it’s **4 clans** (semi-finals → final).",
        "**Event Starting**",
        startsLine,
        "",
        `Use **/nuketown-join** with server **${serverNickname}** to join.`,
        "",
        "**Teams**",
        teamLines.join("\n"),
      ]
        .filter(Boolean)
        .join("\n")
        .trim()
    );
}

