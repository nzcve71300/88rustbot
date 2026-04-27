import type { Client, Guild, TextChannel } from "discord.js";
import { EmbedBuilder } from "discord.js";
import type { Pool } from "mysql2/promise";
import { pool } from "../db/pool.js";
import { getOrCreateGuildRow } from "../db/guilds.js";
import { listRustServersForGuild } from "../db/rustServers.js";
import { listGuildClansWithMemberCounts } from "../db/clans.js";
import { baseEmbed } from "../embeds/standard.js";
import {
  getActiveClansPanel,
  listActiveClansPanelsForGuild,
  upsertActiveClansPanel,
  type ActiveClansPanelRow,
} from "../db/activeClansPanels.js";

const FIELD_VALUE_MAX = 1020;
/** Fewer fields per embed so total stays under Discord’s ~6000 chars per embed */
const MAX_FIELDS_PER_EMBED = 4;
/** Discord allows at most 10 embeds per message */
const MAX_EMBEDS_PER_MESSAGE = 10;

/** Join lines with this separator (must match `chunkLines` accounting). */
const LINE_JOIN = "\n\n";

function chunkLines(lines: string[], maxLen: number): string[][] {
  const sepLen = LINE_JOIN.length;
  const chunks: string[][] = [];
  let cur: string[] = [];
  let len = 0;
  for (const line of lines) {
    const add = line.length + (cur.length ? sepLen : 0);
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

/** Split flat embed list into multiple Discord messages (max 10 embeds each). */
function chunkEmbedsIntoMessages(embeds: EmbedBuilder[]): EmbedBuilder[][] {
  if (embeds.length === 0) return [];
  const out: EmbedBuilder[][] = [];
  for (let i = 0; i < embeds.length; i += MAX_EMBEDS_PER_MESSAGE) {
    out.push(embeds.slice(i, i + MAX_EMBEDS_PER_MESSAGE));
  }
  return out;
}

async function buildActiveClansEmbedsFlat(guild: Guild, rustServerId: number): Promise<EmbedBuilder[]> {
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
      value: chunkLines_.join(LINE_JOIN),
      inline: false,
    });
    fieldsOnCurrent += 1;
  });

  return embeds;
}

/**
 * Post or edit the active-clans panel, splitting across multiple channel messages only when needed
 * (Discord max 10 embeds per message; large rosters also need smaller per-embed field batches).
 */
export async function syncActiveClansPanelInChannel(opts: {
  pool: Pool;
  guildRowId: number;
  guild: Guild;
  rustServerId: number;
  channel: TextChannel;
  existing: ActiveClansPanelRow | null;
}): Promise<{ ok: boolean; primaryMessageId: string; extraMessageIds: string[]; error?: string }> {
  const { pool, guildRowId, guild, rustServerId, channel, existing } = opts;

  const flatEmbeds = await buildActiveClansEmbedsFlat(guild, rustServerId);
  const messageGroups = chunkEmbedsIntoMessages(flatEmbeds);
  if (messageGroups.length === 0 || messageGroups[0].length === 0) {
    return { ok: false, primaryMessageId: "", extraMessageIds: [], error: "No embeds to send" };
  }

  const primaryId = existing?.messageId?.trim() || null;
  const extraIds = [...(existing?.extraMessageIds ?? [])];

  const primaryMsg = primaryId ? await channel.messages.fetch(primaryId).catch(() => null) : null;

  if (!primaryMsg) {
    for (const id of extraIds) {
      await channel.messages.delete(id).catch(() => {});
    }
    const sent: string[] = [];
    for (const grp of messageGroups) {
      const m = await channel.send({ embeds: grp }).catch(() => null);
      if (!m) {
        return { ok: false, primaryMessageId: "", extraMessageIds: [], error: "Could not post panel message(s)." };
      }
      sent.push(m.id);
    }
    const primary = sent[0]!;
    const extras = sent.slice(1);
    await upsertActiveClansPanel(pool, guildRowId, rustServerId, channel.id, primary, extras.length ? extras : null);
    return { ok: true, primaryMessageId: primary, extraMessageIds: extras };
  }

  await primaryMsg.edit({ embeds: messageGroups[0]! });

  const neededExtras = Math.max(0, messageGroups.length - 1);
  while (extraIds.length > neededExtras) {
    const id = extraIds.pop()!;
    await channel.messages.delete(id).catch(() => {});
  }

  for (let i = 1; i < messageGroups.length; i++) {
    const grp = messageGroups[i]!;
    const idx = i - 1;
    if (idx < extraIds.length) {
      const mid = extraIds[idx]!;
      const m = await channel.messages.fetch(mid).catch(() => null);
      if (m) {
        await m.edit({ embeds: grp });
      } else {
        const nm = await channel.send({ embeds: grp }).catch(() => null);
        if (!nm) {
          return { ok: false, primaryMessageId: primaryMsg.id, extraMessageIds: extraIds, error: "Could not post continuation message." };
        }
        extraIds[idx] = nm.id;
      }
    } else {
      const nm = await channel.send({ embeds: grp }).catch(() => null);
      if (!nm) {
        return { ok: false, primaryMessageId: primaryMsg.id, extraMessageIds: extraIds, error: "Could not post continuation message." };
      }
      extraIds.push(nm.id);
    }
  }

  await upsertActiveClansPanel(
    pool,
    guildRowId,
    rustServerId,
    channel.id,
    primaryMsg.id,
    extraIds.length ? extraIds : null
  );
  return { ok: true, primaryMessageId: primaryMsg.id, extraMessageIds: extraIds };
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
  if (!ch || !ch.isTextBased() || !("send" in ch)) return { ok: false };
  const textCh = ch as TextChannel;

  const guildRowId = await getOrCreateGuildRow(pool, opts.discordGuildId);
  const existing = await getActiveClansPanel(pool, guildRowId, opts.rustServerId).catch(() => null);

  const res = await syncActiveClansPanelInChannel({
    pool,
    guildRowId,
    guild,
    rustServerId: opts.rustServerId,
    channel: textCh,
    existing,
  });
  return res.ok ? { ok: true, messageId: res.primaryMessageId } : { ok: false };
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
      if (!channel || !channel.isTextBased() || !("send" in channel)) continue;
      const textCh = channel as TextChannel;
      const existing: ActiveClansPanelRow = {
        rustServerId: p.rustServerId,
        channelId: p.channelId,
        messageId: p.messageId,
        extraMessageIds: p.extraMessageIds ?? [],
      };
      await syncActiveClansPanelInChannel({
        pool,
        guildRowId,
        guild,
        rustServerId: p.rustServerId,
        channel: textCh,
        existing,
      });
    } catch {
      // best-effort; ignore missing perms/deleted messages
    }
  }
}
