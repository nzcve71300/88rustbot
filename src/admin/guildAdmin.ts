import { GuildMember, type APIInteractionGuildMember, type Guild } from "discord.js";
import { ADMIN_ROLE_NAME } from "../constants.js";

/** Previous default admin role name; members who had it still count after rename. */
const LEGACY_ADMIN_ROLE_NAME = "3.14 Admin";

export function memberHasAdminRole(
  member: GuildMember | APIInteractionGuildMember,
  guild: Guild
): boolean {
  const targetIds = guild.roles.cache
    .filter((r) => r.name === ADMIN_ROLE_NAME || r.name === LEGACY_ADMIN_ROLE_NAME)
    .map((r) => r.id);
  if (targetIds.length === 0) return false;
  if (member instanceof GuildMember) {
    return targetIds.some((id) => member.roles.cache.has(id));
  }
  return targetIds.some((id) => member.roles.includes(id));
}
