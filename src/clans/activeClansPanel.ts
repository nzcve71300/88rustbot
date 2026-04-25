import type { Client, Guild } from "discord.js";
import { EmbedBuilder } from "discord.js";
import { pool } from "../db/pool.js";
import { getOrCreateGuildRow } from "../db/guilds.js";
import { listRustServersForGuild } from "../db/rustServers.js";
import { listGuildClansWithMemberCounts } from "../db/clans.js";
import { baseEmbed } from "../embeds/standard.js";
import { listActiveClansPanelsForGuild, upsertActiveClansPanel } from "../db/activeClansPanels.js";

const FIELD_VALUE_MAX = 1020;
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

async function buildActiveClansEmbeds(guild: Guild, rustServerId: number): Promise<EmbedBuilder[]> {
  const guildRowId = await getOrCreateGuildRow(pool, guild.id);
  const servers = await listRustServersForGuild(pool, guildRowId);
  const srv = servers.find((s) => String(s.id) === String(rustServerId));
  const nickname = srv?.nickname || "Unknown server";

  const clans = await listGuildClansWithMemberCounts(pool, guildRowId);
  const totalClans = clans.length;
  const totalMembers = clans.reduce((s, c) => s + c.memberCount, 0);

  const title = `ACTIVE CLANS ON ${nickname}`.slice(0, 256);
  const icon = guild.iconURL({ size: 128 }) ?? undefined;

  const embed = baseEmbed()
    .setAuthor({ name: guild.name, iconURL: icon })
    .setTitle(title)
    .setDescription(
      [
        `**Total Clans:** **${totalClans}**`,
        `**Total Clan Members:** **${totalMembers}**`,
        "",
        "_This message auto-updates when clans or members change._",
      ].join("\n")
    )
    .setTimestamp(new Date());

  if (totalClans === 0) {
    embed.addFields({
      name: "Clans",
      value: "*No clans have been created yet.*",
      inline: false,
    });
    return [embed];
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
        .setAuthor({ name: guild.name, iconURL: icon })
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

  return embeds;
}

export async function sendOrUpdateActiveClansPanel(opts: {
  client: Client;
  discordGuildId: string;
  rustServerId: number;
  channelId: string;
}): Promise<{ ok: boolean; messageId?: string }> {
  const guild = await opts.client.guilds.fetch(opts.discordGuildId).catch(() => null);
  if (!guild) return { ok: false };

  const ch = await guild.channels.fetch(opts.channelId).catch(() => null);
  if (!ch || !("send" in ch)) return { ok: false };

  const embeds = await buildActiveClansEmbeds(guild, opts.rustServerId);

  const msg = await ch.send({ embeds });
  const guildRowId = await getOrCreateGuildRow(pool, opts.discordGuildId);
  await upsertActiveClansPanel(pool, guildRowId, opts.rustServerId, opts.channelId, msg.id);
  return { ok: true, messageId: msg.id };
}

export async function refreshActiveClansPanelsForGuild(client: Client, discordGuildId: string): Promise<void> {
  const guild = await client.guilds.fetch(discordGuildId).catch(() => null);
  if (!guild) return;

  const guildRowId = await getOrCreateGuildRow(pool, discordGuildId);
  const panels = await listActiveClansPanelsForGuild(pool, guildRowId);
  if (!panels.length) return;

  for (const p of panels) {
    try {
      const channel = await guild.channels.fetch(p.channelId).catch(() => null);
      if (!channel || !("messages" in channel)) continue;
      const message = await channel.messages.fetch(p.messageId).catch(() => null);
      if (!message) continue;
      const embeds = await buildActiveClansEmbeds(guild, p.rustServerId);
      await message.edit({ embeds });
    } catch {
      // best-effort; ignore missing perms/deleted messages
    }
  }
}

