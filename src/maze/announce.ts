import type { Client } from "discord.js";
import { renderMazeEmbed } from "./render.js";
import type { MazeSpawnView } from "../db/maze.js";

export async function updateMazeMessage(
  client: Client,
  announcementChannelId: string,
  messageId: string,
  serverName: string,
  serverNickname: string,
  spawns: MazeSpawnView[],
  durationMinutes: number | null,
  countdownEndsAtMs: number | null
) {
  const channel = await client.channels.fetch(announcementChannelId);
  if (!channel || !channel.isTextBased() || !("messages" in channel)) return;
  const msg = await channel.messages.fetch(messageId).catch(() => null);
  if (!msg) return;
  await msg.edit({ embeds: [renderMazeEmbed(serverName, serverNickname, spawns, durationMinutes, countdownEndsAtMs)] });
}
