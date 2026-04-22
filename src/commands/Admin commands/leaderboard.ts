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
import { renderClanLeaderboardPng } from "../../leaderboard/renderLeaderboardImage.js";
import { autocompleteServerOption, validateServerSelection } from "../shared/serverOption.js";
import { getTopClansForServerLeaderboard } from "../../db/clanLeaderboard.js";

export const leaderboardCommand = {
  data: new SlashCommandBuilder()
    .setName("leaderboard")
    .setDescription("Post the top 10 clan leaderboard image for a Rust server (admin only).")
    .addStringOption((o) =>
      o.setName("server").setDescription("Rust server in this Discord").setRequired(true).setAutocomplete(true)
    )
    .addChannelOption((o) =>
      o
        .setName("channel")
        .setDescription("Channel to post the leaderboard image")
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

    let png: Buffer;
    try {
      png = await renderClanLeaderboardPng(srv.nickname, top);
    } catch (err) {
      console.error("[leaderboard] render failed:", err);
      await interaction.editReply({
        embeds: [baseEmbed().setTitle("Render failed").setDescription("Could not generate the leaderboard image. Check bot logs.")],
      });
      return;
    }

    const safeName = srv.nickname.replace(/[^\w\-]+/g, "_").slice(0, 40) || "server";
    const filename = `leaderboard-${safeName}.png`;

    try {
      await channel.send({
        files: [{ attachment: png, name: filename }],
      });
    } catch {
      await interaction.editReply({
        embeds: [
          baseEmbed()
            .setTitle("Could not send")
            .setDescription(
              "I couldn’t post in that channel. The bot needs **Send Messages**, **Attach Files**, and **Embed Links** (if link previews are used)."
            ),
        ],
      });
      return;
    }

    await interaction.editReply({
      content: `Posted leaderboard image to ${channel}.`,
    });
  },
};
