import { EmbedBuilder, type ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";
import { memberHasAdminRole } from "../../admin/guildAdmin.js";
import { ADMIN_ROLE_NAME } from "../../constants.js";
import { baseEmbed } from "../../embeds/standard.js";
import { listGuildClansWithMemberCounts } from "../../db/clans.js";
import { getOrCreateGuildRow } from "../../db/guilds.js";
import { pool } from "../../db/pool.js";
import { listRustServersForGuild } from "../../db/rustServers.js";
import { autocompleteServerOption, validateServerSelection } from "../shared/serverOption.js";

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

    await interaction.deferReply();

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
      const safeName = c.clanName.slice(0, 180);
      const tag = c.clanTag?.trim() || "—";
      const tagPart = tag === "—" ? "`—`" : `\`[${tag.slice(0, 4)}]\``;
      return `${tagPart} **${safeName}** · ${c.memberCount} member${c.memberCount === 1 ? "" : "s"}`;
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
        value: chunkLines_.join("\n"),
        inline: false,
      });
      fieldsOnCurrent += 1;
    });

    await interaction.editReply({ embeds });
  },
};
