import type { AutocompleteInteraction } from "discord.js";
import { getOrCreateGuildRow } from "../../db/guilds.js";
import { pool } from "../../db/pool.js";
import { listRustServersForGuild } from "../../db/rustServers.js";

export async function autocompleteServerOption(interaction: AutocompleteInteraction, optionName = "server") {
  if (!interaction.inGuild() || !interaction.guildId) {
    await interaction.respond([]);
    return;
  }
  let focused: { name: string; value: string };
  try {
    focused = interaction.options.getFocused(true);
  } catch {
    await interaction.respond([]);
    return;
  }
  if (focused.name !== optionName) {
    await interaction.respond([]);
    return;
  }

  const guildRowId = await getOrCreateGuildRow(pool, interaction.guildId);
  const servers = await listRustServersForGuild(pool, guildRowId);
  const q = (focused.value ?? "").toLowerCase();
  const picked = servers.filter((s) => s.nickname.toLowerCase().includes(q)).slice(0, 25);
  await interaction.respond(
    picked.map((s) => ({
      name: s.nickname.length > 100 ? `${s.nickname.slice(0, 97)}...` : s.nickname,
      value: String(s.id),
    }))
  );
}

export async function validateServerSelection(guildId: string, serverId: number): Promise<boolean> {
  const guildRowId = await getOrCreateGuildRow(pool, guildId);
  const servers = await listRustServersForGuild(pool, guildRowId);
  const target = String(serverId);
  return servers.some((s) => String(s.id) === target);
}

