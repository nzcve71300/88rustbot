import { type ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";
import { memberHasAdminRole } from "../../admin/guildAdmin.js";
import { ADMIN_ROLE_NAME } from "../../constants.js";
import { getOrCreateGuildRow } from "../../db/guilds.js";
import { pool } from "../../db/pool.js";
import { getActiveMazeEvent, getMazeConfig } from "../../db/maze.js";
import { baseEmbed } from "../../embeds/standard.js";
import { performMazeDelete } from "../../maze/mazeEndActions.js";
import { autocompleteServerOption, validateServerSelection } from "../shared/serverOption.js";

export const mazeDeleteCommand = {
  data: new SlashCommandBuilder()
    .setName("maze-delete")
    .setDescription("Force-stop and remove the Maze event for a server (admin only).")
    .addStringOption((o) =>
      o.setName("server").setDescription("Rust server").setRequired(true).setAutocomplete(true)
    ),

  async autocomplete(interaction: import("discord.js").AutocompleteInteraction) {
    await autocompleteServerOption(interaction, "server");
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
    if (!Number.isFinite(serverId) || !(await validateServerSelection(interaction.guild.id, serverId))) {
      await interaction.reply({
        embeds: [baseEmbed().setTitle("Invalid server").setDescription("Pick a server from autocomplete.")],
        ephemeral: true,
      });
      return;
    }

    await interaction.deferReply({ ephemeral: true });

    const guildRowId = await getOrCreateGuildRow(pool, interaction.guild.id);
    const active = await getActiveMazeEvent(pool, guildRowId, serverId);
    if (!active) {
      await interaction.editReply({
        embeds: [
          baseEmbed()
            .setTitle("No active Maze")
            .setDescription("There is no lobby or running Maze for this server."),
        ],
      });
      return;
    }

    const cfgBefore = await getMazeConfig(pool, guildRowId, serverId);
    const result = await performMazeDelete(pool, guildRowId, serverId);
    if (!result.ok) {
      await interaction.editReply({ embeds: [baseEmbed().setTitle("Error").setDescription(result.error)] });
      return;
    }

    const channelNote = cfgBefore?.announcementChannelId
      ? ` The old announcement was in <#${cfgBefore.announcementChannelId}> (message may still exist).`
      : "";

    await interaction.editReply({
      embeds: [
        baseEmbed()
          .setTitle("Maze removed")
          .setDescription(
            [
              `**Server ID:** ${serverId}`,
              `**Was:** ${active.status}`,
              result.stoppedRunner ? "**Runner:** abort signal sent" : "**Runner:** not running (lobby only or other process)",
              "",
              `Maze config was cleared. Run **/maze-setup** again before the next event. Spawn coordinates from **/manage-positions maze-spawn** are kept.${channelNote}`,
            ].join("\n")
          ),
      ],
    });
  },
};
