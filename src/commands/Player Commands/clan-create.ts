import { type ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";
import { baseEmbed } from "../../embeds/standard.js";
import { getOrCreateGuildRow } from "../../db/guilds.js";
import { pool } from "../../db/pool.js";
import { getClanSettings, getMemberClan, createClan } from "../../db/clans.js";
import { autocompleteServerOption, validateServerSelection } from "../shared/serverOption.js";
import { ensureClanSystemEnabled } from "../../clans/guard.js";
import { createClanRole, createPrivateClanChannel, ensureClansCategory } from "../../clans/discordAssets.js";

const TAG_RE = /^[A-Za-z]{4}$/;

/** Embed accent to match the chosen clan theme. */
const CLAN_THEME_EMBED_COLOR: Record<string, number> = {
  red: 0xe53935,
  orange: 0xfb8c00,
  yellow: 0xfdd835,
  green: 0x43a047,
  blue: 0x1e88e5,
  purple: 0x8e24aa,
  black: 0x424242,
  white: 0xe0e0e0,
  brown: 0x6d4c41,
  pink: 0xec407a,
  cyan: 0x00acc1,
  lime: 0x9ccc65,
};

function clanThemeLabel(color: string): string {
  const labels: Record<string, string> = {
    red: "🟥 Crimson",
    orange: "🟧 Amber",
    yellow: "🟨 Gold",
    green: "🟩 Forest",
    blue: "🟦 Ocean",
    purple: "🟪 Royal",
    black: "⬛ Onyx",
    white: "⬜ Pearl",
    brown: "🟫 Walnut",
    pink: "🩷 Rose",
    cyan: "🩵 Aqua",
    lime: "🌿 Lime",
  };
  return labels[color] ?? color;
}

const COLOR_CHOICES = [
  { name: "🟥 Red", value: "red" },
  { name: "🟧 Orange", value: "orange" },
  { name: "🟨 Yellow", value: "yellow" },
  { name: "🟩 Green", value: "green" },
  { name: "🟦 Blue", value: "blue" },
  { name: "🟪 Purple", value: "purple" },
  { name: "⬛ Black", value: "black" },
  { name: "⬜ White", value: "white" },
  { name: "🟫 Brown", value: "brown" },
  { name: "🩷 Pink", value: "pink" },
  { name: "🩵 Cyan", value: "cyan" },
  { name: "🌿 Lime", value: "lime" },
] as const;

export const clanCreateCommand = {
  data: new SlashCommandBuilder()
    .setName("clan-create")
    .setDescription("Create a clan (per Discord server).")
    .addStringOption((o) =>
      o
        .setName("server")
        .setDescription("Select a configured Rust server in this Discord (validation only).")
        .setRequired(true)
        .setAutocomplete(true)
    )
    .addStringOption((o) =>
      o
        .setName("clan_name")
        .setDescription("Name of your clan.")
        .setRequired(true)
        .setMaxLength(64)
    )
    .addStringOption((o) =>
      o
        .setName("tag")
        .setDescription("4-letter clan tag.")
        .setRequired(true)
        .setMinLength(4)
        .setMaxLength(4)
    )
    .addStringOption((o) =>
      o
        .setName("color")
        .setDescription("Clan color.")
        .setRequired(true)
        .addChoices(...COLOR_CHOICES)
    ),

  async autocomplete(interaction: import("discord.js").AutocompleteInteraction) {
    await autocompleteServerOption(interaction, "server");
  },

  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.inGuild() || !interaction.guildId) {
      await interaction.reply({ content: "This command can only be used inside a server." });
      return;
    }

    const serverId = Number.parseInt(interaction.options.getString("server", true), 10);
    if (!Number.isFinite(serverId) || serverId < 1 || !(await validateServerSelection(interaction.guildId, serverId))) {
      await interaction.reply({
        embeds: [baseEmbed().setTitle("Invalid server").setDescription("Pick a server from autocomplete.")],
        ephemeral: true,
      });
      return;
    }

    const clanName = interaction.options.getString("clan_name", true).trim();
    const tagRaw = interaction.options.getString("tag", true).trim();
    const tag = tagRaw.toUpperCase();
    const color = interaction.options.getString("color", true);

    if (!clanName) {
      await interaction.reply({ embeds: [baseEmbed().setTitle("Invalid name").setDescription("Clan name can't be empty.")] });
      return;
    }
    if (!TAG_RE.test(tag)) {
      await interaction.reply({
        embeds: [baseEmbed().setTitle("Invalid tag").setDescription("Tag must be **exactly 4 letters** (A-Z).")],
      });
      return;
    }

    await interaction.deferReply();

    const guard = await ensureClanSystemEnabled(interaction);
    if (!guard.ok) return;
    const guildRowId = guard.guildRowId;

    const existing = await getMemberClan(pool, guildRowId, interaction.user.id);
    if (existing) {
      await interaction.editReply({
        embeds: [
          baseEmbed()
            .setTitle("Already in a clan")
            .setDescription(`You are already in **${existing.clanName}**. Leave it before creating a new clan.`),
        ],
      });
      return;
    }

    if (!interaction.guild) {
      await interaction.editReply({ embeds: [baseEmbed().setTitle("Error").setDescription("Guild not available.")] });
      return;
    }

    const role = await createClanRole(interaction.guild, clanName, color);
    const category = await ensureClansCategory(interaction.guild);
    const channel = await createPrivateClanChannel(interaction.guild, category, clanName, role);

    try {
      const member = await interaction.guild.members.fetch(interaction.user.id);
      await member.roles.add(role, "Clan owner role grant");
    } catch {
      // ignore — bot may not have permission; DB still records role for later.
    }

    try {
      await createClan(pool, guildRowId, {
        name: clanName,
        tag,
        color,
        ownerDiscordUserId: interaction.user.id,
        discordRoleId: role.id,
        discordChannelId: channel.id,
      });
    } catch (e: unknown) {
      const code = typeof e === "object" && e && "code" in e ? String((e as { code: string }).code) : "";
      if (code === "ER_DUP_ENTRY") {
        try {
          await channel.delete("Rolling back duplicate clan create");
        } catch {}
        try {
          await role.delete("Rolling back duplicate clan create");
        } catch {}
        await interaction.editReply({
          embeds: [
            baseEmbed()
              .setTitle("Name or tag taken")
              .setDescription("That **clan name** or **tag** is already used in this Discord. Pick a different one."),
          ],
        });
        return;
      }
      throw e;
    }

    const accent = CLAN_THEME_EMBED_COLOR[color] ?? 0xffffcc;
    await interaction.editReply({
      embeds: [
        baseEmbed()
          .setColor(accent)
          .setAuthor({
            name: "New clan founded",
            iconURL: interaction.user.displayAvatarURL({ size: 128 }),
          })
          .setTitle("🛡️ Your clan is live")
          .setDescription(
            [
              `**${clanName}** · \`${tag}\``,
              "",
              "Your private channel and role are ready — rally the team and make it yours.",
            ].join("\n")
          )
          .addFields(
            {
              name: "🎨 Theme",
              value: clanThemeLabel(color),
              inline: true,
            },
            {
              name: "👑 Clan lead",
              value: `<@${interaction.user.id}>`,
              inline: true,
            }
          )
          .setTimestamp(),
      ],
    });
  },
};

