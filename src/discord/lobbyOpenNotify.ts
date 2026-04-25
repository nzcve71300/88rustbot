import type { Client, EmbedBuilder } from "discord.js";

/** New message + optional role ping so members get notified (edits alone do not notify). */
export async function sendAutomatedLobbyOpenPing(
  client: Client,
  channelId: string,
  roleId: string | null | undefined,
  embed: EmbedBuilder
): Promise<void> {
  const ch = await client.channels.fetch(channelId).catch(() => null);
  if (!ch?.isTextBased?.() || !("send" in ch)) {
    console.warn("[automated-lobby] cannot fetch announcement channel", channelId);
    return;
  }
  const rid = roleId != null && String(roleId).trim() !== "" ? String(roleId).trim() : null;
  try {
    await ch.send({
      content: rid ? `<@&${rid}>` : undefined,
      embeds: [embed],
      allowedMentions: rid ? { roles: [rid] } : undefined,
    });
  } catch (e) {
    console.error("[automated-lobby] failed to send lobby-open ping:", e);
  }
}
