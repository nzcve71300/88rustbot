import { type ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";
import { baseEmbed } from "../../embeds/standard.js";
import { getOrCreateGuildRow } from "../../db/guilds.js";
import { pool } from "../../db/pool.js";
import { getLinkByDiscordUser } from "../../db/links.js";
import { syncLinkedNicknameForUser } from "../../clans/nicknames.js";
import { optInNicknameSync } from "../../db/nicknameSync.js";

export const syncMeCommand = {
  data: new SlashCommandBuilder()
    .setName("sync-me")
    .setDescription("Sync your Discord nickname with your linked in-game name (website link support)."),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.inGuild() || !interaction.guildId || !interaction.guild) {
      await interaction.reply({ content: "This command can only be used inside a server.", ephemeral: true });
      return;
    }

    await interaction.deferReply({ ephemeral: true });

    const guildRowId = await getOrCreateGuildRow(pool, interaction.guildId);
    const link = await getLinkByDiscordUser(pool, guildRowId, interaction.user.id);
    if (!link) {
      await interaction.editReply({
        embeds: [
          baseEmbed()
            .setTitle("Not linked")
            .setDescription("You are not linked in this Discord yet. Link on the website or use `/link`."),
        ],
      });
      return;
    }

    // Explicit opt-in for legacy users (and safe to call repeatedly).
    await optInNicknameSync(pool, guildRowId, interaction.user.id).catch(() => {});

    try {
      await syncLinkedNicknameForUser({
        pool,
        guildRowId,
        guild: interaction.guild,
        discordUserId: interaction.user.id,
        force: true,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await interaction.editReply({
        embeds: [
          baseEmbed()
            .setTitle("Linked (nickname not updated)")
            .setDescription(
              [
                `You are linked as **${link.ingameName}** in this Discord.`,
                "",
                "I couldn’t update your nickname. This usually means I’m missing **Manage Nicknames**, or role hierarchy blocks it.",
                "",
                `**Details:** ${msg.slice(0, 200)}`,
              ].join("\n")
            ),
        ],
      });
      return;
    }

    await interaction.editReply({
      embeds: [
        baseEmbed()
          .setTitle("Synced")
          .setDescription(`You are linked as **${link.ingameName}** in this Discord.`),
      ],
    });
  },
};

