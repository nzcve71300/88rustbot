import { type ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";
import { beginUnlink } from "../../linking/unlinkFlow.js";

export const unlinkCommand = {
  data: new SlashCommandBuilder()
    .setName("unlink")
    .setDescription("Remove a member's /link for this Discord (admin only).")
    .addUserOption((o) =>
      o.setName("user").setDescription("Member to unlink (@mention)").setRequired(true)
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    await beginUnlink(interaction);
  },
};
