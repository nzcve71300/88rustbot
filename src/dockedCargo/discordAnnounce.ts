import { Client, TextChannel } from "discord.js";
import { baseEmbed } from "../embeds/standard.js";

export async function announceDockedCargoEvent(
  client: Client,
  channelId: string,
  roleId: string | null,
  title: string,
  description: string
): Promise<void> {
  try {
    const ch = await client.channels.fetch(channelId);
    if (!ch || !(ch instanceof TextChannel)) return;
    const content = roleId ? `<@&${roleId}>` : undefined;
    await ch.send({
      content,
      embeds: [baseEmbed().setTitle(title).setDescription(description)],
      allowedMentions: roleId ? { roles: [roleId] } : { parse: [] },
    });
  } catch (e) {
    console.error("[docked-cargo] Discord announcement failed:", e);
  }
}
