import { type ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";
import { baseEmbed } from "../../embeds/standard.js";
import { autocompleteServerOption, validateServerSelection } from "../shared/serverOption.js";
import { ensureClanSystemEnabled } from "../../clans/guard.js";
import { requireLinked } from "../../linking/guard.js";
import { pool } from "../../db/pool.js";
import { getMemberClan } from "../../db/clans.js";
import { listRustServersForGuild } from "../../db/rustServers.js";
import {
  getActiveNuketownEventMeta,
  getNuketownConfig,
  listNuketownParticipants,
  listNuketownTeams,
  removeNuketownEventMember,
  removeNuketownTeamIfEmpty,
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

export const nuketownLeaveCommand = {
  data: new SlashCommandBuilder()
    .setName("nuketown-leave")
    .setDescription("Leave the Nuketown lobby before the match starts.")
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
      await interaction.editReply({ embeds: [baseEmbed().setTitle("No clan").setDescription("You are not in a clan.")] });
      return;
    }

    const meta = await getActiveNuketownEventMeta(pool, guildRowId, serverId);
    if (!meta) {
      await interaction.editReply({ embeds: [baseEmbed().setTitle("No event").setDescription("There is no active Nuketown lobby or match for this server.")] });
      return;
    }
    if (meta.status !== "lobby") {
      await interaction.editReply({ embeds: [baseEmbed().setTitle("Match in progress").setDescription("You can only leave during the **lobby** (before it starts).")] });
      return;
    }

    const removed = await removeNuketownEventMember(pool, meta.id, interaction.user.id);
    if (!removed) {
      await interaction.editReply({ embeds: [baseEmbed().setTitle("Not joined").setDescription("You are not joined in this Nuketown lobby.")] });
      return;
    }

    await removeNuketownTeamIfEmpty(pool, meta.id, clan.clanId);

    const servers = await listRustServersForGuild(pool, guildRowId);
    const srv = servers.find((s) => String(s.id) === String(serverId));
    const serverName = srv?.nickname ?? "Server";

    const teams = await listNuketownTeams(pool, meta.id);
    const participants = await listNuketownParticipants(pool, guildRowId, meta.id);
    const views = buildTeamViews(teams, participants);

    await updateNuketownMessage(
      interaction.client,
      cfg.announcementChannelId,
      cfg.messageId,
      serverName,
      serverName,
      views,
      meta.lobbyEndsAtMs,
      cfg.teamLimit,
      null,
      meta.id
    );

    await interaction.editReply({ embeds: [baseEmbed().setTitle("Left").setDescription(`You left **Nuketown** on **${serverName}**.`)] });
  },
};

