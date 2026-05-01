import { type ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";
import { baseEmbed } from "../../embeds/standard.js";
import { pool } from "../../db/pool.js";
import { updateLucidsByDelta } from "../../db/storeLucids.js";
import { canUseGiveTokens } from "./giveTokensAllowlist.js";

export const giveTokensCommand = {
  data: new SlashCommandBuilder()
    .setName("give-tokens")
    .setDescription("Give a Discord user Lucids (token balance for the store).")
    .addUserOption((o) => o.setName("player").setDescription("Discord user to receive Lucids").setRequired(true))
    .addIntegerOption((o) =>
      o
        .setName("amount")
        .setDescription("How many Lucids to give")
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

    const actorId = interaction.user?.id;
    if (!canUseGiveTokens(actorId)) {
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

    const target = interaction.options.getUser("player", true);
    const amount = interaction.options.getInteger("amount", true);
    const amt = Math.max(1, Math.floor(amount));

    await interaction.deferReply({ ephemeral: true });

    try {
      const newBalance = await updateLucidsByDelta(pool, target.id, amt);

      await interaction.editReply({
        embeds: [
          baseEmbed()
            .setTitle("Lucids granted")
            .setDescription(`Gave ${target} **${amt.toLocaleString()}** Lucids.`)
            .addFields(
              { name: "New balance", value: `**${newBalance.toLocaleString()}** Lucids`, inline: true },
              { name: "User", value: `${target.tag} (\`${target.id}\`)`, inline: true }
            )
            .setTimestamp(new Date()),
        ],
      });
    } catch (err) {
      console.error("[give-tokens] failed:", err);
      await interaction.editReply({
        embeds: [baseEmbed().setTitle("Error").setDescription("Failed to update Lucids balance. Try again.")],
      });
    }
  },
};

