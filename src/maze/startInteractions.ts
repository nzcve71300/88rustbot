import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type ButtonInteraction,
} from "discord.js";
import { memberHasAdminRole } from "../admin/guildAdmin.js";
import { ADMIN_ROLE_NAME } from "../constants.js";
import { getMazeConfig, isMazeAutomationConfigComplete } from "../db/maze.js";
import { getOrCreateGuildRow } from "../db/guilds.js";
import { pool } from "../db/pool.js";
import { baseEmbed } from "../embeds/standard.js";
import { startMazeAutomation } from "./automation.js";

export function mazeRestartCustomId(kind: "y" | "n", rustServerId: number): string {
  return `maze:rs:${kind}:${rustServerId}`;
}

export async function handleMazeForceRestart(interaction: ButtonInteraction): Promise<void> {
  if (!interaction.guild || !interaction.member) {
    await interaction.reply({ content: "Invalid context.", ephemeral: true });
    return;
  }
  if (!memberHasAdminRole(interaction.member, interaction.guild)) {
    await interaction.reply({
      content: `You need the **${ADMIN_ROLE_NAME}** role.`,
      ephemeral: true,
    });
    return;
  }
  const m = /^maze:rs:(y|n):(\d+)$/.exec(interaction.customId);
  if (!m) {
    await interaction.reply({ content: "Invalid button.", ephemeral: true });
    return;
  }
  const rustServerId = Number.parseInt(m[2] ?? "", 10);
  const guildRowId = await getOrCreateGuildRow(pool, interaction.guild.id);

  if (m[1] === "n") {
    await interaction.update({
      content: "Okay — automation settings unchanged.",
      embeds: [],
      components: [],
    });
    return;
  }

  const cfg = await getMazeConfig(pool, guildRowId, rustServerId);
  if (!cfg || !isMazeAutomationConfigComplete(cfg)) {
    await interaction.update({
      content: "Setup is incomplete. Run **/maze-setup** first.",
      embeds: [],
      components: [],
    });
    return;
  }

  const started = await startMazeAutomation(pool, guildRowId, rustServerId);
  if (!started.ok) {
    await interaction.update({
      content: started.error ?? "Could not restart automation.",
      embeds: [],
      components: [],
    });
    return;
  }

  await interaction.update({
    embeds: [
      baseEmbed()
        .setTitle("Maze automation")
        .setDescription(
          "Schedule reset — the next **automatic lobby** will open on the next bot tick (usually within ~20 seconds)."
        ),
    ],
    components: [],
  });
}
