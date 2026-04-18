import type { AutocompleteInteraction } from "discord.js";
import { MAZE_MAX_SPAWN_POINTS } from "../../db/maze.js";

export const MAZE_SPAWN_AUTOCOMPLETE_MAX = 12;

const SPAWN_CHOICES = Array.from({ length: MAZE_MAX_SPAWN_POINTS }, (_, i) => {
  const n = i + 1;
  return { name: `Maze spawn-point ${n}`, value: String(n) };
});

export async function autocompleteMazeSpawnOption(
  interaction: AutocompleteInteraction,
  optionName = "spawn"
): Promise<void> {
  const focused = interaction.options.getFocused(true);
  if (focused.name !== optionName) {
    await interaction.respond([]);
    return;
  }

  const q = focused.value.toLowerCase().trim();
  let list = SPAWN_CHOICES;
  if (q.length > 0) {
    list = SPAWN_CHOICES.filter((g) => {
      const n = g.value;
      const nameLower = g.name.toLowerCase();
      return (
        nameLower.includes(q) ||
        n.includes(q) ||
        q === n ||
        (q.includes("maze") && nameLower.includes(q.replace(/maze\s*spawn[- ]?point\s*/i, "").trim()))
      );
    });
  }

  await interaction.respond(
    list.slice(0, MAZE_SPAWN_AUTOCOMPLETE_MAX).map((g) => ({
      name: g.name.length > 100 ? g.name.slice(0, 97) + "..." : g.name,
      value: g.value,
    }))
  );
}

/** Parse `Maze spawn-point N`, `spawn N`, or numeric 1–10. */
export function parseMazeSpawnPosition(raw: string): number | null {
  const s = raw.trim();
  const direct = Number.parseInt(s, 10);
  if (Number.isFinite(direct) && direct >= 1 && direct <= MAZE_MAX_SPAWN_POINTS) return direct;
  let m = s.match(/^maze\s+spawn[- ]?point\s*(\d{1,2})$/i);
  if (m) {
    const n = Number.parseInt(m[1], 10);
    if (n >= 1 && n <= MAZE_MAX_SPAWN_POINTS) return n;
  }
  m = s.match(/^spawn\s*(\d{1,2})$/i);
  if (m) {
    const n = Number.parseInt(m[1], 10);
    if (n >= 1 && n <= MAZE_MAX_SPAWN_POINTS) return n;
  }
  return null;
}
