import { type ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";
import { memberHasAdminRole } from "../../admin/guildAdmin.js";
import { ADMIN_ROLE_NAME } from "../../constants.js";
import { getOrCreateGuildRow } from "../../db/guilds.js";
import { pool } from "../../db/pool.js";
import {
  getActiveMazeEvent,
  getActiveMazeEventMeta,
  getMazeConfig,
  listMazeSpawnViews,
  removeMazeEventMember,
} from "../../db/maze.js";
import { baseEmbed } from "../../embeds/standard.js";
import { listRustServersForGuild } from "../../db/rustServers.js";
import { updateMazeMessage } from "../../maze/announce.js";
import { autocompleteServerOption, validateServerSelection } from "../shared/serverOption.js";

export const mazeKickCommand = {
  data: new SlashCommandBuilder()
    .setName("maze-kick")
    .setDescription("Remove a player from the Maze lobby before the event starts (admin only).")
    .addStringOption((o) =>
      o.setName("server").setDescription("Rust server").setRequired(true).setAutocomplete(true)
    )
    .addUserOption((o) => o.setName("user").setDescription("Discord user to remove from the lobby").setRequired(true)),

  async autocomplete(interaction: import("discord.js").AutocompleteInteraction) {
    await autocompleteServerOption(interaction, "server");
  },

  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.inGuild() || !interaction.guild || !interaction.member || !interaction.client) {
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
    const target = interaction.options.getUser("user", true);

    if (!Number.isFinite(serverId) || !(await validateServerSelection(interaction.guild.id, serverId))) {
      await interaction.reply({
        embeds: [baseEmbed().setTitle("Invalid server").setDescription("Pick a server from autocomplete.")],
        ephemeral: true,
      });
      return;
    }

    await interaction.deferReply({ ephemeral: true });

    const guildRowId = await getOrCreateGuildRow(pool, interaction.guild.id);

    const active = await getActiveMazeEvent(pool, guildRowId, serverId);
    if (!active || active.status !== "lobby") {
      await interaction.editReply({
        embeds: [
          baseEmbed()
            .setTitle("Lobby only")
            .setDescription(
              "You can only kick players while the Maze is in **lobby** (before **/maze-start**). If the match is running, use **/maze-delete** to stop the event."
            ),
        ],
      });
      return;
    }

    const config = await getMazeConfig(pool, guildRowId, serverId);
    if (!config || !config.messageId) {
      await interaction.editReply({
        embeds: [baseEmbed().setTitle("Not setup").setDescription("Run **/maze-setup** for this server first.")],
      });
      return;
    }

    const removed = await removeMazeEventMember(pool, active.id, target.id);
    if (!removed) {
      await interaction.editReply({
        embeds: [
          baseEmbed()
            .setTitle("Not in lobby")
            .setDescription(`${target} is not in this Maze lobby.`),
        ],
      });
      return;
    }

    const servers = await listRustServersForGuild(pool, guildRowId);
    const srv = servers.find((s) => String(s.id) === String(serverId));
    const serverName = srv?.nickname ?? "Server";
    const views = await listMazeSpawnViews(pool, guildRowId, active.id);
    const meta = await getActiveMazeEventMeta(pool, guildRowId, serverId);
    const durationMinutes = meta?.durationMinutes ?? null;
    const countdownEndsAtMs =
      meta?.startedAtMs != null && meta?.durationMinutes != null
        ? meta.startedAtMs + meta.durationMinutes * 60_000
        : null;
    await updateMazeMessage(
      interaction.client,
      config.announcementChannelId,
      config.messageId,
      serverName,
      serverName,
      views,
      durationMinutes,
      countdownEndsAtMs
    );

    await interaction.editReply({
      embeds: [
        baseEmbed()
          .setTitle("Player removed")
          .setDescription(`Removed ${target} from the Maze lobby on **${serverName}**.`),
      ],
    });
  },
};
