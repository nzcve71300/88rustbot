import type { Guild } from "discord.js";
import type { Pool } from "mysql2/promise";
import { getLinkByDiscordUser } from "../db/links.js";
import { getMemberClan, listClanMemberDiscordUserIds } from "../db/clans.js";

function buildNickname(linkedName: string, clanTag: string | null): string {
  const cleanName = String(linkedName || "").trim();
  const tag = clanTag ? String(clanTag).trim().toUpperCase() : "";
  if (cleanName && tag) {
    return `${cleanName} | ${tag}`.slice(0, 32);
  }
  // Back-compat: keep old /link style when not in a clan.
  return `🔗${cleanName}`.slice(0, 32);
}

export async function syncLinkedNicknameForUser(opts: {
  pool: Pool;
  guildRowId: number;
  guild: Guild;
  discordUserId: string;
}): Promise<void> {
  const { pool, guildRowId, guild, discordUserId } = opts;

  const link = await getLinkByDiscordUser(pool, guildRowId, discordUserId);
  if (!link) return;

  const clan = await getMemberClan(pool, guildRowId, discordUserId).catch(() => null);
  const clanTag = clan?.clanTag ?? null;
  const nick = buildNickname(link.ingameName, clanTag);

  try {
    if (guild.ownerId === discordUserId) return;
    const member = await guild.members.fetch(discordUserId);
    const me = guild.members.me ?? (await guild.members.fetchMe().catch(() => null));
    if (me && me.roles.highest.comparePositionTo(member.roles.highest) <= 0) return;
    await member.setNickname(nick, "Sync linked name + clan tag");
  } catch {
    // best-effort; ignore permission/hierarchy failures
  }
}

export async function syncLinkedNicknamesForClan(opts: {
  pool: Pool;
  guildRowId: number;
  guild: Guild;
  clanId: number;
}): Promise<void> {
  const { pool, guildRowId, guild, clanId } = opts;
  const ids = await listClanMemberDiscordUserIds(pool, clanId).catch(() => []);
  await Promise.all(
    ids.map((uid) => syncLinkedNicknameForUser({ pool, guildRowId, guild, discordUserId: uid }).catch(() => {}))
  );
}

