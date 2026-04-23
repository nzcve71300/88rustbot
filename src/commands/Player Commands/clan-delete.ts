import { type ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";
import { baseEmbed } from "../../embeds/standard.js";
import { pool } from "../../db/pool.js";
import { deleteClan, getMemberClan } from "../../db/clans.js";
import { autocompleteServerOption, validateServerSelection } from "../shared/serverOption.js";
import { ensureClanSystemEnabled } from "../../clans/guard.js";
import { refreshActiveClansPanelsForGuild } from "../../clans/activeClansPanel.js";

export const clanDeleteCommand = {
  data: new SlashCommandBuilder()
    .setName("clan-delete")
    .setDescription("Delete your clan (owner only).")
    .addStringOption((o) =>
      o
        .setName("server")
        .setDescription("Select a configured Rust server in this Discord (validation only).")
        .setRequired(true)
        .setAutocomplete(true)
    ),

  async autocomplete(interaction: import("discord.js").AutocompleteInteraction) {
    await autocompleteServerOption(interaction, "server");
  },

  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.inGuild() || !interaction.guildId) {
      await interaction.reply({ content: "This command can only be used inside a server.", ephemeral: true });
      return;
    }

    const serverId = Number.parseInt(interaction.options.getString("server", true), 10);
    if (!Number.isFinite(serverId) || serverId < 1 || !(await validateServerSelection(interaction.guildId, serverId))) {
      await interaction.reply({
        embeds: [baseEmbed().setTitle("Invalid server").setDescription("Pick a server from autocomplete.")],
        ephemeral: true,
      });
      return;
    }

    await interaction.deferReply({ ephemeral: true });

    const guard = await ensureClanSystemEnabled(interaction);
    if (!guard.ok) return;
    const guildRowId = guard.guildRowId;
    const clan = await getMemberClan(pool, guildRowId, interaction.user.id);
    if (!clan) {
      await interaction.editReply({
        embeds: [baseEmbed().setTitle("No clan").setDescription("You aren’t in a clan.")],
      });
      return;
    }

    if (!clan.ownerDiscordUserId || String(clan.ownerDiscordUserId) !== interaction.user.id) {
      await interaction.editReply({
        embeds: [baseEmbed().setTitle("Not allowed").setDescription("Only the clan owner can delete the clan.")],
      });
      return;
    }

    await deleteClan(pool, guildRowId, clan.clanId);
    if (interaction.guild) {
      if (clan.discordChannelId) {
        try {
          const ch = await interaction.guild.channels.fetch(clan.discordChannelId);
          await ch?.delete("Clan deleted");
        } catch {
          /* ignore */
        }
      }
      if (clan.discordRoleId) {
        try {
          const role = await interaction.guild.roles.fetch(clan.discordRoleId);
          await role?.delete("Clan deleted");
        } catch {
          /* ignore */
        }
      }
    }

    await interaction.editReply({
      embeds: [baseEmbed().setTitle("Clan deleted").setDescription(`**${clan.clanName}** was deleted successfully.`)],
    });

    // Best-effort: update tracked /active-clans message(s).
    await refreshActiveClansPanelsForGuild(interaction.client, interaction.guildId).catch(() => {});
  },
};

