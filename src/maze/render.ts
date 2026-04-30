import { baseEmbed } from "../embeds/standard.js";
import type { MazeSpawnView } from "../db/maze.js";

export function renderMazeEmbed(
  serverName: string,
  serverNickname: string,
  spawns: MazeSpawnView[],
  durationMinutes: number | null,
  countdownEndsAtMs: number | null
) {
  const lines: string[] = [];
  if (spawns.length === 0) {
    lines.push("_No players joined yet._");
  } else {
    for (const s of spawns) {
      lines.push(
        `Maze spawn-point ${s.spawnNumber} — ${s.clanName} · ${s.ingameName} (@🔗${s.ingameName})`
      );
    }
  }

  const dur = durationMinutes != null ? `${durationMinutes} min` : "TBD";
  const countdown =
    countdownEndsAtMs != null ? `<t:${Math.floor(countdownEndsAtMs / 1000)}:R>` : "";
  const startsLine = countdown ? `**${countdown}**` : "";

  return baseEmbed()
    .setTitle(`🧭 Maze Event (${dur}) — ${serverName}`)
    .setDescription(
      [
        `Use **/maze-join** with server **${serverNickname}** to join (max **10** players, clan + /link required).`,
        "",
        "**Rules / expectations**",
        "- **Max 1 member per clan**",
        "- When the event starts, the bot will **kit + teleport** you automatically.",
        "- If respawns are enabled: after you die, click **Respawn** and you will be teleported **once** to a new maze spawn.",
        "",
        "**Event starting**",
        startsLine,
        "",
        "**Roster**",
        lines.join("\n"),
      ]
        .filter(Boolean)
        .join("\n")
        .trim()
    );
}
