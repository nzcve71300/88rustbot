import type { Guild } from "discord.js";
import { ADMIN_ROLE_NAME } from "../constants.js";

const LEGACY_ADMIN_ROLE_NAME = "3.14 Admin";

export async function ensureAdminRole(guild: Guild) {
  const current = guild.roles.cache.find((r) => r.name === ADMIN_ROLE_NAME);
  if (current) return current;

  const legacy = guild.roles.cache.find((r) => r.name === LEGACY_ADMIN_ROLE_NAME);
  if (legacy) {
    return legacy.edit({
      name: ADMIN_ROLE_NAME,
      reason: `Renamed from ${LEGACY_ADMIN_ROLE_NAME} to match bot branding.`,
    });
  }

  return guild.roles.create({
    name: ADMIN_ROLE_NAME,
    mentionable: false,
    reason: `${ADMIN_ROLE_NAME} role is required for bot administration.`,
  });
}
