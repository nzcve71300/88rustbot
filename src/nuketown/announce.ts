import type { Client } from "discord.js";
import { renderNuketownEmbed, type NuketownTeamView } from "./render.js";

export async function updateNuketownMessage(
  client: Client,
  announcementChannelId: string,
  messageId: string,
  serverName: string,
  serverNickname: string,
  teams: NuketownTeamView[],
  lobbyEndsAtMs: number | null,
  teamLimit: number,
  eventNumber?: number | null
): Promise<void> {
  const channel = await client.channels.fetch(announcementChannelId);
  if (!channel || !channel.isTextBased() || !("messages" in channel)) return;
  const msg = await channel.messages.fetch(messageId).catch(() => null);
  if (!msg) return;
  await msg.edit({ embeds: [renderNuketownEmbed(serverName, serverNickname, teams, lobbyEndsAtMs, teamLimit, eventNumber)] });
}

