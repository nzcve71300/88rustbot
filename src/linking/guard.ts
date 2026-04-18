import type { ChatInputCommandInteraction } from "discord.js";
import { baseEmbed } from "../embeds/standard.js";
import { getOrCreateGuildRow } from "../db/guilds.js";
import { pool } from "../db/pool.js";
import { getLinkByDiscordUser } from "../db/links.js";

export async function requireLinked(
  interaction: ChatInputCommandInteraction
): Promise<{ ok: true; guildRowId: number; ingameName: string } | { ok: false }> {
  if (!interaction.inGuild() || !interaction.guildId) {
    await interaction.reply({ content: "This command can only be used inside a server.", ephemeral: true });
    return { ok: false };
  }
  const guildRowId = await getOrCreateGuildRow(pool, interaction.guildId);
  const link = await getLinkByDiscordUser(pool, guildRowId, interaction.user.id);
  if (!link) {
    await interaction.reply({
      embeds: [baseEmbed().setTitle("Not linked").setDescription("Use `/link` first before using this command.")],
      ephemeral: true,
    });
    return { ok: false };
  }
  return { ok: true, guildRowId, ingameName: link.ingameName };
}

