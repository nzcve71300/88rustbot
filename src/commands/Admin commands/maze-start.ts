import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type ChatInputCommandInteraction,
  SlashCommandBuilder,
} from "discord.js";
import { memberHasAdminRole } from "../../admin/guildAdmin.js";
import { ADMIN_ROLE_NAME } from "../../constants.js";
import { getActiveMazeEvent, getMazeConfig, isMazeAutomationConfigComplete, setMazeLobbyEndsInMinutes } from "../../db/maze.js";
import { getOrCreateGuildRow } from "../../db/guilds.js";
import { pool } from "../../db/pool.js";
import { startMazeAutomation, startMazeMatchFromLobby } from "../../maze/automation.js";
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
          .setLabel("Force start lobby / reset schedule")
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
              "If a Maze lobby is currently open, this will **force start** it immediately.\n" +
                "If no lobby is open, it will **reset the schedule** so the next automatic lobby opens as soon as possible."
            ),
        ],
        components: [row],
        ephemeral: true,
      });
      return;
    }

    // Automation is OFF: if a lobby is currently open, close it and start the match without enabling automation.
    const active = await getActiveMazeEvent(pool, guildRowId, serverId);
    if (active?.status === "lobby") {
      await interaction.deferReply({ ephemeral: true });
      try {
        await setMazeLobbyEndsInMinutes(pool, active.id, 0);
        const started = await startMazeMatchFromLobby(pool, interaction.client, guildRowId, serverId, active.id);
        if (!started) {
          await interaction.editReply({
            embeds: [baseEmbed().setTitle("Could not start").setDescription("Failed to start the Maze from the lobby. Check RCON/config and try again.")],
          });
          return;
        }
        await interaction.editReply({
          embeds: [
            baseEmbed()
              .setTitle("Maze started")
              .setDescription("Lobby closed — the Maze match is starting now. (Automation remains **OFF**.)"),
          ],
        });
      } catch (e) {
        console.error("[maze-start] failed to start from lobby:", e);
        await interaction.editReply({
          embeds: [baseEmbed().setTitle("Error").setDescription("Something went wrong starting the Maze. Check bot logs.")],
        });
      }
      return;
    }

    await interaction.reply({
      embeds: [
        baseEmbed()
          .setTitle("Automation is off")
          .setDescription(
            "Maze automation is currently **OFF**. If you want automatic lobbies, enable automation on the website.\n\n" +
              "If a lobby is open, re-run **/maze-start** to close the lobby and start the match."
          ),
      ],
      ephemeral: true,
    });
  },
};
