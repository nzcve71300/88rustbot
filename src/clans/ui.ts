import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import { BOT_DISPLAY_NAME } from "../constants.js";
import { baseEmbed } from "../embeds/standard.js";

export const JOIN_CLAN_BUTTON_ID = "clans:join_button";
export const JOIN_CLAN_MODAL_ID = "clans:join_modal";
export const JOIN_CLAN_CODE_INPUT_ID = "clans:code";

export function buildClanJoinEmbed(enabled: boolean, maxMembers: number): EmbedBuilder {
  const status = enabled ? "Enabled" : "Disabled";

  return baseEmbed()
    .setTitle("🏰 JOIN A CLAN 🏰")
    .setDescription(
      [
        "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
        "🟢 Clan System",
        status,
        "👥 Max Clan Members",
        `${maxMembers} players`,
        "📋 How to Join",
        "Click the button below and enter your clan invite code!",
        "💡 Need a Code?",
        "Ask your clan owner for the invite code. They can create one using /clan-invite.",
        "",
        `_${BOT_DISPLAY_NAME} keeps clan data per Discord server._`,
      ].join("\n")
    );
}

export function buildJoinClanButtonRow(disabled: boolean) {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(JOIN_CLAN_BUTTON_ID)
      .setLabel("Join Clan")
      .setStyle(ButtonStyle.Success)
      .setDisabled(disabled)
  );
}

export function buildJoinClanModal(): ModalBuilder {
  const input = new TextInputBuilder()
    .setCustomId(JOIN_CLAN_CODE_INPUT_ID)
    .setLabel("4-digit clan invite code")
    .setPlaceholder("1234")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMinLength(4)
    .setMaxLength(4);

  return new ModalBuilder()
    .setCustomId(JOIN_CLAN_MODAL_ID)
    .setTitle("Join a Clan")
    .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));
}

