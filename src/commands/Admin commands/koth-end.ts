import { type ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";
import { memberHasAdminRole } from "../../admin/guildAdmin.js";
import { ADMIN_ROLE_NAME } from "../../constants.js";
import { getOrCreateGuildRow } from "../../db/guilds.js";
import { pool } from "../../db/pool.js";
import { getActiveKothEvent } from "../../db/koth.js";
import { baseEmbed } from "../../embeds/standard.js";
import { performKothEnd } from "../../koth/kothEndActions.js";
import { autocompleteServerOption, validateServerSelection } from "../shared/serverOption.js";

export const kothEndCommand = {
  data: new SlashCommandBuilder()
    .setName("koth-end")
    .setDescription("End any active KOTH (lobby or running) for a Rust server (admin only).")
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
    const active = await getActiveKothEvent(pool, guildRowId, serverId);
    if (!active) {
      await interaction.editReply({
        embeds: [baseEmbed().setTitle("No active KOTH").setDescription("There is no lobby or running KOTH for this server.")],
      });
      return;
    }

    const result = await performKothEnd(pool, guildRowId, serverId);
    if (!result.ok) {
      await interaction.editReply({ embeds: [baseEmbed().setTitle("Error").setDescription(result.error)] });
      return;
    }

    await interaction.editReply({
      embeds: [
        baseEmbed()
          .setTitle("KOTH ended")
          .setDescription(
            [
              `**Server ID:** ${serverId}`,
              `**Event:** ${active.status}`,
              result.stoppedRunner ? "**Runner:** stopped" : "**Runner:** not running (or on another process)",
              "",
              "KOTH config was cleared. Run **/koth-setup** again before the next event. Gate positions are kept.",
            ].join("\n")
          ),
      ],
    });
  },
};

