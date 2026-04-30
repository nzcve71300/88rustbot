import { type ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";
import { baseEmbed } from "../../embeds/standard.js";
import { getOrCreateGuildRow } from "../../db/guilds.js";
import { pool } from "../../db/pool.js";
import { getLinkByDiscordUser } from "../../db/links.js";
import { syncLinkedNicknameForUser } from "../../clans/nicknames.js";
import { optInNicknameSync } from "../../db/nicknameSync.js";
import { getMemberClan } from "../../db/clans.js";

function buildNickname(linkedName: string, clanTag: string | null): string {
  const cleanName = String(linkedName || "").trim();
  const tag = clanTag ? String(clanTag).trim().toUpperCase() : "";
  if (cleanName && tag) return `${cleanName} | ${tag}`.slice(0, 32);
  return `🔗${cleanName}`.slice(0, 32);
}

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

    const clan = await getMemberClan(pool, guildRowId, interaction.user.id).catch(() => null);
    const expectedNick = buildNickname(link.ingameName, clan?.clanTag ?? null);

    let beforeNick: string | null = null;
    try {
      const member = await interaction.guild.members.fetch(interaction.user.id);
      beforeNick = member.nickname ?? member.user.username ?? null;
    } catch {
      // ignore
    }

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
          .setDescription(
            [
              `✅ **Linked name:** **${link.ingameName}**`,
              `🏷️ **Clan tag:** ${clan?.clanTag ? `**${String(clan.clanTag).toUpperCase()}**` : "_No clan tag (not in a clan)_"} `,
              "",
              `📝 **Expected nickname:** **${expectedNick}**`,
              ...(beforeNick
                ? [`🔎 **Before:** **${beforeNick}**`, `🔁 **After:** **${expectedNick}**`]
                : []),
              "",
              "If your nickname didn’t change, the bot likely lacks **Manage Nicknames**, or role hierarchy blocks it.",
            ].join("\n")
          ),
      ],
    });
  },
};

