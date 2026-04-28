import {
  type ChatInputCommandInteraction,
  SlashCommandBuilder,
} from "discord.js";
import { memberHasAdminRole } from "../../admin/guildAdmin.js";
import { ADMIN_ROLE_NAME } from "../../constants.js";
import { baseEmbed } from "../../embeds/standard.js";
import { getOrCreateGuildRow } from "../../db/guilds.js";
import { pool } from "../../db/pool.js";
import { getLinkByDiscordUser, insertLink } from "../../db/links.js";
import { isValidIngameName } from "../../linking/linkFlow.js";
import { syncLinkedNicknameForUser } from "../../clans/nicknames.js";
import { optInNicknameSync } from "../../db/nicknameSync.js";

export const forceLinkCommand = {
  data: new SlashCommandBuilder()
    .setName("force-link")
    .setDescription("Force link a member to an in-game name (admin only).")
    .addUserOption((o) =>
      o.setName("discord_user").setDescription("Discord user to link").setRequired(true)
    )
    .addStringOption((o) =>
      o
        .setName("name")
        .setDescription("Their in-game name (exact).")
        .setRequired(true)
        .setMaxLength(64)
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.inGuild() || !interaction.guildId || !interaction.guild || !interaction.member) {
      await interaction.reply({ content: "This command can only be used inside a server.", ephemeral: true });
      return;
    }
    if (!memberHasAdminRole(interaction.member, interaction.guild)) {
      await interaction.reply({
        content: `You need the **${ADMIN_ROLE_NAME}** role to use this command.`,
        ephemeral: true,
      });
      return;
    }

    const target = interaction.options.getUser("discord_user", true);
    const nameRaw = interaction.options.getString("name", true);
    const clean = nameRaw.trim();
    if (!isValidIngameName(clean)) {
      await interaction.reply({
        embeds: [baseEmbed().setTitle("Invalid name").setDescription("That in-game name is not supported.")],
        ephemeral: true,
      });
      return;
    }

    await interaction.deferReply({ ephemeral: true });

    const guildRowId = await getOrCreateGuildRow(pool, interaction.guildId);
    const existing = await getLinkByDiscordUser(pool, guildRowId, target.id);
    if (existing) {
      await interaction.editReply({
        embeds: [
          baseEmbed()
            .setTitle("Already linked")
            .setDescription(
              [
                `That user is already linked in this Discord.`,
                "",
                `Current in-game name: **\`${existing.ingameName}\`**`,
                "",
                `Unlink them first with \`/unlink\`, then retry \`/force-link\`.`,
              ].join("\n")
            ),
        ],
      });
      return;
    }

    try {
      await insertLink(pool, guildRowId, target.id, clean);
    } catch (e: unknown) {
      const code = typeof e === "object" && e && "code" in e ? String((e as { code: string }).code) : "";
      if (code === "ER_DUP_ENTRY") {
        await interaction.editReply({
          embeds: [baseEmbed().setTitle("Name taken").setDescription("That in-game name is already linked in this Discord.")],
        });
        return;
      }
      throw e;
    }

    // New link => enable auto nickname sync going forward.
    await optInNicknameSync(pool, guildRowId, target.id).catch(() => {});

    // Update nickname: linked name (+ clan tag if in clan).
    await syncLinkedNicknameForUser({
      pool,
      guildRowId,
      guild: interaction.guild,
      discordUserId: target.id,
      force: true,
    }).catch(() => {});

    // Public announcement (exactly like /link style, with forced-link header).
    const avatarUrl = target.displayAvatarURL({ size: 256 });
    const publicEmbed = baseEmbed()
      .setColor(0x5b9fe8)
      .setThumbnail(avatarUrl)
      .setTitle("🔒Force link completed!")
      .setDescription(
        [
          "🔗 Rust profile connected",
          `Your in-game identity is now **\`${clean}\`** on this Discord.`,
          "",
          "**Ready to play** — you can use bot commands, events, and anything here that needs your Rust name.",
        ].join("\n")
      );

    const channel = interaction.channel;
    if (channel && "send" in channel && typeof channel.send === "function") {
      try {
        await channel.send({ embeds: [publicEmbed] });
      } catch {
        await interaction.editReply({
          embeds: [
            baseEmbed()
              .setTitle("Force link completed")
              .setThumbnail(avatarUrl)
              .setDescription(
                `Linked <@${target.id}> to **\`${clean}\`**. (Could not post a public message here — check bot **Send Messages**.)`
              ),
          ],
        });
        return;
      }
    }

    await interaction.editReply({
      embeds: [
        baseEmbed()
          .setTitle("✓ All set")
          .setDescription(`Force-linked <@${target.id}> to **\`${clean}\`**. A message was posted for everyone in this channel.`),
      ],
    });
  },
};

