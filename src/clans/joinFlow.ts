import type {
  ButtonInteraction,
  ModalSubmitInteraction,
} from "discord.js";
import { ADMIN_ROLE_NAME } from "../constants.js";
import { getOrCreateGuildRow } from "../db/guilds.js";
import { pool } from "../db/pool.js";
import { baseEmbed } from "../embeds/standard.js";
import { getLinkByDiscordUser } from "../db/links.js";
import {
  addClanMember,
  countClanMembers,
  deleteExpiredInvites,
  findInviteByCode,
  getClanSettings,
  getDiscordRoleIdsForClanIds,
  getMemberClan,
  getOwnedClanIdInGuild,
  removeClanMemberRowsExceptInGuild,
} from "../db/clans.js";
import { refreshActiveClansPanelsForGuild } from "./activeClansPanel.js";
import { syncLinkedNicknameForUser } from "./nicknames.js";
import {
  buildJoinClanModal,
  JOIN_CLAN_BUTTON_ID,
  JOIN_CLAN_CODE_INPUT_ID,
  JOIN_CLAN_MODAL_ID,
} from "./ui.js";

function normalizeCode(raw: string): string {
  return raw.trim().replace(/\s+/g, "");
}

export async function handleJoinClanButton(interaction: ButtonInteraction): Promise<void> {
  if (!interaction.inGuild() || !interaction.guildId) {
    await interaction.reply({ content: "This can only be used in a server.", ephemeral: true });
    return;
  }

  const guildRowId = await getOrCreateGuildRow(pool, interaction.guildId);
  const settings = await getClanSettings(pool, guildRowId);
  if (!settings.enabled) {
    await interaction.reply({
      embeds: [baseEmbed().setTitle("Clan system disabled").setDescription("An admin must enable it first.")],
      ephemeral: true,
    });
    return;
  }

  await interaction.showModal(buildJoinClanModal());
}

export async function handleJoinClanModal(interaction: ModalSubmitInteraction): Promise<void> {
  if (!interaction.inGuild() || !interaction.guildId) {
    await interaction.reply({ content: "This can only be used in a server.", ephemeral: true });
    return;
  }

  const codeRaw = interaction.fields.getTextInputValue(JOIN_CLAN_CODE_INPUT_ID);
  const code = normalizeCode(codeRaw);
  if (!/^\d{4}$/.test(code)) {
    await interaction.reply({
      embeds: [baseEmbed().setTitle("Invalid code").setDescription("Invite code must be exactly **4 digits**.")],
      ephemeral: true,
    });
    return;
  }

  const guildRowId = await getOrCreateGuildRow(pool, interaction.guildId);
  const settings = await getClanSettings(pool, guildRowId);
  if (!settings.enabled) {
    await interaction.reply({
      embeds: [baseEmbed().setTitle("Clan system disabled").setDescription(`Ask an **${ADMIN_ROLE_NAME}** to enable it.`)],
      ephemeral: true,
    });
    return;
  }

  const link = await getLinkByDiscordUser(pool, guildRowId, interaction.user.id);
  if (!link) {
    await interaction.reply({
      embeds: [baseEmbed().setTitle("Not linked").setDescription("Use `/link` first before joining a clan.")],
      ephemeral: true,
    });
    return;
  }

  await deleteExpiredInvites(pool);
  const invite = await findInviteByCode(pool, guildRowId, code);
  if (!invite) {
    await interaction.reply({
      embeds: [baseEmbed().setTitle("Code not found").setDescription("That invite code doesn't exist for this Discord.")],
      ephemeral: true,
    });
    return;
  }

  const expires = new Date(invite.expiresAt).getTime();
  if (Number.isFinite(expires) && Date.now() > expires) {
    await deleteExpiredInvites(pool);
    await interaction.reply({
      embeds: [baseEmbed().setTitle("Invite expired").setDescription("That invite code has expired.")],
      ephemeral: true,
    });
    return;
  }

  const memberCount = await countClanMembers(pool, invite.clanId);
  if (memberCount >= settings.maxMembers) {
    await interaction.reply({
      embeds: [baseEmbed().setTitle("Clan full").setDescription("That clan is already at max capacity.")],
      ephemeral: true,
    });
    return;
  }

  const ownedElsewhere = await getOwnedClanIdInGuild(pool, guildRowId, interaction.user.id);
  if (ownedElsewhere != null && ownedElsewhere !== invite.clanId) {
    const ownedInfo = await getMemberClan(pool, guildRowId, interaction.user.id);
    const name = ownedInfo?.clanName ?? "your clan";
    await interaction.reply({
      embeds: [
        baseEmbed()
          .setTitle("You already lead a clan")
          .setDescription(
            `You are the owner of **${name}**. Transfer ownership with **/clan-promote** or delete the clan with **/clan-delete** before joining another.`
          ),
      ],
      ephemeral: true,
    });
    return;
  }

  const strippedFrom = await removeClanMemberRowsExceptInGuild(pool, guildRowId, interaction.user.id, invite.clanId);
  if (strippedFrom.length > 0 && interaction.guild) {
    const roleByClan = await getDiscordRoleIdsForClanIds(pool, strippedFrom);
    try {
      const mem = await interaction.guild.members.fetch(interaction.user.id);
      for (const cid of strippedFrom) {
        const rid = roleByClan.get(cid);
        if (rid) await mem.roles.remove(rid, "Switch clan — join invite").catch(() => null);
      }
    } catch {
      /* ignore */
    }
  }

  const res = await addClanMember(pool, invite.clanId, interaction.user.id);
  if (res === "already_member") {
    await interaction.reply({
      embeds: [baseEmbed().setTitle("Already joined").setDescription(`You are already in **${invite.clanName}**.`)],
      ephemeral: true,
    });
    return;
  }

  if (interaction.guild && invite.discordRoleId) {
    try {
      const member = await interaction.guild.members.fetch(interaction.user.id);
      await member.roles.add(invite.discordRoleId, "Clan join");
    } catch {
      /* ignore */
    }
  }

  await interaction.reply({
    embeds: [
      baseEmbed()
        .setTitle("Joined!")
        .setDescription(`You have successfully joined the clan **${invite.clanName}**.`),
    ],
    ephemeral: true,
  });

  // Best-effort: add clan tag to nickname now that they're in a clan.
  if (interaction.guild) {
    await syncLinkedNicknameForUser({
      pool,
      guildRowId,
      guild: interaction.guild,
      discordUserId: interaction.user.id,
    }).catch(() => {});
  }

  // Best-effort: update tracked /active-clans message(s) immediately.
  await refreshActiveClansPanelsForGuild(interaction.client, interaction.guildId).catch(() => {});
}

export const clanJoinCustomIds = {
  button: JOIN_CLAN_BUTTON_ID,
  modal: JOIN_CLAN_MODAL_ID,
};

