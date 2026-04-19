import { type ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";
import { memberHasAdminRole } from "../../admin/guildAdmin.js";
import { ADMIN_ROLE_NAME } from "../../constants.js";
import { getOrCreateGuildRow } from "../../db/guilds.js";
import { pool } from "../../db/pool.js";
import {
  buildDockedCargoSetupComponents,
  buildDockedCargoSetupEmbed,
} from "../../dockedCargo/interactions.js";
import { autocompleteServerOption, validateServerSelection } from "../shared/serverOption.js";

export const dockedCargoSetupCommand = {
  data: new SlashCommandBuilder()
    .setName("docked-cargo-setup")
    .setDescription("Configure Docked Cargo auto event (admin).")
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

    const serverId = Number.parseInt(interaction.options.getString("server", true), 10);
    if (!Number.isFinite(serverId) || !(await validateServerSelection(interaction.guild.id, serverId))) {
      await interaction.reply({ content: "Pick a valid server from autocomplete.", ephemeral: true });
      return;
    }

    await getOrCreateGuildRow(pool, interaction.guild.id);

    await interaction.reply({
      embeds: [buildDockedCargoSetupEmbed(false)],
      components: buildDockedCargoSetupComponents(serverId),
    });
  },
};
