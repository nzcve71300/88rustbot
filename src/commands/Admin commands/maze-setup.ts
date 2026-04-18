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
import { ensureLobbyMazeForJoin, MAZE_MAX_SPAWN_POINTS, upsertMazeConfig } from "../../db/maze.js";
import { getRustServerByIdForGuild, listRustServersForGuild } from "../../db/rustServers.js";
import { baseEmbed } from "../../embeds/standard.js";
import { renderMazeEmbed } from "../../maze/render.js";
import { MAZE_RCON_SETUP, runSayRcon } from "../../rcon/eventBroadcasts.js";
import { autocompleteServerOption } from "../shared/serverOption.js";
import { notifyGuildWebPush } from "../../push/webPushNotify.js";

export const mazeSetupCommand = {
  data: new SlashCommandBuilder()
    .setName("maze-setup")
    .setDescription("Configure the Maze Event announcement for a Rust server (admin only).")
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

    await upsertMazeConfig(pool, guildRowId, serverId, channel.id, role.id, spawnPoints, sent.id);

    // Create the lobby immediately so the website shows "Pending" right after setup (even with 0 joined).
    await ensureLobbyMazeForJoin(pool, guildRowId, serverId);

    void notifyGuildWebPush(pool, guildRowId, serverId, {
      title: "Grindset",
      body: "Maze lobby is open. Join now!",
      tag: `maze-lobby-setup`,
    });

    await interaction.editReply({
      embeds: [
        baseEmbed()
          .setTitle("Maze Event configured")
          .setDescription(
            `Announcement posted in ${channel} with **${spawnPoints}** spawn slot(s). Use **/manage-positions maze-spawn** to save coordinates, then **/maze-start** when ready.`
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
