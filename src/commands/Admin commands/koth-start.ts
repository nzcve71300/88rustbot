import { type ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";
import { memberHasAdminRole } from "../../admin/guildAdmin.js";
import { ADMIN_ROLE_NAME } from "../../constants.js";
import { config } from "../../config.js";
import { decryptSecret } from "../../crypto/passwordVault.js";
import { getOrCreateGuildRow } from "../../db/guilds.js";
import { pool } from "../../db/pool.js";
import {
  countEventMembers,
  getActiveKothEvent,
  getGateCoord,
  getKothConfig,
  startKothEvent,
} from "../../db/koth.js";
import { getRustServerByIdForGuild } from "../../db/rustServers.js";
import { baseEmbed } from "../../embeds/standard.js";
import { parseGateCoordTriple, runKothWaves } from "../../koth/runner.js";
import { notifyGuildWebPush } from "../../push/webPushNotify.js";
import { autocompleteServerOption, validateServerSelection } from "../shared/serverOption.js";

export const kothStartCommand = {
  data: new SlashCommandBuilder()
    .setName("koth-start")
    .setDescription("Start the KOTH match: waves, kits, kill tracking, wave summaries (admin only).")
    .addStringOption((o) =>
      o.setName("server").setDescription("Rust server").setRequired(true).setAutocomplete(true)
    )
    .addIntegerOption((o) =>
      o
        .setName("waves")
        .setDescription("Number of waves")
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
      o.setName("kit_name").setDescription("Kit name as configured on the Rust server").setRequired(true)
    ),

  async autocomplete(interaction: import("discord.js").AutocompleteInteraction) {
    await autocompleteServerOption(interaction, "server");
  },

  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.inGuild() || !interaction.guild || !interaction.member || !interaction.client) {
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

    const serverId = Number.parseInt(interaction.options.getString("server", true), 10);
    const waves = interaction.options.getInteger("waves", true);
    const durationMin = interaction.options.getInteger("duration_minutes", true);
    const kitName = interaction.options.getString("kit_name", true).trim();

    if (!Number.isFinite(serverId) || !(await validateServerSelection(interaction.guild.id, serverId))) {
      await interaction.reply({
        embeds: [baseEmbed().setTitle("Invalid server").setDescription("Pick a server from autocomplete.")],
        ephemeral: true,
      });
      return;
    }

    await interaction.deferReply({ ephemeral: true });

    const guildRowId = await getOrCreateGuildRow(pool, interaction.guild.id);

    const cfg = await getKothConfig(pool, guildRowId, serverId);
    if (!cfg || !cfg.messageId) {
      await interaction.editReply({
        embeds: [baseEmbed().setTitle("Not configured").setDescription("Run `/koth-setup` for this server first.")],
      });
      return;
    }

    const gate1Raw = await getGateCoord(pool, guildRowId, serverId, 1);
    const gate1Xyz = gate1Raw ? parseGateCoordTriple(gate1Raw) : null;
    if (!gate1Xyz) {
      await interaction.editReply({
        embeds: [
          baseEmbed()
            .setTitle("KOTH Gate 1 position required")
            .setDescription(
              "Save **KOTH Gate 1** world coordinates with `/manage-positions` (used for `rf.spawnfakebroadcaster` and teleports)."
            ),
        ],
      });
      return;
    }

    const active = await getActiveKothEvent(pool, guildRowId, serverId);
    if (!active || active.status !== "lobby") {
      await interaction.editReply({
        embeds: [
          baseEmbed()
            .setTitle("No lobby")
            .setDescription("There must be an active **lobby** KOTH (not already running or finished)."),
        ],
      });
      return;
    }

    const members = await countEventMembers(pool, active.id);
    if (members < 1) {
      await interaction.editReply({
        embeds: [baseEmbed().setTitle("No participants").setDescription("At least one player must `/koth-join` first.")],
      });
      return;
    }

    const srv = await getRustServerByIdForGuild(pool, guildRowId, serverId);
    if (!srv) {
      await interaction.editReply({ embeds: [baseEmbed().setTitle("Server not found").setDescription("Invalid Rust server.")] });
      return;
    }

    let password: string;
    try {
      password = decryptSecret(srv.rcon_password_encrypted, config.encryptionKeyHex);
    } catch {
      await interaction.editReply({
        embeds: [baseEmbed().setTitle("RCON error").setDescription("Could not decrypt this server’s RCON password.")],
      });
      return;
    }

    const started = await startKothEvent(pool, active.id, durationMin, waves, kitName);
    if (!started) {
      await interaction.editReply({
        embeds: [
          baseEmbed()
            .setTitle("Could not start")
            .setDescription("The lobby may have changed — try again or check for another running event."),
        ],
      });
      return;
    }

    await interaction.editReply({
      embeds: [
        baseEmbed()
          .setTitle("KOTH started")
          .setDescription(
            `**${srv.nickname}** — **${waves}** wave(s), **${durationMin}** min each, kit **${kitName}**. Wave summaries will post in <#${cfg.announcementChannelId}>.`
          ),
      ],
    });

    void notifyGuildWebPush(pool, guildRowId, serverId, {
      title: "Grindset",
      body: "KOTH Started. Join now!",
      tag: `koth-${active.id}`,
    });

    void runKothWaves({
      client: interaction.client,
      pool,
      guildRowId,
      rustServerId: serverId,
      eventId: active.id,
      announcementChannelId: cfg.announcementChannelId,
      serverNickname: srv.nickname,
      host: srv.server_ip,
      port: srv.rcon_port,
      password,
      waves,
      durationPerWaveMin: durationMin,
      kitName,
      gateFrequency: cfg.gateFrequency,
      gate1Xyz,
    });
  },
};
