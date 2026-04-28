import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  type ChatInputCommandInteraction,
} from "discord.js";
import { memberHasAdminRole } from "../admin/guildAdmin.js";
import { ADMIN_ROLE_NAME } from "../constants.js";
import { baseEmbed } from "../embeds/standard.js";
import { getOrCreateGuildRow } from "../db/guilds.js";
import { pool } from "../db/pool.js";
import { deleteLinkByDiscordUser, getLinkByDiscordUser, getLinkByIngameNameCi } from "../db/links.js";

export const UNLINK_CONFIRM_ID = "unlink:confirm";
export const UNLINK_CANCEL_ID = "unlink:cancel";

type Pending = { targetUserId: string; ingameName: string; createdAt: number };
const pending = new Map<string, Pending>();
const PENDING_TTL_MS = 2 * 60 * 1000;

function key(guildId: string, adminUserId: string) {
  return `${guildId}:${adminUserId}`;
}

export async function beginUnlink(interaction: ChatInputCommandInteraction) {
  if (!interaction.inGuild() || !interaction.guildId || !interaction.guild || !interaction.member) {
    await interaction.reply({ content: "This command can only be used inside a server.", ephemeral: true });
    return;
  }

  if (!memberHasAdminRole(interaction.member, interaction.guild)) {
    await interaction.reply({
      content: `You need the **${ADMIN_ROLE_NAME}** role to use this command.`,
      ephemeral: true,
    });
    return;
  }

  const target = interaction.options.getUser("user", false);
  const nameOpt = interaction.options.getString("name", false)?.trim() ?? "";

  if (!target && !nameOpt) {
    await interaction.reply({
      embeds: [baseEmbed().setTitle("Missing target").setDescription("Provide either **user** or **name**.")],
      ephemeral: true,
    });
    return;
  }
  if (target && nameOpt) {
    await interaction.reply({
      embeds: [baseEmbed().setTitle("Pick one").setDescription("Provide **either** user **or** name (not both).")],
      ephemeral: true,
    });
    return;
  }
  if (target?.bot) {
    await interaction.reply({ content: "You cannot unlink a bot.", ephemeral: true });
    return;
  }

  const guildRowId = await getOrCreateGuildRow(pool, interaction.guildId);
  const existing = target
    ? await getLinkByDiscordUser(pool, guildRowId, target.id)
    : await getLinkByIngameNameCi(pool, guildRowId, nameOpt);
  if (!existing) {
    await interaction.reply({
      embeds: [
        baseEmbed()
          .setTitle("Not linked")
          .setDescription(
            target
              ? `${target} is not linked to an in-game name in this Discord.`
              : `**\`${nameOpt}\`** is not linked to any Discord user in this Discord.`
          ),
      ],
      ephemeral: true,
    });
    return;
  }

  const targetUserId = target?.id ?? existing.discordUserId;
  pending.set(key(interaction.guildId, interaction.user.id), {
    targetUserId,
    ingameName: existing.ingameName,
    createdAt: Date.now(),
  });

  const display = target
    ? target.globalName ?? target.username
    : `<@${targetUserId}>`;
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(UNLINK_CONFIRM_ID).setLabel("Confirm").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(UNLINK_CANCEL_ID).setLabel("Decline").setStyle(ButtonStyle.Secondary)
  );

  await interaction.reply({
    embeds: [
      baseEmbed()
        .setTitle("Unlink Rust name")
        .setDescription(
          [
            `You’re about to remove the link for **${display}**.`,
            "",
            `Linked name: **\`${existing.ingameName}\`**`,
            "",
            "They can link again later (this does not delete saved stats/history).",
          ].join("\n")
        ),
    ],
    components: [row],
    ephemeral: true,
  });
}

export async function handleUnlinkButton(interaction: ButtonInteraction) {
  if (!interaction.inGuild() || !interaction.guildId || !interaction.guild || !interaction.member) {
    await interaction.reply({ content: "This can only be used in a server.", ephemeral: true });
    return;
  }

  if (!memberHasAdminRole(interaction.member, interaction.guild)) {
    await interaction.reply({ content: "You cannot use this button.", ephemeral: true });
    return;
  }

  const k = key(interaction.guildId, interaction.user.id);
  const p = pending.get(k);
  if (!p || Date.now() - p.createdAt > PENDING_TTL_MS) {
    pending.delete(k);
    await interaction.reply({
      embeds: [baseEmbed().setTitle("Expired").setDescription("Run `/unlink` again.")],
      ephemeral: true,
    });
    return;
  }

  if (interaction.customId === UNLINK_CANCEL_ID) {
    pending.delete(k);
    await interaction.update({
      embeds: [baseEmbed().setTitle("Cancelled").setDescription("No changes were made.")],
      components: [],
    });
    return;
  }

  if (interaction.customId !== UNLINK_CONFIRM_ID) return;

  const guildRowId = await getOrCreateGuildRow(pool, interaction.guildId);
  const removed = await deleteLinkByDiscordUser(pool, guildRowId, p.targetUserId);
  pending.delete(k);

  if (!removed) {
    await interaction.update({
      embeds: [baseEmbed().setTitle("Nothing to unlink").setDescription("That link was already removed.")],
      components: [],
    });
    return;
  }

  try {
    const member = await interaction.guild.members.fetch(p.targetUserId);
    await member.setNickname(null, "Admin unlinked in-game name");
  } catch {
    /* permissions or member left */
  }

  await interaction.update({
    embeds: [
      baseEmbed()
        .setTitle("✅ Unlinked")
        .setDescription([`Removed link for <@${p.targetUserId}>.`, "", `Previous name: **\`${p.ingameName}\`**`].join("\n")),
    ],
    components: [],
  });

  const ch = interaction.channel;
  if (ch?.isTextBased() && !ch.isDMBased()) {
    await ch.send({
      embeds: [
        baseEmbed()
          .setTitle("🔓 Rust profile unlinked")
          .setDescription([`Member: <@${p.targetUserId}>`, `Previous name: **\`${p.ingameName}\`**`].join("\n")),
      ],
    });
  }
}
