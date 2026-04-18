import type { ChatInputCommandInteraction } from "discord.js";
import { SlashCommandBuilder } from "discord.js";
import { getOrCreateGuildRow } from "../../db/guilds.js";
import { pool } from "../../db/pool.js";
import { getLinkByDiscordUser } from "../../db/links.js";
import { getClanForEventParticipation } from "../../db/clans.js";
import { getOneV1Config, hasActiveOrPendingMatch } from "../../db/onev1.js";
import { discordUserHasAnyActiveEventParticipation, EVENT_JOIN_BLOCKED_MESSAGE } from "../../db/eventParticipation.js";
import { listRustServersForGuild } from "../../db/rustServers.js";
import { autocompleteServerOption, validateServerSelection } from "../shared/serverOption.js";
import { createAndAnnounceOneV1Match } from "../../onev1/matchLifecycle.js";

export const ONEV1_ACCEPT_PREFIX = "onev1_accept:";
export const ONEV1_DUCK_PREFIX = "onev1_duck:";

export const onev1Command = {
  data: new SlashCommandBuilder()
    .setName("onev1")
    .setDescription("Challenge another player to a 1v1 on a Rust server.")
    .addStringOption((o) =>
      o.setName("server").setDescription("Rust server").setRequired(true).setAutocomplete(true)
    )
    .addUserOption((o) => o.setName("opponent").setDescription("The player you want to fight").setRequired(true)),

  async autocomplete(interaction: import("discord.js").AutocompleteInteraction) {
    await autocompleteServerOption(interaction, "server");
  },

  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.inGuild() || !interaction.guild) {
      await interaction.reply({ content: "Use this command in a server.", ephemeral: true });
      return;
    }

    const serverId = Number.parseInt(interaction.options.getString("server", true), 10);
    const opponent = interaction.options.getUser("opponent", true);
    const challenger = interaction.user;

    if (opponent.id === challenger.id) {
      await interaction.reply({ content: "You cannot challenge yourself.", ephemeral: true });
      return;
    }
    if (opponent.bot) {
      await interaction.reply({ content: "Pick a human opponent.", ephemeral: true });
      return;
    }

    if (!Number.isFinite(serverId) || !(await validateServerSelection(interaction.guild.id, serverId))) {
      await interaction.reply({ content: "Invalid server — use autocomplete.", ephemeral: true });
      return;
    }

    await interaction.deferReply({ ephemeral: true });

    const guildRowId = await getOrCreateGuildRow(pool, interaction.guild.id);
    const cfg = await getOneV1Config(pool, guildRowId, serverId);
    if (!cfg) {
      await interaction.editReply({ content: "1v1 is not configured for this server. Ask an admin to run `/onev1-setup`." });
      return;
    }
    if (!cfg.enabled) {
      await interaction.editReply({ content: "1v1 is **disabled** for this server right now." });
      return;
    }

    if (await hasActiveOrPendingMatch(pool, serverId)) {
      await interaction.editReply({
        content: "A 1v1 is already in progress or waiting for acceptance on this server. Please wait.",
      });
      return;
    }

    const [chalBusy, oppBusy] = await Promise.all([
      discordUserHasAnyActiveEventParticipation(pool, guildRowId, challenger.id),
      discordUserHasAnyActiveEventParticipation(pool, guildRowId, opponent.id),
    ]);
    if (chalBusy) {
      await interaction.editReply({ content: EVENT_JOIN_BLOCKED_MESSAGE });
      return;
    }
    if (oppBusy) {
      await interaction.editReply({ content: EVENT_JOIN_BLOCKED_MESSAGE });
      return;
    }

    const [chalLink, oppLink] = await Promise.all([
      getLinkByDiscordUser(pool, guildRowId, challenger.id),
      getLinkByDiscordUser(pool, guildRowId, opponent.id),
    ]);
    if (!chalLink || !oppLink) {
      await interaction.editReply({
        content: "Both players must use `/link` with their in-game name before starting a 1v1.",
      });
      return;
    }

    const [chalClan, oppClan] = await Promise.all([
      getClanForEventParticipation(pool, guildRowId, challenger.id),
      getClanForEventParticipation(pool, guildRowId, opponent.id),
    ]);
    if (!chalClan || !oppClan) {
      await interaction.editReply({ content: "Both players must be in a **clan** to use 1v1." });
      return;
    }

    const announceCh = await interaction.guild.channels.fetch(cfg.announcementChannelId).catch(() => null);
    if (!announceCh || !announceCh.isTextBased() || !("send" in announceCh)) {
      await interaction.editReply({ content: "The configured announcement channel is missing or not text-based." });
      return;
    }

    const servers = await listRustServersForGuild(pool, guildRowId);
    const nick = servers.find((s) => String(s.id) === String(serverId))?.nickname ?? "Server";

    const created = await createAndAnnounceOneV1Match(interaction.client, pool, {
      guildRowId,
      rustServerId: serverId,
      challengerDiscordId: challenger.id,
      opponentDiscordId: opponent.id,
      serverNickname: nick,
      announcementChannelId: cfg.announcementChannelId,
    });
    if (!created.ok) {
      await interaction.editReply({ content: created.error });
      return;
    }

    await interaction.editReply({
      content: `Challenge sent in ${announceCh}. Waiting for ${opponent.username} to accept.`,
    });
  },
};
