import {
  ChannelType,
  type ChatInputCommandInteraction,
  SlashCommandBuilder,
  TextChannel,
} from "discord.js";
import { memberHasAdminRole } from "../../admin/guildAdmin.js";
import { ADMIN_ROLE_NAME } from "../../constants.js";
import { getOrCreateGuildRow } from "../../db/guilds.js";
import { pool } from "../../db/pool.js";
import { baseEmbed } from "../../embeds/standard.js";
import { listRustServersForGuild } from "../../db/rustServers.js";
import { config } from "../../config.js";
import { decryptSecret } from "../../crypto/passwordVault.js";
import { mergeKothConfig } from "../../db/koth.js";
import { getRustServerByIdForGuild } from "../../db/rustServers.js";
import { renderKothEmbed } from "../../koth/render.js";
import { KOTH_RCON_SETUP, runSayRcon } from "../../rcon/eventBroadcasts.js";
import { autocompleteServerOption } from "../shared/serverOption.js";
import { notifyGuildWebPush } from "../../push/webPushNotify.js";

export const kothSetupCommand = {
  data: new SlashCommandBuilder()
    .setName("koth-setup")
    .setDescription("Configure KOTH (announcements, schedule, waves, kit). Gate coords: /manage-positions.")
    .addStringOption((o) =>
      o
        .setName("server")
        .setDescription("Rust server in this Discord")
        .setRequired(true)
        .setAutocomplete(true)
    )
    .addChannelOption((o) =>
      o
        .setName("announcementchannel")
        .setDescription("Channel to post KOTH message")
        .setRequired(true)
        .addChannelTypes(ChannelType.GuildText)
    )
    .addIntegerOption((o) =>
      o.setName("gates").setDescription("Number of gates (max 20)").setRequired(true).setMinValue(1).setMaxValue(20)
    )
    .addIntegerOption((o) =>
      o
        .setName("gate_frequency")
        .setDescription("4 digit frequency number")
        .setRequired(true)
        .setMinValue(1000)
        .setMaxValue(9999)
    )
    .addIntegerOption((o) =>
      o
        .setName("team_limit")
        .setDescription("Max members per clan (per gate) that can join this KOTH (1–20)")
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(20)
    )
    .addRoleOption((o) => o.setName("announcement_role").setDescription("Role to mention").setRequired(true))
    .addNumberOption((o) =>
      o
        .setName("how_often")
        .setDescription("Hours between automatic KOTH lobbies (same idea as Docked Cargo)")
        .setRequired(true)
        .setMinValue(0.25)
        .setMaxValue(168)
    )
    .addIntegerOption((o) =>
      o
        .setName("waves")
        .setDescription("Number of waves per match")
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(50)
    )
    .addIntegerOption((o) =>
      o
        .setName("duration_minutes")
        .setDescription("Duration of each wave (minutes)")
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(120)
    )
    .addStringOption((o) =>
      o
        .setName("kit_name")
        .setDescription("Kit name as configured on the Rust server")
        .setRequired(true)
    ),

  async autocomplete(interaction: import("discord.js").AutocompleteInteraction) {
    await autocompleteServerOption(interaction, "server");
  },

  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.inGuild() || !interaction.guild || !interaction.member) {
      await interaction.reply({ content: "This command can only be used inside a server.", ephemeral: true });
      return;
    }
    if (!memberHasAdminRole(interaction.member, interaction.guild)) {
      await interaction.reply({ content: `You need the **${ADMIN_ROLE_NAME}** role to use this command.`, ephemeral: true });
      return;
    }

    const serverId = Number.parseInt(interaction.options.getString("server", true), 10);
    const channel = interaction.options.getChannel("announcementchannel", true);
    const gates = interaction.options.getInteger("gates", true);
    const gateFrequency = interaction.options.getInteger("gate_frequency", true);
    const teamLimit = interaction.options.getInteger("team_limit", true);
    const role = interaction.options.getRole("announcement_role", true);
    const howOften = interaction.options.getNumber("how_often", true);
    const waves = interaction.options.getInteger("waves", true);
    const durationMin = interaction.options.getInteger("duration_minutes", true);
    const kitName = interaction.options.getString("kit_name", true).trim();

    if (!(channel instanceof TextChannel)) {
      await interaction.reply({ embeds: [baseEmbed().setTitle("Invalid channel").setDescription("Pick a text channel.")], ephemeral: true });
      return;
    }

    await interaction.deferReply({ ephemeral: true });
    const guildRowId = await getOrCreateGuildRow(pool, interaction.guild.id);
    const servers = await listRustServersForGuild(pool, guildRowId);
    const srv = servers.find((s) => String(s.id) === String(serverId));
    if (!srv) {
      await interaction.editReply({ embeds: [baseEmbed().setTitle("Invalid server").setDescription("Pick a server from autocomplete.") ]});
      return;
    }

    const embed = renderKothEmbed(srv.nickname, srv.nickname, [], null, null);
    const sent = await channel.send({ content: `<@&${role.id}>`, embeds: [embed] });

    await mergeKothConfig(pool, guildRowId, serverId, {
      announcementChannelId: channel.id,
      announcementRoleId: role.id,
      gates,
      gateFrequency,
      teamLimit,
      messageId: sent.id,
      howOftenHours: howOften,
      waves,
      durationPerWaveMin: durationMin,
      kitName,
      automationStarted: false,
      nextLobbyAtMs: null,
    });

    void notifyGuildWebPush(pool, guildRowId, serverId, {
      title: "Grindset",
      body: "KOTH has been configured. Use /koth-start to enable automatic lobbies.",
      tag: `koth-setup-${serverId}`,
    });

    await interaction.editReply({
      embeds: [
        baseEmbed()
          .setTitle("KOTH configured")
          .setDescription(
            `Saved **how often**, **waves**, **duration**, and **kit**. Message posted in ${channel}. ` +
              `Set **KOTH Gate** positions in **/manage-positions**, then run **/koth-start** once to begin automatic lobbies.`
          ),
      ],
    });

    const rustRow = await getRustServerByIdForGuild(pool, guildRowId, serverId);
    if (rustRow) {
      try {
        const rconPassword = decryptSecret(rustRow.rcon_password_encrypted, config.encryptionKeyHex);
        void runSayRcon(rustRow.id, rustRow.server_ip, rustRow.rcon_port, rconPassword, KOTH_RCON_SETUP, "koth-setup");
      } catch (err) {
        console.error("[koth-setup] in-game say failed:", err);
      }
    }
  },
};
