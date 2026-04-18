import { type ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";
import { baseEmbed } from "../../embeds/standard.js";
import { autocompleteServerOption, validateServerSelection } from "../shared/serverOption.js";
import { ensureClanSystemEnabled } from "../../clans/guard.js";
import { requireLinked } from "../../linking/guard.js";
import { pool } from "../../db/pool.js";
import { getClanForEventParticipation } from "../../db/clans.js";
import {
  EVENT_JOIN_BLOCKED_MESSAGE,
  joinTargetConflictsWithExistingSlots,
  listActiveEventParticipationSlots,
} from "../../db/eventParticipation.js";
import {
  addMazeEventMember,
  countMazeEventMembers,
  ensureLobbyMazeForJoin,
  findFreeMazeSpawn,
  getActiveMazeEventMeta,
  getMazeConfig,
  listMazeSpawnViews,
  MAZE_MAX_PLAYERS,
} from "../../db/maze.js";
import { listRustServersForGuild } from "../../db/rustServers.js";
import { updateMazeMessage } from "../../maze/announce.js";

export const mazeJoinCommand = {
  data: new SlashCommandBuilder()
    .setName("maze-join")
    .setDescription("Join the Maze Event lobby for a Rust server (clan + linked, max 10).")
    .addStringOption((o) =>
      o.setName("server").setDescription("Rust server in this Discord").setRequired(true).setAutocomplete(true)
    ),

  async autocomplete(interaction: import("discord.js").AutocompleteInteraction) {
    await autocompleteServerOption(interaction, "server");
  },

  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.inGuild() || !interaction.guildId || !interaction.client) {
      await interaction.reply({ content: "This command can only be used inside a server.", ephemeral: true });
      return;
    }
    const serverId = Number.parseInt(interaction.options.getString("server", true), 10);
    if (!Number.isFinite(serverId) || !(await validateServerSelection(interaction.guildId, serverId))) {
      await interaction.reply({
        embeds: [baseEmbed().setTitle("Invalid server").setDescription("Pick a server from autocomplete.")],
        ephemeral: true,
      });
      return;
    }

    const linked = await requireLinked(interaction);
    if (!linked.ok) return;

    await interaction.deferReply({ ephemeral: true });

    const clanGuard = await ensureClanSystemEnabled(interaction);
    if (!clanGuard.ok) return;
    const guildRowId = clanGuard.guildRowId;

    const config = await getMazeConfig(pool, guildRowId, serverId);
    if (!config || !config.messageId) {
      await interaction.editReply({
        embeds: [baseEmbed().setTitle("Not setup").setDescription("An admin must run **/maze-setup** first.")],
      });
      return;
    }

    const clan = await getClanForEventParticipation(pool, guildRowId, interaction.user.id);
    if (!clan) {
      await interaction.editReply({
        embeds: [
          baseEmbed()
            .setTitle("Clan required")
            .setDescription("You must be in a clan **or** be the clan owner to join the Maze event."),
        ],
      });
      return;
    }

    const slots = await listActiveEventParticipationSlots(pool, guildRowId, interaction.user.id);
    if (joinTargetConflictsWithExistingSlots({ kind: "maze", rustServerId: serverId }, slots)) {
      await interaction.editReply({
        embeds: [baseEmbed().setTitle("Already in an event").setDescription(EVENT_JOIN_BLOCKED_MESSAGE)],
      });
      return;
    }

    const lobby = await ensureLobbyMazeForJoin(pool, guildRowId, serverId);
    if (!lobby.ok) {
      await interaction.editReply({
        embeds: [
          baseEmbed()
            .setTitle("Maze in progress")
            .setDescription("This server’s Maze has already started. You can’t join mid-event."),
        ],
      });
      return;
    }
    const eventId = lobby.eventId;

    const cap = Math.min(config.spawnPoints, MAZE_MAX_PLAYERS);
    const current = await countMazeEventMembers(pool, eventId);
    if (current >= cap) {
      await interaction.editReply({
        embeds: [
          baseEmbed()
            .setTitle("Lobby full")
            .setDescription(`This Maze lobby is full (**${cap}** slot(s) for this server).`),
        ],
      });
      return;
    }

    const spawn = await findFreeMazeSpawn(pool, eventId, cap);
    if (spawn == null) {
      await interaction.editReply({
        embeds: [baseEmbed().setTitle("No free spawn").setDescription("All spawn slots are taken.")],
      });
      return;
    }

    const res = await addMazeEventMember(pool, eventId, clan.clanId, interaction.user.id, spawn);
    if (res === "already_joined") {
      await interaction.editReply({
        embeds: [baseEmbed().setTitle("Already joined").setDescription("You are already in this Maze lobby.")],
      });
      return;
    }

    const servers = await listRustServersForGuild(pool, guildRowId);
    const srv = servers.find((s) => String(s.id) === String(serverId));
    const serverName = srv?.nickname ?? "Server";
    const views = await listMazeSpawnViews(pool, guildRowId, eventId);
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
          .setTitle("Joined Maze")
          .setDescription(`You joined the Maze lobby on **${serverName}** (spawn **${spawn}**).`),
      ],
    });
  },
};
