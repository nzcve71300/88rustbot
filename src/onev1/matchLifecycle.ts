import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, type Client } from "discord.js";
import type { Pool } from "mysql2/promise";
import { ONEV1_ACCEPT_PREFIX, ONEV1_DUCK_PREFIX } from "../commands/Player Commands/onev1.js";
import type { LinkRow } from "../db/links.js";
import {
  deleteMatch,
  getMatchById,
  getOneV1Config,
  type OneV1ConfigRow,
  type OneV1MatchRow,
  insertPendingMatch,
  setMatchActive,
  updateMatchMessageId,
} from "../db/onev1.js";
import { getLinkByDiscordUser } from "../db/links.js";
import { insertSiteInboxMessage } from "../db/siteInbox.js";
import { notifyDiscordUserWebPushForGuildServer, notifyGuildWebPush } from "../push/webPushNotify.js";
import { runOneV1Match } from "./runner.js";

export type ValidatedOneV1Accept = {
  match: OneV1MatchRow;
  cfg: OneV1ConfigRow;
  chalLink: LinkRow;
  oppLink: LinkRow;
};

async function fetchDisplayName(client: Client, discordUserId: string): Promise<string> {
  try {
    const u = await client.users.fetch(discordUserId);
    return u.globalName ?? u.username;
  } catch {
    return "Opponent";
  }
}

async function editAnnouncementMessage(
  client: Client,
  match: OneV1MatchRow,
  payload: { embeds: EmbedBuilder[]; components?: [] }
): Promise<void> {
  if (!match.messageId) return;
  try {
    const ch = await client.channels.fetch(match.channelId).catch(() => null);
    if (!ch?.isTextBased() || !("messages" in ch)) return;
    const msg = await ch.messages.fetch(match.messageId).catch(() => null);
    if (!msg) return;
    await msg.edit(payload);
  } catch {
    /* message may be gone */
  }
}

export async function createAndAnnounceOneV1Match(
  client: Client,
  pool: Pool,
  opts: {
    guildRowId: number;
    rustServerId: number;
    challengerDiscordId: string;
    opponentDiscordId: string;
    serverNickname: string;
    announcementChannelId: string;
  }
): Promise<{ ok: true; matchId: number } | { ok: false; error: string }> {
  const matchId = await insertPendingMatch(
    pool,
    opts.guildRowId,
    opts.rustServerId,
    opts.challengerDiscordId,
    opts.opponentDiscordId,
    opts.announcementChannelId,
    null
  );

  const embed = new EmbedBuilder()
    .setTitle("⚔️ 1v1 event")
    .setDescription(
      [
        `<@${opts.opponentDiscordId}>, you have been **nominated** by <@${opts.challengerDiscordId}> for a **1v1** on **${opts.serverNickname}**.`,
        "",
        "Make sure you are **online** on the server. If you are ready, press **Accept** below.",
      ].join("\n")
    )
    .setColor(0x5865f2)
    .setFooter({ text: "Best of 3 • Challenger picks the opponent" });

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`${ONEV1_ACCEPT_PREFIX}${matchId}`)
      .setLabel("Accept")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`${ONEV1_DUCK_PREFIX}${matchId}`)
      .setLabel("🦆 Duck")
      .setStyle(ButtonStyle.Secondary)
  );

  const announceCh = await client.channels.fetch(opts.announcementChannelId).catch(() => null);
  if (!announceCh || !announceCh.isTextBased() || !("send" in announceCh)) {
    await deleteMatch(pool, matchId);
    return { ok: false, error: "The configured announcement channel is missing or not text-based." };
  }

  const msg = await announceCh.send({ embeds: [embed], components: [row] });
  await updateMatchMessageId(pool, matchId, msg.id);

  const chName = await fetchDisplayName(client, opts.challengerDiscordId);
  void notifyDiscordUserWebPushForGuildServer(
    pool,
    opts.guildRowId,
    opts.rustServerId,
    opts.opponentDiscordId,
    {
      title: "Grindset — 1v1 nomination",
      body: `${chName} nominated you for a 1v1 on ${opts.serverNickname}. Open the site or Discord to accept or duck.`,
      tag: `onev1-nominate-${matchId}`,
    }
  );

  return { ok: true, matchId };
}

export async function validateOneV1Accept(
  pool: Pool,
  matchId: number,
  actorDiscordId: string
): Promise<{ ok: true; data: ValidatedOneV1Accept } | { ok: false; error: string }> {
  const match = await getMatchById(pool, matchId);
  if (!match || match.status !== "pending") {
    return { ok: false, error: "This challenge is no longer available." };
  }
  if (actorDiscordId !== match.opponentDiscordId) {
    return { ok: false, error: "Only the nominated opponent can accept." };
  }
  const cfg = await getOneV1Config(pool, match.guildId, match.rustServerId);
  if (!cfg || !cfg.enabled) {
    return { ok: false, error: "1v1 is disabled for this server." };
  }
  const [chalLink, oppLink] = await Promise.all([
    getLinkByDiscordUser(pool, match.guildId, match.challengerDiscordId),
    getLinkByDiscordUser(pool, match.guildId, match.opponentDiscordId),
  ]);
  if (!chalLink || !oppLink) {
    return { ok: false, error: "Both players must remain linked." };
  }
  return { ok: true, data: { match, cfg, chalLink, oppLink } };
}

export async function commitOneV1Accept(client: Client, pool: Pool, data: ValidatedOneV1Accept): Promise<void> {
  const { match, cfg, chalLink, oppLink } = data;
  const matchId = match.id;

  await setMatchActive(pool, matchId);

  void notifyGuildWebPush(pool, match.guildId, match.rustServerId, {
    title: "Grindset",
    body: "1v1 Started. Join now!",
    tag: `onev1-${matchId}`,
  });

  await editAnnouncementMessage(client, match, {
    embeds: [
      new EmbedBuilder()
        .setTitle("⚔️ 1v1 —Bo3— accepted")
        .setDescription(`<@${match.opponentDiscordId}> accepted. Match is starting…`)
        .setColor(0x57f287),
    ],
    components: [],
  });

  const oppName = await fetchDisplayName(client, match.opponentDiscordId);
  void insertSiteInboxMessage(
    pool,
    match.challengerDiscordId,
    "onev1_accepted",
    "1v1 accepted",
    `${oppName} accepted your 1v1 challenge.`,
    { matchId, rustServerId: match.rustServerId }
  ).catch(() => {});

  void notifyDiscordUserWebPushForGuildServer(pool, match.guildId, match.rustServerId, match.challengerDiscordId, {
    title: "Grindset — 1v1",
    body: `${oppName} accepted your 1v1 challenge.`,
    tag: `onev1-accepted-${matchId}`,
  });

  void runOneV1Match({
    client,
    pool,
    guildRowId: match.guildId,
    rustServerId: match.rustServerId,
    matchId,
    announcementChannelId: cfg.announcementChannelId,
    challengerDiscordId: match.challengerDiscordId,
    opponentDiscordId: match.opponentDiscordId,
    challengerIngame: chalLink.ingameName,
    opponentIngame: oppLink.ingameName,
    kitName: cfg.kitName,
    gateFrequency: cfg.gateFrequency,
  }).catch((err) => console.error("[1v1] match failed:", err));
}

export async function validateOneV1Duck(
  pool: Pool,
  matchId: number,
  actorDiscordId: string
): Promise<{ ok: true; match: OneV1MatchRow } | { ok: false; error: string }> {
  const match = await getMatchById(pool, matchId);
  if (!match || match.status !== "pending") {
    return { ok: false, error: "This challenge is no longer available." };
  }
  if (actorDiscordId !== match.opponentDiscordId) {
    return { ok: false, error: "Only the nominated opponent can duck this challenge." };
  }
  return { ok: true, match };
}

export async function commitOneV1Duck(client: Client, pool: Pool, match: OneV1MatchRow): Promise<void> {
  const matchId = match.id;
  await deleteMatch(pool, matchId);

  await editAnnouncementMessage(client, match, {
    embeds: [
      new EmbedBuilder().setDescription(`<@${match.opponentDiscordId}> ducked the 1v1`).setColor(0xed4245),
    ],
    components: [],
  });

  const oppName = await fetchDisplayName(client, match.opponentDiscordId);
  void insertSiteInboxMessage(
    pool,
    match.challengerDiscordId,
    "onev1_ducked",
    "1v1 declined",
    `${oppName} ducked your 1v1 challenge.`,
    { matchId, rustServerId: match.rustServerId }
  ).catch(() => {});

  void notifyDiscordUserWebPushForGuildServer(pool, match.guildId, match.rustServerId, match.challengerDiscordId, {
    title: "Grindset — 1v1",
    body: `${oppName} ducked your 1v1 challenge.`,
    tag: `onev1-ducked-${matchId}`,
  });
}
