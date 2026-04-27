import {
  type ChatInputCommandInteraction,
  MessageFlags,
  SlashCommandBuilder,
} from "discord.js";
import type { TextChannel } from "discord.js";
import { memberHasAdminRole } from "../../admin/guildAdmin.js";
import { ADMIN_ROLE_NAME } from "../../constants.js";
import { baseEmbed } from "../../embeds/standard.js";
import { getOrCreateGuildRow } from "../../db/guilds.js";
import { pool } from "../../db/pool.js";
import { listRustServersForGuild } from "../../db/rustServers.js";
import { autocompleteServerOption, validateServerSelection } from "../shared/serverOption.js";
import { getActiveClansPanel } from "../../db/activeClansPanels.js";
import { syncActiveClansPanelInChannel } from "../../clans/activeClansPanel.js";

export const activeClansCommand = {
  data: new SlashCommandBuilder()
    .setName("active-clans")
    .setDescription("List all clans (name, tag, size) for this Discord — admin only.")
    .addStringOption((o) =>
      o
        .setName("server")
        .setDescription("Rust server name for the report title")
        .setRequired(true)
        .setAutocomplete(true)
    ),

  async autocomplete(interaction: import("discord.js").AutocompleteInteraction) {
    await autocompleteServerOption(interaction, "server");
  },

  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.inGuild() || !interaction.guild || !interaction.member) {
      await interaction.reply({ content: "This command can only be used inside a server.", flags: MessageFlags.Ephemeral });
      return;
    }
    if (!memberHasAdminRole(interaction.member, interaction.guild)) {
      await interaction.reply({
        content: `You need the **${ADMIN_ROLE_NAME}** role to use this command.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const serverId = Number.parseInt(interaction.options.getString("server", true), 10);
    if (!Number.isFinite(serverId) || !(await validateServerSelection(interaction.guild.id, serverId))) {
      await interaction.reply({
        embeds: [baseEmbed().setTitle("Invalid server").setDescription("Pick a Rust server from the list.")],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const guildRowId = await getOrCreateGuildRow(pool, interaction.guild.id);
    const servers = await listRustServersForGuild(pool, guildRowId);
    const srv = servers.find((s) => String(s.id) === String(serverId));
    if (!srv) {
      await interaction.editReply({
        embeds: [baseEmbed().setTitle("Server not found").setDescription("Could not resolve that Rust server.")],
      });
      return;
    }

    const existing = await getActiveClansPanel(pool, guildRowId, serverId).catch(() => null);
    const channelId = existing?.channelId ?? interaction.channelId;

    const ch = await interaction.guild.channels.fetch(channelId).catch(() => null);
    if (!ch?.isTextBased() || !("send" in ch)) {
      await interaction.editReply({
        content: "❌ Could not open the panel channel. Check the bot can see that channel.",
      });
      return;
    }

    const textCh = ch as TextChannel;
    const res = await syncActiveClansPanelInChannel({
      pool,
      guildRowId,
      guild: interaction.guild,
      rustServerId: serverId,
      channel: textCh,
      existing,
    });

    if (!res.ok) {
      await interaction.editReply({
        content: res.error ?? "❌ Could not update the active clans panel. Check bot permissions (Send Messages / Embed Links).",
      });
      return;
    }

    const extraNote = res.extraMessageIds.length ? ` (+${res.extraMessageIds.length} continuation message(s))` : "";
    await interaction.editReply({
      content: `✅ Active clans panel updated in <#${channelId}>.${extraNote}`,
    });
  },
};
