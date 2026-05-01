import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type ChatInputCommandInteraction,
  SlashCommandBuilder,
} from "discord.js";
import { memberHasAdminRole } from "../../admin/guildAdmin.js";
import { ADMIN_ROLE_NAME } from "../../constants.js";
import { getActiveKothEvent, getKothConfig, isKothAutomationConfigComplete, setKothLobbyEndsInMinutes } from "../../db/koth.js";
import { getOrCreateGuildRow } from "../../db/guilds.js";
import { pool } from "../../db/pool.js";
import { startKothAutomation, startKothMatchFromLobby } from "../../koth/automation.js";
import { kothRestartCustomId } from "../../koth/startInteractions.js";
import { baseEmbed } from "../../embeds/standard.js";
import { autocompleteServerOption, validateServerSelection } from "../shared/serverOption.js";

export const kothStartCommand = {
  data: new SlashCommandBuilder()
    .setName("koth-start")
    .setDescription("Start automatic KOTH lobbies (run once; admin). Waves, duration, and kit come from /koth-setup.")
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
    const cfg = await getKothConfig(pool, guildRowId, serverId);
    if (!cfg || !cfg.messageId || !isKothAutomationConfigComplete(cfg)) {
      await interaction.reply({
        embeds: [
          baseEmbed()
            .setTitle("Setup incomplete")
            .setDescription(
              "Finish **/koth-setup** first (how often, waves, duration per wave, kit, channel, gates, frequency)."
            ),
        ],
        ephemeral: true,
      });
      return;
    }

    if (cfg.automationStarted) {
      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(kothRestartCustomId("y", serverId))
          .setLabel("Yes, force next lobby now")
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(kothRestartCustomId("n", serverId))
          .setLabel("No")
          .setStyle(ButtonStyle.Secondary)
      );
      await interaction.reply({
        embeds: [
          baseEmbed()
            .setTitle("KOTH automation already enabled")
            .setDescription(
              "Do you want to **reset the schedule** and open the next automatic lobby **as soon as possible**?"
            ),
        ],
        components: [row],
        ephemeral: true,
      });
      return;
    }

    // Automation is OFF: if a lobby is currently open, close it and start the match without enabling automation.
    const active = await getActiveKothEvent(pool, guildRowId, serverId);
    if (active?.status === "lobby") {
      await interaction.deferReply({ ephemeral: true });
      try {
        await setKothLobbyEndsInMinutes(pool, active.id, 0);
        const started = await startKothMatchFromLobby(pool, interaction.client, guildRowId, serverId, active.id);
        if (!started) {
          await interaction.editReply({
            embeds: [baseEmbed().setTitle("Could not start").setDescription("Failed to start KOTH from the lobby. Check RCON/config and try again.")],
          });
          return;
        }
        await interaction.editReply({
          embeds: [
            baseEmbed()
              .setTitle("KOTH started")
              .setDescription("Lobby closed — KOTH is starting now. (Automation remains **OFF**.)"),
          ],
        });
      } catch (e) {
        console.error("[koth-start] failed to start from lobby:", e);
        await interaction.editReply({
          embeds: [baseEmbed().setTitle("Error").setDescription("Something went wrong starting KOTH. Check bot logs.")],
        });
      }
      return;
    }

    await interaction.reply({
      embeds: [
        baseEmbed()
          .setTitle("Automation is off")
          .setDescription(
            "KOTH automation is currently **OFF**. If you want automatic lobbies, enable automation on the website.\n\n" +
              "If a lobby is open, re-run **/koth-start** to close the lobby and start the match."
          ),
      ],
      ephemeral: true,
    });
  },
};
