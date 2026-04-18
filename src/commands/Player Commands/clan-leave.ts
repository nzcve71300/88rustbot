import { type ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";
import { baseEmbed } from "../../embeds/standard.js";
import { pool } from "../../db/pool.js";
import { getMemberClan, removeClanMember } from "../../db/clans.js";
import { autocompleteServerOption, validateServerSelection } from "../shared/serverOption.js";
import { ensureClanSystemEnabled } from "../../clans/guard.js";

export const clanLeaveCommand = {
  data: new SlashCommandBuilder()
    .setName("clan-leave")
    .setDescription("Leave your current clan.")
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
      await interaction.reply({ content: "This command can only be used inside a server." });
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

    await interaction.deferReply();

    const guard = await ensureClanSystemEnabled(interaction);
    if (!guard.ok) return;
    const guildRowId = guard.guildRowId;
    const clan = await getMemberClan(pool, guildRowId, interaction.user.id);
    if (!clan) {
      await interaction.editReply({
        embeds: [baseEmbed().setTitle("No clan").setDescription("You can’t leave a clan because you aren’t in a clan.")],
      });
      return;
    }

    if (clan.ownerDiscordUserId && String(clan.ownerDiscordUserId) === interaction.user.id) {
      await interaction.editReply({
        embeds: [
          baseEmbed()
            .setTitle("Owner can't leave")
            .setDescription("You are the clan owner. Promote someone else or delete the clan."),
        ],
      });
      return;
    }

    await removeClanMember(pool, clan.clanId, interaction.user.id);
    if (interaction.guild && clan.discordRoleId) {
      try {
        const member = await interaction.guild.members.fetch(interaction.user.id);
        await member.roles.remove(clan.discordRoleId, "Clan leave");
      } catch {
        /* ignore */
      }
    }

    await interaction.editReply({
      embeds: [baseEmbed().setTitle("Left clan").setDescription(`You left **${clan.clanName}** successfully.`)],
    });
  },
};

