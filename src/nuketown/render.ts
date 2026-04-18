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
  eventNumber?: number | null
) {
  const isTournament = teams.length >= 3;
  const eventName = isTournament ? "Nuketown Team Tournament (4 teams Bo3)" : "Nuketown Team vs Team (2 teams Bo3)";
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

