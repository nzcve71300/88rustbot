import {
  ChannelType,
  type ChatInputCommandInteraction,
  SlashCommandBuilder,
  TextChannel,
} from "discord.js";
import { memberHasAdminRole } from "../../admin/guildAdmin.js";
import { ADMIN_ROLE_NAME } from "../../constants.js";
import { getOrCreateGuildRow } from "../../db/guilds.js";
import { pool } from "../../db/pool.js";
import { listRustServersForGuild } from "../../db/rustServers.js";
import { baseEmbed } from "../../embeds/standard.js";
import { autocompleteServerOption, validateServerSelection } from "../shared/serverOption.js";
import { getTopClansForServerLeaderboard } from "../../db/clanLeaderboard.js";
import { formatKdRatio } from "../../stats/kdRatio.js";

function fmtClanName(name: string, tag: string | null): string {
  const t = tag?.trim();
  return t ? `[${t}] ${name}` : name;
}

export const leaderboardCommand = {
  data: new SlashCommandBuilder()
    .setName("leaderboard")
    .setDescription("Post the top 10 clan leaderboard for a Rust server (admin only).")
    .addStringOption((o) =>
      o.setName("server").setDescription("Rust server in this Discord").setRequired(true).setAutocomplete(true)
    )
    .addChannelOption((o) =>
      o
        .setName("channel")
        .setDescription("Channel to post the leaderboard embed")
        .setRequired(true)
        .addChannelTypes(ChannelType.GuildText)
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
    const channel = interaction.options.getChannel("channel", true);

    if (!Number.isFinite(serverId) || !(await validateServerSelection(interaction.guild.id, serverId))) {
      await interaction.reply({
        embeds: [baseEmbed().setTitle("Invalid server").setDescription("Pick a server from autocomplete.")],
        ephemeral: true,
      });
      return;
    }

    if (!(channel instanceof TextChannel)) {
      await interaction.reply({
        embeds: [baseEmbed().setTitle("Invalid channel").setDescription("Choose a text channel.")],
        ephemeral: true,
      });
      return;
    }

    await interaction.deferReply({ ephemeral: true });

    const guildRowId = await getOrCreateGuildRow(pool, interaction.guild.id);
    const servers = await listRustServersForGuild(pool, guildRowId);
    const srv = servers.find((s) => String(s.id) === String(serverId));
    if (!srv) {
      await interaction.editReply({ embeds: [baseEmbed().setTitle("Server not found").setDescription("Could not resolve this server.")] });
      return;
    }

    const top = await getTopClansForServerLeaderboard(pool, guildRowId, serverId, 10);

    const description =
      top.length === 0
        ? "_No clan stats recorded for this server yet. Stats build from the killfeed when linked players get kills/deaths._"
        : top
            .map((row, i) => {
              const kd = formatKdRatio(row.kills, row.deaths);
              const label = fmtClanName(row.clanName, row.clanTag);
              return (
                `**${i + 1}.** ${label}\n` +
                `└ Kills: **${row.kills}** · Deaths: **${row.deaths}** · KD: **${kd}**\n` +
                `└ Total clan members: **${row.memberCount}**`
              );
            })
            .join("\n\n");

    const embed = baseEmbed()
      .setTitle(`🏆 Top clans — ${srv.nickname}`)
      .setDescription(description);

    try {
      await channel.send({ embeds: [embed] });
    } catch {
      await interaction.editReply({
        embeds: [
          baseEmbed()
            .setTitle("Could not send")
            .setDescription("I couldn’t post in that channel. Check **Send Messages** and **Embed Links** permissions."),
        ],
      });
      return;
    }

    await interaction.editReply({
      embeds: [baseEmbed().setTitle("Posted").setDescription(`Leaderboard sent to ${channel}.`)],
    });
  },
};
