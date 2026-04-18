import { type AutocompleteInteraction, type ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";
import { memberHasAdminRole } from "../../admin/guildAdmin.js";
import { ADMIN_ROLE_NAME } from "../../constants.js";
import { getOrCreateGuildRow } from "../../db/guilds.js";
import { pool } from "../../db/pool.js";
import { upsertGateCoord } from "../../db/koth.js";
import { upsertMazeSpawnCoord } from "../../db/maze.js";
import { upsertNuketownGateCoord } from "../../db/nuketown.js";
import { upsertOneV1GateCoord } from "../../db/onev1.js";
import { listRustServersForGuild } from "../../db/rustServers.js";
import { baseEmbed } from "../../embeds/standard.js";
import { normalizeCoordinates, parseGatePosition } from "../shared/gatePositionOption.js";
import { parseMazeSpawnPosition } from "../shared/mazeSpawnOption.js";
import { autocompleteServerOption, validateServerSelection } from "../shared/serverOption.js";

type PositionParse =
  | { kind: "koth_gate"; gate: number }
  | { kind: "maze_spawn"; spawn: number }
  | { kind: "nuketown_gate"; gate: number }
  | { kind: "onev1_gate"; gate: 1 | 2 };

function parsePosition(raw: string): PositionParse | null {
  const s = raw.trim();
  const low = s.toLowerCase();
  const num = Number.parseInt(low.replace(/[^0-9]/g, ""), 10);
  const hasNum = Number.isFinite(num);
  const isMaze = low.includes("maze") || low.includes("spawn");
  const isNuke = low.includes("nuke");
  const is1v1 = low.includes("1v1") || low.includes("onev1") || low.includes("1 v 1");
  const isKoth = (low.includes("koth") || low.includes("gate")) && !is1v1;

  if (isMaze) {
    const spawn = parseMazeSpawnPosition(s);
    if (spawn != null) return { kind: "maze_spawn", spawn };
    if (hasNum && num >= 1 && num <= 10) return { kind: "maze_spawn", spawn: num };
    return null;
  }
  if (isNuke) {
    if (hasNum && num >= 1 && num <= 20) return { kind: "nuketown_gate", gate: num };
    return null;
  }
  if (is1v1) {
    // "1v1 Gate 1" must not use all digits in the string (1+v+1+1 → 111). Use the number after "gate".
    const gateMatch = low.match(/\bgate\s*(\d+)/);
    if (gateMatch) {
      const g = Number.parseInt(gateMatch[1] ?? "", 10);
      if (g === 1 || g === 2) return { kind: "onev1_gate", gate: g as 1 | 2 };
    }
    return null;
  }
  if (isKoth) {
    const gate = parseGatePosition(s);
    if (gate != null) return { kind: "koth_gate", gate };
    if (hasNum && num >= 1 && num <= 20) return { kind: "koth_gate", gate: num };
    return null;
  }
  return null;
}

function makeChoices(query: string): { name: string; value: string }[] {
  const q = query.trim().toLowerCase();
  const all: { name: string; value: string; group: "koth" | "maze" | "nuke" | "1v1" }[] = [];
  for (let i = 1; i <= 20; i++) all.push({ name: `KOTH Gate ${i}`, value: `KOTH Gate ${i}`, group: "koth" });
  for (let i = 1; i <= 10; i++) all.push({ name: `Maze spawn-point ${i}`, value: `Maze spawn-point ${i}`, group: "maze" });
  for (let i = 1; i <= 20; i++) all.push({ name: `Nuketown Gate ${i}`, value: `Nuketown Gate ${i}`, group: "nuke" });
  all.push({ name: "1v1 Gate 1", value: "1v1 Gate 1", group: "1v1" });
  all.push({ name: "1v1 Gate 2", value: "1v1 Gate 2", group: "1v1" });

  let filtered = all;
  if (q) filtered = all.filter((x) => x.name.toLowerCase().includes(q));
  if (filtered.length > 25) {
    // Default mix: 12 KOTH, 10 Maze, 3 Nuketown.
    const k = filtered.filter((x) => x.group === "koth").slice(0, 12);
    const m = filtered.filter((x) => x.group === "maze").slice(0, 10);
    const n = filtered.filter((x) => x.group === "nuke").slice(0, 3);
    const v = filtered.filter((x) => x.group === "1v1").slice(0, 2);
    filtered = [...k, ...m, ...n, ...v];
  }
  return filtered.slice(0, 25).map((x) => ({ name: x.name, value: x.value }));
}

export const managePositionsCommand = {
  data: new SlashCommandBuilder()
    .setName("manage-positions")
    .setDescription("Save world coordinates for event positions (admin only).")
    .addStringOption((o) => o.setName("server").setDescription("Rust server").setRequired(true).setAutocomplete(true))
    .addStringOption((o) =>
      o
        .setName("position")
        .setDescription("KOTH / Maze / Nuketown / 1v1 Gate 1–2")
        .setRequired(true)
        .setAutocomplete(true)
    )
    .addStringOption((o) => o.setName("coordinates").setDescription("World position: x y z").setRequired(true)),

  async autocomplete(interaction: AutocompleteInteraction) {
    const focused = interaction.options.getFocused(true);
    if (focused.name === "server") {
      await autocompleteServerOption(interaction, "server");
      return;
    }
    if (focused.name === "position") {
      const choices = makeChoices(String(focused.value ?? ""));
      await interaction.respond(choices);
      return;
    }
    await interaction.respond([]);
  },

  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.inGuild() || !interaction.guild || !interaction.member) {
      await interaction.reply({ content: "This command can only be used inside a server.", ephemeral: true });
      return;
    }
    if (!memberHasAdminRole(interaction.member, interaction.guild)) {
      await interaction.reply({
        content: `You need the **${ADMIN_ROLE_NAME}** role to use this command.`,
        ephemeral: true,
      });
      return;
    }

    const serverId = Number.parseInt(interaction.options.getString("server", true), 10);
    const positionRaw = interaction.options.getString("position", true);
    const coordinatesRaw = interaction.options.getString("coordinates", true);

    if (!Number.isFinite(serverId) || !(await validateServerSelection(interaction.guild.id, serverId))) {
      await interaction.reply({
        embeds: [baseEmbed().setTitle("Invalid server").setDescription("Pick a server from autocomplete.")],
        ephemeral: true,
      });
      return;
    }

    const coordNorm = normalizeCoordinates(coordinatesRaw);
    if (!coordNorm) {
      await interaction.reply({
        embeds: [
          baseEmbed()
            .setTitle("Invalid coordinates")
            .setDescription("Provide three numbers: **x y z** (spaces or commas)."),
        ],
        ephemeral: true,
      });
      return;
    }

    await interaction.deferReply({ ephemeral: true });
    const guildRowId = await getOrCreateGuildRow(pool, interaction.guild.id);
    const servers = await listRustServersForGuild(pool, guildRowId);
    const srv = servers.find((s) => String(s.id) === String(serverId));
    const serverLabel = srv?.nickname ?? "Server";

    const parsed = parsePosition(positionRaw);
    if (!parsed) {
      await interaction.editReply({
        embeds: [
          baseEmbed()
            .setTitle("Invalid position")
            .setDescription(
              "Pick from autocomplete: **KOTH Gate 1–20**, **Maze spawn-point 1–10**, **Nuketown Gate 1–20**, or **1v1 Gate 1–2**."
            ),
        ],
      });
      return;
    }

    if (parsed.kind === "koth_gate") {
      await upsertGateCoord(pool, guildRowId, serverId, parsed.gate, coordNorm);
      await interaction.editReply({
        embeds: [
          baseEmbed()
            .setTitle("Position saved")
            .setDescription([`**Server:** ${serverLabel}`, `**KOTH Gate:** ${parsed.gate}`, `**Coordinates:** \`${coordNorm}\``].join("\n")),
        ],
      });
      return;
    }
    if (parsed.kind === "maze_spawn") {
      await upsertMazeSpawnCoord(pool, guildRowId, serverId, parsed.spawn, coordNorm);
      await interaction.editReply({
        embeds: [
          baseEmbed()
            .setTitle("Position saved")
            .setDescription([`**Server:** ${serverLabel}`, `**Maze spawn-point:** ${parsed.spawn}`, `**Coordinates:** \`${coordNorm}\``].join("\n")),
        ],
      });
      return;
    }
    if (parsed.kind === "nuketown_gate") {
      await upsertNuketownGateCoord(pool, guildRowId, serverId, parsed.gate, coordNorm);
      await interaction.editReply({
        embeds: [
          baseEmbed()
            .setTitle("Position saved")
            .setDescription([`**Server:** ${serverLabel}`, `**Nuketown Gate:** ${parsed.gate}`, `**Coordinates:** \`${coordNorm}\``].join("\n")),
        ],
      });
      return;
    }
    if (parsed.kind === "onev1_gate") {
      await upsertOneV1GateCoord(pool, guildRowId, serverId, parsed.gate, coordNorm);
      await interaction.editReply({
        embeds: [
          baseEmbed()
            .setTitle("Position saved")
            .setDescription(
              [`**Server:** ${serverLabel}`, `**1v1 Gate:** ${parsed.gate}`, `**Coordinates:** \`${coordNorm}\``].join("\n")
            ),
        ],
      });
      return;
    }
  },
};
