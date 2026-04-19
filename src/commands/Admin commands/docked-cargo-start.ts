import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type ChatInputCommandInteraction,
  SlashCommandBuilder,
} from "discord.js";
import { memberHasAdminRole } from "../../admin/guildAdmin.js";
import { ADMIN_ROLE_NAME } from "../../constants.js";
import { getDockedCargoConfig, isDockedCargoConfigComplete, mergeDockedCargoConfig } from "../../db/dockedCargo.js";
import { getOrCreateGuildRow } from "../../db/guilds.js";
import { pool } from "../../db/pool.js";
import { isDockedCargoLoopRunning, startDockedCargoAutomation } from "../../dockedCargo/runner.js";
import { baseEmbed } from "../../embeds/standard.js";
import { autocompleteServerOption, validateServerSelection } from "../shared/serverOption.js";

export const dockedCargoStartCommand = {
  data: new SlashCommandBuilder()
    .setName("docked-cargo-start")
    .setDescription("Start Docked Cargo automation (run once; admin).")
    .addStringOption((o) =>
      o.setName("server").setDescription("Rust server").setRequired(true).setAutocomplete(true)
    ),

  async autocomplete(interaction: import("discord.js").AutocompleteInteraction) {
    await autocompleteServerOption(interaction, "server");
  },

  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.inGuild() || !interaction.guild || !interaction.member) {
      await interaction.reply({ content: "Use this command in a server.", ephemeral: true });
      return;
    }
    if (!memberHasAdminRole(interaction.member, interaction.guild)) {
      await interaction.reply({
        content: `You need the **${ADMIN_ROLE_NAME}** role.`,
        ephemeral: true,
      });
      return;
    }

    const rustServerId = Number.parseInt(interaction.options.getString("server", true), 10);
    if (!Number.isFinite(rustServerId) || !(await validateServerSelection(interaction.guild.id, rustServerId))) {
      await interaction.reply({ content: "Pick a valid server from autocomplete.", ephemeral: true });
      return;
    }

    const guildRowId = await getOrCreateGuildRow(pool, interaction.guild.id);
    const cfg = await getDockedCargoConfig(pool, guildRowId, rustServerId);
    if (!cfg || !isDockedCargoConfigComplete(cfg)) {
      await interaction.reply({
        embeds: [
          baseEmbed()
            .setTitle("Setup incomplete")
            .setDescription("Finish **/docked-cargo-setup** first (all fields + announcement channel)."),
        ],
        ephemeral: true,
      });
      return;
    }

    if (cfg.automationStarted && isDockedCargoLoopRunning(rustServerId)) {
      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`dc:rs:y:${rustServerId}`)
          .setLabel("Yes")
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(`dc:rs:n:${rustServerId}`)
          .setLabel("No")
          .setStyle(ButtonStyle.Secondary)
      );
      await interaction.reply({
        embeds: [
          baseEmbed()
            .setTitle("Docked Cargo already started")
            .setDescription(
              "You already ran **/docked-cargo-start** once. Would you like to **reset** the How Often timer and **force start** the event now?"
            ),
        ],
        components: [row],
        ephemeral: true,
      });
      return;
    }

    const started = startDockedCargoAutomation(pool, guildRowId, rustServerId, interaction.client);
    if (!started.ok) {
      await interaction.reply({ content: started.error ?? "Could not start.", ephemeral: true });
      return;
    }
    await mergeDockedCargoConfig(pool, guildRowId, rustServerId, { automationStarted: true });
    await interaction.reply({
      embeds: [baseEmbed().setTitle("Docked Cargo started").setDescription("Automation is running.")],
      ephemeral: true,
    });
  },
};
