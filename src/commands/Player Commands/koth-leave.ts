import { type ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";
import { baseEmbed } from "../../embeds/standard.js";
import { autocompleteServerOption, validateServerSelection } from "../shared/serverOption.js";
import { ensureClanSystemEnabled } from "../../clans/guard.js";
import { requireLinked } from "../../linking/guard.js";
import { pool } from "../../db/pool.js";
import { getMemberClan } from "../../db/clans.js";
import {
  getActiveKothEvent,
  getActiveKothEventMeta,
  getKothConfig,
  listGateViews,
  removeEventMember,
  removeGateIfEmpty,
} from "../../db/koth.js";
import { listRustServersForGuild } from "../../db/rustServers.js";
import { updateKothMessage } from "../../koth/announce.js";

export const kothLeaveCommand = {
  data: new SlashCommandBuilder()
    .setName("koth-leave")
    .setDescription("Leave the KOTH lobby before the match starts (not during a running match).")
    .addStringOption((o) =>
      o
        .setName("server")
        .setDescription("Rust server in this Discord")
        .setRequired(true)
        .setAutocomplete(true)
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
      await interaction.reply({ embeds: [baseEmbed().setTitle("Invalid server").setDescription("Pick a server from autocomplete.")], ephemeral: true });
      return;
    }

    const linked = await requireLinked(interaction);
    if (!linked.ok) return;

    await interaction.deferReply({ ephemeral: true });

    const clanGuard = await ensureClanSystemEnabled(interaction);
    if (!clanGuard.ok) return;
    const guildRowId = clanGuard.guildRowId;

    const config = await getKothConfig(pool, guildRowId, serverId);
    if (!config || !config.messageId) {
      await interaction.editReply({ embeds: [baseEmbed().setTitle("Not setup").setDescription("An admin must run `/koth-setup` first.")] });
      return;
    }

    const clan = await getMemberClan(pool, guildRowId, interaction.user.id);
    if (!clan) {
      await interaction.editReply({ embeds: [baseEmbed().setTitle("No clan").setDescription("You are not in a clan.")] });
      return;
    }

    const activeEv = await getActiveKothEvent(pool, guildRowId, serverId);
    if (!activeEv) {
      await interaction.editReply({
        embeds: [baseEmbed().setTitle("No KOTH event").setDescription("There is no active lobby or match for this server.")],
      });
      return;
    }
    if (activeEv.status !== "lobby") {
      await interaction.editReply({
        embeds: [
          baseEmbed()
            .setTitle("Match in progress")
            .setDescription(
              "You can only leave during the **lobby** (before **/koth-start**). Once the match has started, use an admin command such as **/koth-end** if the event must be stopped."
            ),
        ],
      });
      return;
    }
    const eventId = activeEv.id;
    const removed = await removeEventMember(pool, eventId, interaction.user.id);
    if (!removed) {
      await interaction.editReply({ embeds: [baseEmbed().setTitle("Not joined").setDescription("You are not joined in this KOTH event.")] });
      return;
    }

    await removeGateIfEmpty(pool, eventId, clan.clanId);

    const servers = await listRustServersForGuild(pool, guildRowId);
    const srv = servers.find((s) => String(s.id) === String(serverId));
    const serverName = srv?.nickname ?? "Server";
    const views = await listGateViews(pool, eventId);
    const meta = await getActiveKothEventMeta(pool, guildRowId, serverId);
    const countdownEndsAtMs =
      meta?.status === "lobby"
        ? meta.lobbyEndsAtMs ?? null
        : meta?.status === "running" && meta.waveStartedAtMs != null && meta.durationPerWaveMin != null
          ? meta.waveStartedAtMs + meta.durationPerWaveMin * 60_000
          : null;
    await updateKothMessage(
      interaction.client,
      config.announcementChannelId,
      config.messageId,
      serverName,
      serverName,
      views,
      meta?.id ?? eventId,
      countdownEndsAtMs
    );

    await interaction.editReply({ embeds: [baseEmbed().setTitle("Left").setDescription(`You left KOTH on **${serverName}**.`)] });
  },
};

