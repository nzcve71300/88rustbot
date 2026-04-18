import { EmbedBuilder } from "discord.js";
import { BOT_DISPLAY_NAME, EMBED_COLOR } from "../constants.js";

export function baseEmbed(): EmbedBuilder {
  return new EmbedBuilder().setColor(EMBED_COLOR).setFooter({ text: `Powered by ${BOT_DISPLAY_NAME}` });
}
