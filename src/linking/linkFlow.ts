import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  type ChatInputCommandInteraction,
} from "discord.js";
import { baseEmbed } from "../embeds/standard.js";
import { getOrCreateGuildRow } from "../db/guilds.js";
import { pool } from "../db/pool.js";
import { getLinkByDiscordUser, insertLink } from "../db/links.js";

export const LINK_CONFIRM_ID = "link:confirm";
export const LINK_CANCEL_ID = "link:cancel";

type Pending = { name: string; createdAt: number };
const pending = new Map<string, Pending>();
const PENDING_TTL_MS = 2 * 60 * 1000;

function key(guildId: string, userId: string) {
  return `${guildId}:${userId}`;
}

export function isValidIngameName(name: string): boolean {
  // Allow most unicode symbols/letters/numbers/spaces, but block control chars and extreme length.
  if (name.length < 1 || name.length > 64) return false;
  if (/[\u0000-\u001F\u007F]/.test(name)) return false;
  return true;
}

export async function beginLink(interaction: ChatInputCommandInteraction, name: string) {
  if (!interaction.inGuild() || !interaction.guildId || !interaction.guild) {
    await interaction.reply({ content: "This command can only be used inside a server.", ephemeral: true });
    return;
  }
  const clean = name.trim();
  if (!isValidIngameName(clean)) {
    await interaction.reply({
      embeds: [baseEmbed().setTitle("Invalid name").setDescription("That in-game name is not supported.")],
      ephemeral: true,
    });
    return;
  }

  const guildRowId = await getOrCreateGuildRow(pool, interaction.guildId);
  const existing = await getLinkByDiscordUser(pool, guildRowId, interaction.user.id);
  if (existing) {
    await interaction.reply({
      embeds: [
        baseEmbed()
          .setTitle("Already linked")
          .setDescription(
            [`You’re already linked in this Discord.`, "", `Current in-game name: **\`${existing.ingameName}\`**`, "", `If you need to change it, run \`/unlink\` (admin) then \`/link\` again.`].join(
              "\n"
            )
          ),
      ],
      ephemeral: true,
    });
    return;
  }

  pending.set(key(interaction.guildId, interaction.user.id), { name: clean, createdAt: Date.now() });

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(LINK_CONFIRM_ID).setLabel("Confirm").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(LINK_CANCEL_ID).setLabel("Cancel").setStyle(ButtonStyle.Secondary)
  );

  await interaction.reply({
    embeds: [
      baseEmbed()
        .setTitle("Link your Rust name")
        .setDescription(["Please confirm this is your exact in-game name:", "", `**\`${clean}\`**`, "", "This will be used for events, stats, and brackets."].join("\n")),
    ],
    components: [row],
    ephemeral: true,
  });
}

export async function handleLinkButton(interaction: ButtonInteraction) {
  if (!interaction.inGuild() || !interaction.guildId || !interaction.guild) {
    await interaction.reply({ content: "This can only be used in a server.", ephemeral: true });
    return;
  }
  const k = key(interaction.guildId, interaction.user.id);
  const p = pending.get(k);
  if (!p || Date.now() - p.createdAt > PENDING_TTL_MS) {
    pending.delete(k);
    await interaction.reply({
      embeds: [baseEmbed().setTitle("Expired").setDescription("Start over with `/link`.")],
      ephemeral: true,
    });
    return;
  }

  if (interaction.customId === LINK_CANCEL_ID) {
    pending.delete(k);
    await interaction.update({
      embeds: [baseEmbed().setTitle("Cancelled").setDescription("Run `/link` again when you’re ready.")],
      components: [],
    });
    return;
  }

  if (interaction.customId !== LINK_CONFIRM_ID) return;

  const guildRowId = await getOrCreateGuildRow(pool, interaction.guildId);
  try {
    await insertLink(pool, guildRowId, interaction.user.id, p.name);
  } catch (e: unknown) {
    const code = typeof e === "object" && e && "code" in e ? String((e as { code: string }).code) : "";
    if (code === "ER_DUP_ENTRY") {
      pending.delete(k);
      await interaction.update({
        embeds: [baseEmbed().setTitle("Name taken").setDescription("That in-game name is already linked in this Discord.")],
        components: [],
      });
      return;
    }
    throw e;
  }

  pending.delete(k);

  // Update nickname: 🔗{name}
  try {
    const member = await interaction.guild.members.fetch(interaction.user.id);
    await member.setNickname(`🔗${p.name}`.slice(0, 32), "Linked in-game name");
  } catch {
    // ignore permission failures
  }

  const avatarUrl = interaction.user.displayAvatarURL({ size: 256 });
  const publicEmbed = baseEmbed()
    .setColor(0x5b9fe8)
    .setThumbnail(avatarUrl)
    .setTitle("🔗 Rust profile connected")
    .setDescription(
      [
        `Your in-game identity is now **\`${p.name}\`** on this Discord.`,
        "",
        "**Ready to play** — you can use bot commands, events, and anything here that needs your Rust name.",
      ].join("\n")
    );

  const channel = interaction.channel;
  if (channel && "send" in channel && typeof channel.send === "function") {
    try {
      await channel.send({ embeds: [publicEmbed] });
    } catch {
      await interaction.update({
        embeds: [
          baseEmbed()
            .setTitle("Linked")
            .setThumbnail(avatarUrl)
            .setDescription(`Your Rust name is set to **${p.name}**. (Could not post a public message here — check bot **Send Messages**.)`),
        ],
        components: [],
      });
      return;
    }
  } else {
    await interaction.update({
      embeds: [
        baseEmbed()
          .setTitle("Linked")
          .setThumbnail(avatarUrl)
          .setDescription(`Your Rust name is set to **${p.name}**.`),
      ],
      components: [],
    });
    return;
  }

  await interaction.update({
    embeds: [
      baseEmbed()
        .setTitle("✓ All set")
        .setDescription(`Your link is **${p.name}**. A message was posted for everyone in this channel.`),
    ],
    components: [],
  });
}

