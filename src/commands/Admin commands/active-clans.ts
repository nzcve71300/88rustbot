import { EmbedBuilder, type ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";
import { memberHasAdminRole } from "../../admin/guildAdmin.js";
import { ADMIN_ROLE_NAME } from "../../constants.js";
import { baseEmbed } from "../../embeds/standard.js";
import { listGuildClansWithMemberCounts } from "../../db/clans.js";
import { getOrCreateGuildRow } from "../../db/guilds.js";
import { pool } from "../../db/pool.js";
import { listRustServersForGuild } from "../../db/rustServers.js";
import { autocompleteServerOption, validateServerSelection } from "../shared/serverOption.js";
import { getActiveClansPanel, upsertActiveClansPanel } from "../../db/activeClansPanels.js";

const FIELD_VALUE_MAX = 1020;
/** Avoid Discord’s 25-fields-per-embed limit; spill into continuation embeds */
const MAX_FIELDS_PER_EMBED = 20;

function chunkLines(lines: string[], maxLen: number): string[][] {
  const chunks: string[][] = [];
  let cur: string[] = [];
  let len = 0;
  for (const line of lines) {
    const add = line.length + (cur.length ? 1 : 0);
    if (cur.length && len + add > maxLen) {
      chunks.push(cur);
      cur = [line];
      len = line.length;
    } else {
      cur.push(line);
      len += add;
    }
  }
  if (cur.length) chunks.push(cur);
  return chunks.length ? chunks : [[]];
}

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
    if (!Number.isFinite(serverId) || !(await validateServerSelection(interaction.guild.id, serverId))) {
      await interaction.reply({
        embeds: [baseEmbed().setTitle("Invalid server").setDescription("Pick a Rust server from the list.")],
        ephemeral: true,
      });
      return;
    }

    await interaction.deferReply({ ephemeral: true });

    const guildRowId = await getOrCreateGuildRow(pool, interaction.guild.id);
    const servers = await listRustServersForGuild(pool, guildRowId);
    const srv = servers.find((s) => String(s.id) === String(serverId));
    if (!srv) {
      await interaction.editReply({
        embeds: [baseEmbed().setTitle("Server not found").setDescription("Could not resolve that Rust server.")],
      });
      return;
    }

    const clans = await listGuildClansWithMemberCounts(pool, guildRowId);
    const totalClans = clans.length;
    const totalMembers = clans.reduce((s, c) => s + c.memberCount, 0);

    const title = `ACTIVE CLANS ON ${srv.nickname}`.slice(0, 256);
    const icon = interaction.guild.iconURL({ size: 128 });

    const embed = baseEmbed()
      .setAuthor({
        name: interaction.guild.name,
        iconURL: icon ?? undefined,
      })
      .setTitle(title)
      .setDescription(
        [
          `**Total Clans:** **${totalClans}**`,
          `**Total Clan Members:** **${totalMembers}**`,
          "",
          "_Every clan registered in this Discord is listed below._",
        ].join("\n")
      )
      .setTimestamp(new Date());

    if (totalClans === 0) {
      embed.addFields({
        name: "Clans",
        value: "*No clans have been created yet.*",
        inline: false,
      });
      await interaction.editReply({ embeds: [embed] });
      return;
    }

    const lines = clans.map((c) => {
      const rid = c.discordRoleId?.trim() ? `<@&${c.discordRoleId.trim()}>` : "`(role missing)`";
      const tagRaw = (c.clanTag?.trim() || "—").slice(0, 8);
      const tagPart = `[**${tagRaw}**]`;
      const membersWord = c.memberCount === 1 ? "member" : "members";
      return `${rid} ${tagPart} - ${c.memberCount} ${membersWord}`;
    });

    const lineChunks = chunkLines(lines, FIELD_VALUE_MAX);
    const embeds: EmbedBuilder[] = [embed];
    let current = embed;
    let fieldsOnCurrent = 0;

    lineChunks.forEach((chunkLines_, i) => {
      if (fieldsOnCurrent >= MAX_FIELDS_PER_EMBED) {
        current = baseEmbed()
          .setAuthor({ name: interaction.guild!.name, iconURL: icon ?? undefined })
          .setTitle(`${title} · continued`)
          .setTimestamp(new Date());
        embeds.push(current);
        fieldsOnCurrent = 0;
      }
      const totalParts = lineChunks.length;
      const fieldName = totalParts === 1 ? "Clan roster" : `Clan roster · part ${i + 1}/${totalParts}`;
      current.addFields({
        name: fieldName,
        value: chunkLines_.join("\n\n"),
        inline: false,
      });
      fieldsOnCurrent += 1;
    });

    // Update existing tracked message if possible; otherwise send a new one.
    const existing = await getActiveClansPanel(pool, guildRowId, serverId).catch(() => null);
    let channelId = existing?.channelId ?? interaction.channelId;
    let messageId = existing?.messageId ?? null;

    let posted = false;
    if (messageId) {
      try {
        const ch = await interaction.guild.channels.fetch(channelId);
        if (ch && "messages" in ch) {
          const msg = await ch.messages.fetch(messageId);
          await msg.edit({ embeds });
          posted = true;
        }
      } catch {
        posted = false;
      }
    }

    if (!posted) {
      const panelMessage = await interaction.channel?.send({ embeds }).catch(() => null);
      if (!panelMessage) {
        await interaction.editReply({ content: "❌ Could not post the active clans panel. Check bot permissions." });
        return;
      }
      channelId = panelMessage.channelId;
      messageId = panelMessage.id;
    }

    if (!messageId) {
      await interaction.editReply({ content: "❌ Could not determine the active clans message id." });
      return;
    }
    await upsertActiveClansPanel(pool, guildRowId, serverId, channelId, messageId).catch(() => {});
    await interaction.editReply({ content: `✅ Active clans panel updated in <#${channelId}>.` });
  },
};
