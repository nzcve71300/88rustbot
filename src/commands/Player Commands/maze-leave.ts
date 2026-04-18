import { type ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";
import { baseEmbed } from "../../embeds/standard.js";
import { autocompleteServerOption, validateServerSelection } from "../shared/serverOption.js";
import { ensureClanSystemEnabled } from "../../clans/guard.js";
import { requireLinked } from "../../linking/guard.js";
import { pool } from "../../db/pool.js";
import { getClanForEventParticipation } from "../../db/clans.js";
import {
  getActiveMazeEvent,
  getActiveMazeEventMeta,
  getMazeConfig,
  listMazeSpawnViews,
  removeMazeEventMember,
} from "../../db/maze.js";
import { listRustServersForGuild } from "../../db/rustServers.js";
import { updateMazeMessage } from "../../maze/announce.js";

export const mazeLeaveCommand = {
  data: new SlashCommandBuilder()
    .setName("maze-leave")
    .setDescription("Leave the Maze lobby before the event starts (not during a running match).")
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
        embeds: [baseEmbed().setTitle("No clan").setDescription("You are not eligible for this event roster.")],
      });
      return;
    }

    const activeEv = await getActiveMazeEvent(pool, guildRowId, serverId);
    if (!activeEv) {
      await interaction.editReply({
        embeds: [
          baseEmbed()
            .setTitle("No Maze event")
            .setDescription("There is no active lobby or match for this server."),
        ],
      });
      return;
    }
    if (activeEv.status !== "lobby") {
      await interaction.editReply({
        embeds: [
          baseEmbed()
            .setTitle("Event in progress")
            .setDescription(
              "You can only leave during the **lobby** (before **/maze-start**). Once the Maze has started, an admin can use **/maze-delete** to stop the event."
            ),
        ],
      });
      return;
    }

    const eventId = activeEv.id;
    const removed = await removeMazeEventMember(pool, eventId, interaction.user.id);
    if (!removed) {
      await interaction.editReply({
        embeds: [baseEmbed().setTitle("Not in lobby").setDescription("You are not in this Maze lobby.")],
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
      embeds: [baseEmbed().setTitle("Left Maze").setDescription(`You left the Maze lobby on **${serverName}**.`)],
    });
  },
};
