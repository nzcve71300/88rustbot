import { type ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";
import { memberHasAdminRole } from "../../admin/guildAdmin.js";
import { ADMIN_ROLE_NAME } from "../../constants.js";
import { config } from "../../config.js";
import { decryptSecret } from "../../crypto/passwordVault.js";
import { getOrCreateGuildRow } from "../../db/guilds.js";
import { pool } from "../../db/pool.js";
import {
  countMazeEventMembers,
  getActiveMazeEvent,
  getMazeConfig,
  listMissingMazeSpawnCoords,
  startMazeEvent,
} from "../../db/maze.js";
import { getRustServerByIdForGuild } from "../../db/rustServers.js";
import { baseEmbed } from "../../embeds/standard.js";
import { runMazeEvent } from "../../maze/runner.js";
import { notifyGuildWebPush } from "../../push/webPushNotify.js";
import { autocompleteServerOption, validateServerSelection } from "../shared/serverOption.js";

export const mazeStartCommand = {
  data: new SlashCommandBuilder()
    .setName("maze-start")
    .setDescription("Start the Maze Event (kits, teleports, duration, kill tracking) (admin only).")
    .addStringOption((o) => o.setName("server").setDescription("Rust server").setRequired(true).setAutocomplete(true))
    .addStringOption((o) =>
      o
        .setName("respawn")
        .setDescription("Can players respawn / stay in after dying?")
        .setRequired(true)
        .addChoices(
          { name: "Yes — eliminations off (stay in roster)", value: "yes" },
          { name: "No — one life (removed from event on death)", value: "no" }
        )
    )
    .addIntegerOption((o) =>
      o
        .setName("duration_minutes")
        .setDescription("Event length in minutes")
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(180)
    )
    .addStringOption((o) => o.setName("kit_name").setDescription("Kit name on the Rust server").setRequired(true)),

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
    const respawnRaw = interaction.options.getString("respawn", true);
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

    const cfg = await getMazeConfig(pool, guildRowId, serverId);
    if (!cfg || !cfg.messageId) {
      await interaction.editReply({
        embeds: [baseEmbed().setTitle("Not configured").setDescription("Run **/maze-setup** for this server first.")],
      });
      return;
    }

    const active = await getActiveMazeEvent(pool, guildRowId, serverId);
    if (!active || active.status !== "lobby") {
      await interaction.editReply({
        embeds: [
          baseEmbed()
            .setTitle("No lobby")
            .setDescription("There must be an active **lobby** (players joined via **/maze-join**)."),
        ],
      });
      return;
    }

    const members = await countMazeEventMembers(pool, active.id);
    if (members < 1) {
      await interaction.editReply({
        embeds: [baseEmbed().setTitle("No players").setDescription("At least one player must **/maze-join** first.")],
      });
      return;
    }

    const missingCoords = await listMissingMazeSpawnCoords(pool, guildRowId, serverId, cfg.spawnPoints);
    if (missingCoords.length > 0) {
      await interaction.editReply({
        embeds: [
          baseEmbed()
            .setTitle("Missing maze spawn coordinates")
            .setDescription(
              [
                `Save world coordinates for **every** slot **1–${cfg.spawnPoints}** in **/manage-positions** → **maze-spawn** before starting.`,
                "",
                `**Missing (spawn points):** ${missingCoords.join(", ")}`,
              ].join("\n")
            ),
        ],
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

    const respawnEnabled = respawnRaw === "yes";
    const started = await startMazeEvent(pool, active.id, durationMin, kitName, respawnEnabled);
    if (!started) {
      await interaction.editReply({
        embeds: [baseEmbed().setTitle("Could not start").setDescription("The lobby may have changed — try again.")],
      });
      return;
    }

    await interaction.editReply({
      embeds: [
        baseEmbed()
          .setTitle("Maze Event started")
          .setDescription(
            [
              `**${srv.nickname}**`,
              `**Duration:** ${durationMin} min`,
              `**Kit:** ${kitName}`,
              `**Respawn mode:** ${respawnEnabled ? "Yes — deaths keep you in the event" : "No — one life (removed on death)"}`,
              "",
              `Results will post in <#${cfg.announcementChannelId}> when time is up.`,
            ].join("\n")
          ),
      ],
    });

    void notifyGuildWebPush(pool, guildRowId, serverId, {
      title: "Grindset",
      body: "Maze Started. Join now!",
      tag: `maze-${active.id}`,
    });

    void runMazeEvent({
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
      durationMinutes: durationMin,
      kitName,
      spawnPointCount: cfg.spawnPoints,
    });
  },
};
