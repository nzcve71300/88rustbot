import { type ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";
import { baseEmbed } from "../../embeds/standard.js";
import { autocompleteServerOption, validateServerSelection } from "../shared/serverOption.js";
import { ensureClanSystemEnabled } from "../../clans/guard.js";
import { requireLinked } from "../../linking/guard.js";
import { pool } from "../../db/pool.js";
import { getMemberClan } from "../../db/clans.js";
import {
  EVENT_JOIN_BLOCKED_MESSAGE,
  joinTargetConflictsWithExistingSlots,
  listActiveEventParticipationSlots,
} from "../../db/eventParticipation.js";
import { listRustServersForGuild } from "../../db/rustServers.js";
import {
  addNuketownEventMember,
  assignNuketownTeamSlot,
  countNuketownTeams,
  ensureLobbyNuketownForJoin,
  getActiveNuketownEventMeta,
  getNuketownConfig,
  getNuketownTeamSlot,
  listNuketownParticipants,
  listNuketownTeams,
} from "../../db/nuketown.js";
import { updateNuketownMessage } from "../../nuketown/announce.js";

function buildTeamViews(teams: { slot: number; clanId: number }[], participants: { ingameName: string; clanId: number; clanName: string; clanTag: string }[]) {
  const meta = new Map<number, { clanName: string; clanTag: string }>();
  for (const p of participants) meta.set(p.clanId, { clanName: p.clanName, clanTag: p.clanTag });
  const byClan = new Map<number, string[]>();
  for (const p of participants) {
    const arr = byClan.get(p.clanId) ?? [];
    arr.push(p.ingameName);
    byClan.set(p.clanId, arr);
  }
  return teams
    .map((t) => ({
      slot: t.slot,
      clanTag: meta.get(t.clanId)?.clanTag ?? "",
      clanName: meta.get(t.clanId)?.clanName ?? "Clan",
      members: (byClan.get(t.clanId) ?? []).slice(0, 20),
    }))
    .sort((a, b) => a.slot - b.slot);
}

export const nuketownJoinCommand = {
  data: new SlashCommandBuilder()
    .setName("nuketown-join")
    .setDescription("Join the Nuketown event lobby for a server (clan + linked).")
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
      await interaction.reply({ embeds: [baseEmbed().setTitle("Invalid server").setDescription("Pick a server from autocomplete.")], ephemeral: true });
      return;
    }

    const linked = await requireLinked(interaction);
    if (!linked.ok) return;
    await interaction.deferReply({ ephemeral: true });

    const clanGuard = await ensureClanSystemEnabled(interaction);
    if (!clanGuard.ok) return;
    const guildRowId = clanGuard.guildRowId;

    const cfg = await getNuketownConfig(pool, guildRowId, serverId);
    if (!cfg || !cfg.messageId) {
      await interaction.editReply({ embeds: [baseEmbed().setTitle("Not setup").setDescription("An admin must run **/nuketown-setup** first.")] });
      return;
    }

    const clan = await getMemberClan(pool, guildRowId, interaction.user.id);
    if (!clan) {
      await interaction.editReply({ embeds: [baseEmbed().setTitle("No clan").setDescription("You must be in a clan to join Nuketown.")] });
      return;
    }

    const slots = await listActiveEventParticipationSlots(pool, guildRowId, interaction.user.id);
    if (joinTargetConflictsWithExistingSlots({ kind: "nuketown", rustServerId: serverId }, slots)) {
      await interaction.editReply({
        embeds: [baseEmbed().setTitle("Already in an event").setDescription(EVENT_JOIN_BLOCKED_MESSAGE)],
      });
      return;
    }

    const lobby = await ensureLobbyNuketownForJoin(pool, guildRowId, serverId, 5);
    if (!lobby.ok) {
      await interaction.editReply({ embeds: [baseEmbed().setTitle("In progress").setDescription("Nuketown has already started. You can’t join mid-event.")] });
      return;
    }
    const eventId = lobby.eventId;

    // Assign team slot (max 4 clans).
    let slot = await getNuketownTeamSlot(pool, eventId, clan.clanId);
    if (slot == null) {
      const currentTeams = await listNuketownTeams(pool, eventId);
      if (currentTeams.length >= 4) {
        await interaction.editReply({ embeds: [baseEmbed().setTitle("Teams full").setDescription("This Nuketown lobby already has **4 clans**.")] });
        return;
      }
      const used = new Set(currentTeams.map((t) => t.slot));
      let found: number | null = null;
      for (let i = 1; i <= 4; i++) {
        if (!used.has(i)) {
          found = i;
          break;
        }
      }
      if (found == null) {
        await interaction.editReply({ embeds: [baseEmbed().setTitle("Teams full").setDescription("All team slots are taken.")] });
        return;
      }
      await assignNuketownTeamSlot(pool, eventId, found, clan.clanId);
      slot = found;
    }

    const res = await addNuketownEventMember(pool, eventId, clan.clanId, interaction.user.id, cfg.teamLimit);
    if (res === "already_joined") {
      await interaction.editReply({ embeds: [baseEmbed().setTitle("Already joined").setDescription("You are already in this Nuketown lobby.")] });
      return;
    }
    if (res === "team_full") {
      await interaction.editReply({ embeds: [baseEmbed().setTitle("Team full").setDescription(`Your clan already has **${cfg.teamLimit}** member(s) in this event.`)] });
      return;
    }

    const servers = await listRustServersForGuild(pool, guildRowId);
    const srv = servers.find((s) => String(s.id) === String(serverId));
    const serverName = srv?.nickname ?? "Server";

    const teams = await listNuketownTeams(pool, eventId);
    const participants = await listNuketownParticipants(pool, guildRowId, eventId);
    const views = buildTeamViews(teams, participants);

    const meta = await getActiveNuketownEventMeta(pool, guildRowId, serverId);
    await updateNuketownMessage(
      interaction.client,
      cfg.announcementChannelId,
      cfg.messageId,
      serverName,
      serverName,
      views,
      meta?.lobbyEndsAtMs ?? null,
      cfg.teamLimit,
      meta?.id ?? eventId
    );

    await interaction.editReply({
      embeds: [baseEmbed().setTitle("Joined").setDescription(`You joined **Nuketown** on **${serverName}** (Team ${slot}).`)],
    });
  },
};

