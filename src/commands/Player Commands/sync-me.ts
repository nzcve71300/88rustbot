import { type ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";
import { baseEmbed } from "../../embeds/standard.js";
import { getOrCreateGuildRow } from "../../db/guilds.js";
import { pool } from "../../db/pool.js";
import { getLinkByDiscordUser } from "../../db/links.js";

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

    // Same nickname format as /link so it stays consistent across the bot.
    const nick = `🔗${link.ingameName}`.slice(0, 32);
    try {
      const member = await interaction.guild.members.fetch(interaction.user.id);
      const me = interaction.guild.members.me ?? (await interaction.guild.members.fetchMe().catch(() => null));

      if (interaction.guild.ownerId === interaction.user.id) {
        await interaction.editReply({
          embeds: [
            baseEmbed()
              .setTitle("Can’t change your nickname")
              .setDescription(
                [
                  "Discord does not allow bots to change the **server owner’s** nickname.",
                  "",
                  `You are still linked as **${link.ingameName}**.`,
                ].join("\n")
              ),
          ],
        });
        return;
      }

      if (me && me.roles.highest.comparePositionTo(member.roles.highest) <= 0) {
        await interaction.editReply({
          embeds: [
            baseEmbed()
              .setTitle("Can’t change your nickname")
              .setDescription(
                [
                  "My role is not high enough to change your nickname.",
                  "",
                  "**Fix:** Move the bot’s role above your role in Server Settings → Roles.",
                  `You are still linked as **${link.ingameName}**.`,
                ].join("\n")
              ),
          ],
        });
        return;
      }
      await member.setNickname(nick, "Synced linked in-game name");
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

