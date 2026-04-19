import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type ChatInputCommandInteraction,
  SlashCommandBuilder,
} from "discord.js";
import { memberHasAdminRole } from "../../admin/guildAdmin.js";
import { ADMIN_ROLE_NAME } from "../../constants.js";
import { getMazeConfig, isMazeAutomationConfigComplete } from "../../db/maze.js";
import { getOrCreateGuildRow } from "../../db/guilds.js";
import { pool } from "../../db/pool.js";
import { startMazeAutomation } from "../../maze/automation.js";
import { mazeRestartCustomId } from "../../maze/startInteractions.js";
import { baseEmbed } from "../../embeds/standard.js";
import { autocompleteServerOption, validateServerSelection } from "../shared/serverOption.js";

export const mazeStartCommand = {
  data: new SlashCommandBuilder()
    .setName("maze-start")
    .setDescription("Start automatic Maze lobbies (run once; admin). Duration, kit, and respawn come from /maze-setup.")
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

    const guildRowId = await getOrCreateGuildRow(pool, interaction.guild.id);
    const cfg = await getMazeConfig(pool, guildRowId, serverId);
    if (!cfg || !cfg.messageId || !isMazeAutomationConfigComplete(cfg)) {
      await interaction.reply({
        embeds: [
          baseEmbed()
            .setTitle("Setup incomplete")
            .setDescription(
              "Finish **/maze-setup** first (how often, duration, kit, respawn, channel, spawn slots)."
            ),
        ],
        ephemeral: true,
      });
      return;
    }

    if (cfg.automationStarted) {
      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(mazeRestartCustomId("y", serverId))
          .setLabel("Yes, force next lobby now")
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(mazeRestartCustomId("n", serverId))
          .setLabel("No")
          .setStyle(ButtonStyle.Secondary)
      );
      await interaction.reply({
        embeds: [
          baseEmbed()
            .setTitle("Maze automation already enabled")
            .setDescription(
              "Do you want to **reset the schedule** and open the next automatic lobby **as soon as possible**?"
            ),
        ],
        components: [row],
        ephemeral: true,
      });
      return;
    }

    const started = await startMazeAutomation(pool, guildRowId, serverId);
    if (!started.ok) {
      await interaction.reply({ content: started.error ?? "Could not start.", ephemeral: true });
      return;
    }

    await interaction.reply({
      embeds: [
        baseEmbed()
          .setTitle("Maze automation started")
          .setDescription(
            "The bot will open lobbies on your **how often** schedule. Each lobby waits up to **15 minutes** (or until all spawn slots fill). " +
              "If nobody joins before time is up, the lobby is **cancelled** and the next run is scheduled."
          ),
      ],
      ephemeral: true,
    });
  },
};
