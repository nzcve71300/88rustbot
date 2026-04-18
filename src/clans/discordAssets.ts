import {
  CategoryChannel,
  ChannelType,
  Guild,
  OverwriteType,
  PermissionsBitField,
  Role,
} from "discord.js";

const CLANS_CATEGORY_NAME = "Clans";

const COLOR_MAP: Record<string, number> = {
  red: 0xef4444,
  orange: 0xf97316,
  yellow: 0xeab308,
  green: 0x22c55e,
  blue: 0x3b82f6,
  purple: 0xa855f7,
  black: 0x111827,
  white: 0xf9fafb,
  brown: 0x92400e,
  pink: 0xec4899,
  cyan: 0x06b6d4,
  lime: 0x84cc16,
};

export function resolveRoleColor(colorKey: string): number {
  return COLOR_MAP[colorKey] ?? 0x22c55e;
}

export async function ensureClansCategory(guild: Guild): Promise<CategoryChannel> {
  const existing = guild.channels.cache.find(
    (c) => c.type === ChannelType.GuildCategory && c.name === CLANS_CATEGORY_NAME
  ) as CategoryChannel | undefined;
  if (existing) return existing;

  return guild.channels.create({
    name: CLANS_CATEGORY_NAME,
    type: ChannelType.GuildCategory,
    reason: "Clan system category",
  });
}

export async function createClanRole(guild: Guild, clanName: string, colorKey: string): Promise<Role> {
  return guild.roles.create({
    name: clanName,
    color: resolveRoleColor(colorKey),
    mentionable: false,
    reason: "Clan role created",
  });
}

export async function createPrivateClanChannel(
  guild: Guild,
  category: CategoryChannel,
  channelName: string,
  role: Role
) {
  return guild.channels.create({
    name: channelName,
    type: ChannelType.GuildText,
    parent: category,
    permissionOverwrites: [
      {
        id: guild.roles.everyone.id,
        deny: [PermissionsBitField.Flags.ViewChannel],
        type: OverwriteType.Role,
      },
      {
        id: role.id,
        allow: [PermissionsBitField.Flags.ViewChannel],
        type: OverwriteType.Role,
      },
    ],
    reason: "Clan private channel created",
  });
}

