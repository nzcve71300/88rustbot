import { type ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";
import { baseEmbed } from "../../embeds/standard.js";
import { pool } from "../../db/pool.js";
import { getOrCreateGuildRow } from "../../db/guilds.js";
import { listLinkedDiscordUserIdsForGuild } from "../../db/links.js";
import { updateLucidsByDelta } from "../../db/storeLucids.js";
import { canUseGiveTokens } from "./giveTokensAllowlist.js";

const BATCH = 40;

export const giveTokensAllCommand = {
  data: new SlashCommandBuilder()
    .setName("give-tokens-all")
    .setDescription(
      "Give Lucids to everyone who has used /link in this server (same rules as /give-tokens per user)."
    )
    .addIntegerOption((o) =>
      o
        .setName("amount")
        .setDescription("How many Lucids each linked user receives")
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(2_000_000_000)
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.inGuild()) {
      await interaction.reply({
        embeds: [baseEmbed().setTitle("Not in a server").setDescription("This command can only be used in a server.")],
        ephemeral: true,
      });
      return;
    }

    if (!canUseGiveTokens(interaction.user?.id)) {
      await interaction.reply({
        embeds: [
          baseEmbed()
            .setTitle("Permission denied")
            .setDescription("You are not allowed to use this command.")
            .setColor(0xff3b30),
        ],
        ephemeral: true,
      });
      return;
    }

    const amount = interaction.options.getInteger("amount", true);
    const amt = Math.max(1, Math.floor(amount));

    await interaction.deferReply({ ephemeral: true });

    try {
      const guildRowId = await getOrCreateGuildRow(pool, interaction.guildId);
      const userIds = await listLinkedDiscordUserIdsForGuild(pool, guildRowId);

      if (userIds.length === 0) {
        await interaction.editReply({
          embeds: [
            baseEmbed()
              .setTitle("No recipients")
              .setDescription("Nobody has used **/link** in this server yet, so there is no one to grant Lucids to."),
          ],
        });
        return;
      }

      let failures = 0;
      for (let i = 0; i < userIds.length; i += BATCH) {
        const slice = userIds.slice(i, i + BATCH);
        await Promise.all(
          slice.map(async (uid) => {
            try {
              await updateLucidsByDelta(pool, uid, amt);
            } catch {
              failures++;
            }
          })
        );
      }

      const totalGranted = amt * userIds.length;
      await interaction.editReply({
        embeds: [
          baseEmbed()
            .setTitle("Lucids granted (bulk)")
            .setDescription(
              [
                `Gave **${amt.toLocaleString()}** Lucids to **${userIds.length.toLocaleString()}** linked user(s).`,
                `Approximate total credited: **${totalGranted.toLocaleString()}** Lucids.`,
                failures > 0 ? `\n⚠️ **${failures}** update(s) failed (check logs).` : "",
              ]
                .join("\n")
                .trim()
            )
            .setFooter({ text: "Recipients = everyone with /link in this Discord server." })
            .setTimestamp(new Date()),
        ],
      });
    } catch (err) {
      console.error("[give-tokens-all] failed:", err);
      await interaction.editReply({
        embeds: [baseEmbed().setTitle("Error").setDescription("Failed to update Lucids balances. Try again.")],
      });
    }
  },
};
