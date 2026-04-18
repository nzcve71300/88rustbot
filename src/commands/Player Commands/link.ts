import { type ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";
import { beginLink } from "../../linking/linkFlow.js";

export const linkCommand = {
  data: new SlashCommandBuilder()
    .setName("link")
    .setDescription("Link your Discord to your in-game name for this Discord server.")
    .addStringOption((o) =>
      o
        .setName("name")
        .setDescription("Your in-game name (exact).")
        .setRequired(true)
        .setMaxLength(64)
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    const name = interaction.options.getString("name", true);
    await beginLink(interaction, name);
  },
};

