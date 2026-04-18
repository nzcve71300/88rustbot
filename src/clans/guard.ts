import type { ChatInputCommandInteraction } from "discord.js";
import { getOrCreateGuildRow } from "../db/guilds.js";
import { getClanSettings } from "../db/clans.js";
import { pool } from "../db/pool.js";
import { baseEmbed } from "../embeds/standard.js";

export async function ensureClanSystemEnabled(
  interaction: ChatInputCommandInteraction
): Promise<{ ok: true; guildRowId: number } | { ok: false }> {
  if (!interaction.inGuild() || !interaction.guildId) {
    await interaction.reply({ content: "This command can only be used inside a server.", ephemeral: true });
    return { ok: false };
  }

  const guildRowId = await getOrCreateGuildRow(pool, interaction.guildId);
  const settings = await getClanSettings(pool, guildRowId);
  if (!settings.enabled) {
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp({
        embeds: [baseEmbed().setTitle("Clan system disabled").setDescription("An admin must enable it first.")],
        ephemeral: true,
      });
    } else {
      await interaction.reply({
        embeds: [baseEmbed().setTitle("Clan system disabled").setDescription("An admin must enable it first.")],
        ephemeral: true,
      });
    }
    return { ok: false };
  }

  return { ok: true, guildRowId };
}

