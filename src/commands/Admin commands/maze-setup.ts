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
import { config } from "../../config.js";
import { decryptSecret } from "../../crypto/passwordVault.js";
import { MAZE_MAX_SPAWN_POINTS, mergeMazeConfig } from "../../db/maze.js";
import { getRustServerByIdForGuild, listRustServersForGuild } from "../../db/rustServers.js";
import { baseEmbed } from "../../embeds/standard.js";
import { renderMazeEmbed } from "../../maze/render.js";
import { MAZE_RCON_SETUP, runSayRcon } from "../../rcon/eventBroadcasts.js";
import { autocompleteServerOption } from "../shared/serverOption.js";
import { notifyGuildWebPush } from "../../push/webPushNotify.js";

export const mazeSetupCommand = {
  data: new SlashCommandBuilder()
    .setName("maze-setup")
    .setDescription("Configure the Maze Event (announcements, schedule, duration, kit, respawn). Coords: /manage-positions.")
    .addStringOption((o) =>
      o.setName("server").setDescription("Rust server").setRequired(true).setAutocomplete(true)
    )
    .addChannelOption((o) =>
      o
        .setName("announcement_channel")
        .setDescription("Channel for the live Maze message")
        .setRequired(true)
        .addChannelTypes(ChannelType.GuildText)
    )
    .addIntegerOption((o) =>
      o
        .setName("spawn_points")
        .setDescription("How many Maze spawn slots (1–10)")
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(MAZE_MAX_SPAWN_POINTS)
    )
    .addRoleOption((o) =>
      o.setName("announcement_role").setDescription("Role to mention on the announcement").setRequired(true)
    )
    .addNumberOption((o) =>
      o
        .setName("how_often")
        .setDescription("Hours between automatic maze lobbies (same idea as KOTH / Docked Cargo)")
        .setRequired(true)
        .setMinValue(0.25)
        .setMaxValue(168)
    )
    .addIntegerOption((o) =>
      o
        .setName("duration_minutes")
        .setDescription("Match length in minutes (when the maze run starts)")
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(180)
    )
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
    const channel = interaction.options.getChannel("announcement_channel", true);
    const spawnPoints = interaction.options.getInteger("spawn_points", true);
    const role = interaction.options.getRole("announcement_role", true);
    const howOften = interaction.options.getNumber("how_often", true);
    const durationMin = interaction.options.getInteger("duration_minutes", true);
    const respawnRaw = interaction.options.getString("respawn", true);
    const kitName = interaction.options.getString("kit_name", true).trim();

    if (!(channel instanceof TextChannel)) {
      await interaction.reply({
        embeds: [baseEmbed().setTitle("Invalid channel").setDescription("Pick a text channel.")],
        ephemeral: true,
      });
      return;
    }

    await interaction.deferReply({ ephemeral: true });
    const guildRowId = await getOrCreateGuildRow(pool, interaction.guild.id);
    const servers = await listRustServersForGuild(pool, guildRowId);
    const srv = servers.find((s) => String(s.id) === String(serverId));
    if (!srv) {
      await interaction.editReply({
        embeds: [baseEmbed().setTitle("Invalid server").setDescription("Pick a server from autocomplete.")],
      });
      return;
    }

    const embed = renderMazeEmbed(srv.nickname, srv.nickname, [], null, null);
    const sent = await channel.send({ content: `<@&${role.id}>`, embeds: [embed] });

    await mergeMazeConfig(pool, guildRowId, serverId, {
      announcementChannelId: channel.id,
      announcementRoleId: role.id,
      spawnPoints,
      messageId: sent.id,
      howOftenHours: howOften,
      durationMinutes: durationMin,
      kitName,
      respawnEnabled: respawnRaw === "yes",
      automationStarted: false,
      nextLobbyAtMs: null,
    });

    void notifyGuildWebPush(pool, guildRowId, serverId, {
      title: "Grindset",
      body: "Maze has been configured. Use /maze-start to enable automatic lobbies.",
      tag: `maze-setup-${serverId}`,
    });

    await interaction.editReply({
      embeds: [
        baseEmbed()
          .setTitle("Maze Event configured")
          .setDescription(
            `Saved **how often**, **duration**, **kit**, and **respawn** mode. Message posted in ${channel}. ` +
              `Save **maze-spawn** positions in **/manage-positions**, then run **/maze-start** once to begin automatic lobbies.`
          ),
      ],
    });

    const rustRow = await getRustServerByIdForGuild(pool, guildRowId, serverId);
    if (rustRow) {
      try {
        const rconPassword = decryptSecret(rustRow.rcon_password_encrypted, config.encryptionKeyHex);
        void runSayRcon(rustRow.id, rustRow.server_ip, rustRow.rcon_port, rconPassword, MAZE_RCON_SETUP, "maze-setup");
      } catch (err) {
        console.error("[maze-setup] in-game say failed:", err);
      }
    }
  },
};
