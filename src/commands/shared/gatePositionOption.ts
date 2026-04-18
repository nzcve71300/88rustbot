import type { AutocompleteInteraction } from "discord.js";

/** Gates 1–20; Discord autocomplete responses are capped at 25 — we show at most 12. */
export const KOTH_GATE_COUNT = 20;
export const GATE_AUTOCOMPLETE_MAX = 12;

const GATE_CHOICES = Array.from({ length: KOTH_GATE_COUNT }, (_, i) => {
  const n = i + 1;
  return { name: `KOTH Gate ${n}`, value: String(n) };
});

/**
 * Autocomplete for `position` (KOTH Gate 1–20). Shows up to 12 matches; type e.g. `15`, `Gate 15`, or `KOTH Gate 15`.
 */
export async function autocompleteGatePositionOption(
  interaction: AutocompleteInteraction,
  optionName = "position"
): Promise<void> {
  const focused = interaction.options.getFocused(true);
  if (focused.name !== optionName) {
    await interaction.respond([]);
    return;
  }

  const q = focused.value.toLowerCase().trim();
  let list = GATE_CHOICES;

  if (q.length > 0) {
    list = GATE_CHOICES.filter((g) => {
      const n = g.value;
      const nameLower = g.name.toLowerCase();
      const qn = q.replace(/^koth\s+/i, "").trim();
      return (
        nameLower.includes(q) ||
        nameLower.includes(qn) ||
        n.includes(q) ||
        q === n ||
        (q.startsWith("gate") && nameLower.replace(/\s/g, "").includes(q.replace(/\s/g, ""))) ||
        (q.includes("koth") && nameLower.includes(q.replace(/koth\s*/i, "").trim()))
      );
    });
  }

  await interaction.respond(
    list.slice(0, GATE_AUTOCOMPLETE_MAX).map((g) => ({
      name: g.name.length > 100 ? g.name.slice(0, 97) + "..." : g.name,
      value: g.value,
    }))
  );
}

/** Parse `position` option: numeric 1–20, `Gate N`, or `KOTH Gate N`. */
export function parseGatePosition(raw: string): number | null {
  const s = raw.trim();
  const direct = Number.parseInt(s, 10);
  if (Number.isFinite(direct) && direct >= 1 && direct <= KOTH_GATE_COUNT) return direct;
  let m = s.match(/^gate\s*(\d{1,2})$/i);
  if (m) {
    const n = Number.parseInt(m[1], 10);
    if (n >= 1 && n <= KOTH_GATE_COUNT) return n;
  }
  m = s.match(/^koth\s+gate\s*(\d{1,2})$/i);
  if (m) {
    const n = Number.parseInt(m[1], 10);
    if (n >= 1 && n <= KOTH_GATE_COUNT) return n;
  }
  return null;
}

/** Normalize coordinates to three numbers (space-separated) for DB + RCON. */
export function normalizeCoordinates(raw: string): string | null {
  const parts = raw
    .trim()
    .split(/[\s,]+/)
    .map((x) => Number.parseFloat(x))
    .filter((x) => Number.isFinite(x));
  if (parts.length < 3) return null;
  return `${parts[0]} ${parts[1]} ${parts[2]}`;
}
