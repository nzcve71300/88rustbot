import type { Client } from "discord.js";
import { baseEmbed } from "../embeds/standard.js";
import { renderKothEmbed } from "./render.js";
import type { GateView } from "./render.js";

export async function updateKothMessage(
  client: Client,
  announcementChannelId: string,
  messageId: string,
  serverName: string,
  serverNickname: string,
  gates: GateView[],
  eventNumber?: number | null,
  countdownEndsAtMs?: number | null
) {
  const channel = await client.channels.fetch(announcementChannelId);
  if (!channel || !channel.isTextBased() || !("messages" in channel)) return;
  const msg = await channel.messages.fetch(messageId).catch(() => null);
  if (!msg) return;
  await msg.edit({ embeds: [renderKothEmbed(serverName, serverNickname, gates, eventNumber, countdownEndsAtMs)] });
}

export async function sendKothInfo(client: Client, channelId: string, text: string) {
  const channel = await client.channels.fetch(channelId);
  if (!channel || !channel.isTextBased() || !("send" in channel)) return;
  await (channel as { send: (arg: unknown) => Promise<unknown> }).send({
    embeds: [baseEmbed().setTitle("KOTH").setDescription(text)],
  });
}

