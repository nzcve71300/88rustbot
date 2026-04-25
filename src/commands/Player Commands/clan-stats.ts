import { type ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";
import { baseEmbed } from "../../embeds/standard.js";
import { pool } from "../../db/pool.js";
import { getOrCreateGuildRow } from "../../db/guilds.js";
import { getClanSettings, getMemberClan } from "../../db/clans.js";
import { autocompleteServerOption, validateServerSelection } from "../shared/serverOption.js";

function kdRatio(kills: number, deaths: number): string {
  if (deaths > 0) return (kills / deaths).toFixed(2);
  return String(kills);
}

export const clanStatsCommand = {
  data: new SlashCommandBuilder()
    .setName("clan-stats")
    .setDescription("Show your clan stats (kills/deaths/KD + top 3) for a Rust server.")
    .addStringOption((o) =>
      o.setName("server").setDescription("Rust server").setRequired(true).setAutocomplete(true)
    ),

  async autocomplete(interaction: import("discord.js").AutocompleteInteraction) {
    await autocompleteServerOption(interaction, "server");
  },

  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.inGuild() || !interaction.guildId) {
      await interaction.reply({ content: "This command can only be used inside a server.", ephemeral: true });
      return;
    }

    const serverId = Number.parseInt(interaction.options.getString("server", true), 10);
    if (!Number.isFinite(serverId) || serverId < 1 || !(await validateServerSelection(interaction.guildId, serverId))) {
      await interaction.reply({
        embeds: [baseEmbed().setTitle("Invalid server").setDescription("Pick a server from autocomplete.")],
        ephemeral: true,
      });
      return;
    }

    await interaction.deferReply();

    const guildRowId = await getOrCreateGuildRow(pool, interaction.guildId);
    const settings = await getClanSettings(pool, guildRowId);
    if (!settings.enabled) {
      await interaction.editReply({
        embeds: [baseEmbed().setTitle("Clan system disabled").setDescription("An admin must enable it first.")],
      });
      return;
    }

    const clan = await getMemberClan(pool, guildRowId, interaction.user.id);
    if (!clan) {
      await interaction.editReply({
        embeds: [baseEmbed().setTitle("No clan").setDescription("You must be in a clan to view clan stats.")],
      });
      return;
    }

    const [rows] = await pool.query(
      `SELECT l.ingame_name AS ingameName,
              CAST(u.discord_user_id AS CHAR) AS discordUserId,
              COALESCE(k.kills, 0) AS kills,
              COALESCE(k.deaths, 0) AS deaths
       FROM (
         SELECT CAST(cm.discord_user_id AS CHAR) AS discord_user_id
         FROM clan_members cm
         WHERE cm.clan_id = :cid
         UNION
         SELECT CAST(c.owner_discord_user_id AS CHAR) AS discord_user_id
         FROM clans c
         WHERE c.id = :cid
       ) u
       JOIN discord_links l ON l.guild_id = :gid AND CAST(l.discord_user_id AS CHAR) = u.discord_user_id
       LEFT JOIN rust_player_kd k
         ON k.guild_id = :gid AND k.rust_server_id = :sid AND LOWER(TRIM(k.ingame_name)) = LOWER(TRIM(l.ingame_name))
       `,
      { gid: guildRowId, sid: serverId, cid: clan.clanId }
    );

    const list = (rows as { ingameName: string; discordUserId: string; kills: number; deaths: number }[]).map((r) => ({
      ingameName: String(r.ingameName),
      discordUserId: String(r.discordUserId),
      kills: Number(r.kills),
      deaths: Number(r.deaths),
    }));
    const totalKills = list.reduce((s, x) => s + x.kills, 0);
    const totalDeaths = list.reduce((s, x) => s + x.deaths, 0);
    const top3 = [...list].sort((a, b) => b.kills - a.kills).slice(0, 3);

    const podiumLines = top3.length
      ? top3
          .map((p, i) => {
            const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : "🥉";
            return `${medal} **${p.ingameName}** — **${p.kills}** kills`;
          })
          .join("\n")
      : "_No kills recorded yet._";

    await interaction.editReply({
      embeds: [
        baseEmbed()
          .setTitle(`Clan Stats — ${clan.clanName}`)
          .setDescription(
            [
              `**Members:** ${list.length}`,
              `**Total Kills:** ${totalKills}`,
              `**Total Deaths:** ${totalDeaths}`,
              `**KD Ratio:** ${kdRatio(totalKills, totalDeaths)}`,
              "",
              "🏆 **Top 3 Players**",
              podiumLines,
            ].join("\n")
          ),
      ],
    });
  },
};

