import { type ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";
import { baseEmbed } from "../../embeds/standard.js";
import { autocompleteServerOption, validateServerSelection } from "../shared/serverOption.js";
import { ensureClanSystemEnabled } from "../../clans/guard.js";
import { requireLinked } from "../../linking/guard.js";
import { pool } from "../../db/pool.js";
import { getMemberClan } from "../../db/clans.js";
import {
  addEventMember,
  ensureClanGateForEvent,
  ensureLobbyEventForJoin,
  getKothConfig,
  getActiveKothEventMeta,
  listGateViews,
} from "../../db/koth.js";
import {
  EVENT_JOIN_BLOCKED_MESSAGE,
  joinTargetConflictsWithExistingSlots,
  listActiveEventParticipationSlots,
} from "../../db/eventParticipation.js";
import { listRustServersForGuild } from "../../db/rustServers.js";
import { updateKothMessage } from "../../koth/announce.js";
import { applyKothLobbyActiveZoneIfConfigured } from "../../koth/lobbyEventZone.js";

export const kothJoinCommand = {
  data: new SlashCommandBuilder()
    .setName("koth-join")
    .setDescription("Join the King of the Hill event for a server.")
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

    // Must be linked for KOTH.
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
      await interaction.editReply({ embeds: [baseEmbed().setTitle("No clan").setDescription("You must be in a clan to join KOTH.")] });
      return;
    }

    const slots = await listActiveEventParticipationSlots(pool, guildRowId, interaction.user.id);
    if (joinTargetConflictsWithExistingSlots({ kind: "koth", rustServerId: serverId }, slots)) {
      await interaction.editReply({
        embeds: [baseEmbed().setTitle("Already in an event").setDescription(EVENT_JOIN_BLOCKED_MESSAGE)],
      });
      return;
    }

    const lobby = await ensureLobbyEventForJoin(pool, guildRowId, serverId);
    if (!lobby.ok) {
      await interaction.editReply({
        embeds: [baseEmbed().setTitle("KOTH in progress").setDescription("This server’s KOTH has already started. You can’t join mid-match.")],
      });
      return;
    }
    const eventId = lobby.eventId;

    // Main KOTH arena zone must be active for the whole lobby (website join + Discord join).
    try {
      await applyKothLobbyActiveZoneIfConfigured(pool, guildRowId, serverId);
    } catch (e) {
      console.error("[koth zones] failed to apply active on join:", e);
    }

    const gate = await ensureClanGateForEvent(pool, eventId, clan.clanId, config.gates);
    if (gate == null) {
      await interaction.editReply({ embeds: [baseEmbed().setTitle("Gates full").setDescription("All gates are taken.")] });
      return;
    }

    const res = await addEventMember(pool, eventId, clan.clanId, interaction.user.id, config.teamLimit);
    if (res === "team_full") {
      await interaction.editReply({
        embeds: [
          baseEmbed()
            .setTitle("Gate full")
            .setDescription(`Your clan already has **${config.teamLimit}** member(s) in this KOTH.`),
        ],
      });
      return;
    }
    if (res === "already_joined") {
      await interaction.editReply({ embeds: [baseEmbed().setTitle("Already joined").setDescription("You are already in this KOTH event.")] });
      return;
    }

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

    await interaction.editReply({ embeds: [baseEmbed().setTitle("Joined").setDescription(`You joined KOTH on **${serverName}** (Gate ${gate}).`)] });
  },
};

