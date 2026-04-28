import { type ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";
import { baseEmbed } from "../../embeds/standard.js";
import { pool } from "../../db/pool.js";
import { getMemberClan, removeClanMember } from "../../db/clans.js";
import { autocompleteServerOption, validateServerSelection } from "../shared/serverOption.js";
import { ensureClanSystemEnabled } from "../../clans/guard.js";
import { refreshActiveClansPanelsForGuild } from "../../clans/activeClansPanel.js";
import { syncLinkedNicknameForUser } from "../../clans/nicknames.js";

export const clanKickCommand = {
  data: new SlashCommandBuilder()
    .setName("clan-kick")
    .setDescription("Kick a member from your clan (owner only).")
    .addStringOption((o) =>
      o
        .setName("server")
        .setDescription("Select a configured Rust server in this Discord (validation only).")
        .setRequired(true)
        .setAutocomplete(true)
    )
    .addUserOption((o) => o.setName("user").setDescription("User to kick.").setRequired(true)),

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

    const target = interaction.options.getUser("user", true);
    if (target.id === interaction.user.id) {
      await interaction.reply({
        embeds: [baseEmbed().setTitle("Can't kick").setDescription("You can’t kick yourself.")],
        ephemeral: true,
      });
      return;
    }

    await interaction.deferReply({ ephemeral: true });

    const guard = await ensureClanSystemEnabled(interaction);
    if (!guard.ok) return;
    const guildRowId = guard.guildRowId;
    const myClan = await getMemberClan(pool, guildRowId, interaction.user.id);
    if (!myClan) {
      await interaction.editReply({ embeds: [baseEmbed().setTitle("No clan").setDescription("You aren’t in a clan.")] });
      return;
    }
    if (!myClan.ownerDiscordUserId || String(myClan.ownerDiscordUserId) !== interaction.user.id) {
      await interaction.editReply({
        embeds: [baseEmbed().setTitle("Not allowed").setDescription("Only the clan owner can kick members.")],
      });
      return;
    }

    const targetClan = await getMemberClan(pool, guildRowId, target.id);
    if (!targetClan || targetClan.clanId !== myClan.clanId) {
      await interaction.editReply({
        embeds: [baseEmbed().setTitle("Not in clan").setDescription("That user must be in your clan.")],
      });
      return;
    }
    if (String(myClan.ownerDiscordUserId) === target.id) {
      await interaction.editReply({
        embeds: [baseEmbed().setTitle("Can't kick").setDescription("You can’t kick the clan owner.")],
      });
      return;
    }

    const removed = await removeClanMember(pool, myClan.clanId, target.id);
    if (!removed) {
      await interaction.editReply({
        embeds: [baseEmbed().setTitle("Not in clan").setDescription("That user is not a member of your clan.")],
      });
      return;
    }
    if (interaction.guild && myClan.discordRoleId) {
      try {
        const member = await interaction.guild.members.fetch(target.id);
        await member.roles.remove(myClan.discordRoleId, "Clan kick");
      } catch {
        /* ignore */
      }
    }

    await interaction.editReply({
      embeds: [
        baseEmbed()
          .setTitle("Member kicked")
          .setDescription(`**${target.username}** was kicked from **${myClan.clanName}**.`),
      ],
    });

    // Best-effort: remove clan tag from kicked member's nickname.
    if (interaction.guild) {
      await syncLinkedNicknameForUser({
        pool,
        guildRowId,
        guild: interaction.guild,
        discordUserId: target.id,
      }).catch(() => {});
    }

    // Best-effort: update tracked /active-clans message(s).
    await refreshActiveClansPanelsForGuild(interaction.client, interaction.guildId).catch(() => {});
  },
};

