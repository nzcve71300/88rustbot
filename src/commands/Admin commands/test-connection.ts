import {
  type AutocompleteInteraction,
  type ChatInputCommandInteraction,
  SlashCommandBuilder,
} from "discord.js";
import { memberHasAdminRole } from "../../admin/guildAdmin.js";
import { ADMIN_ROLE_NAME, BOT_DISPLAY_NAME } from "../../constants.js";
import { config } from "../../config.js";
import { decryptSecret } from "../../crypto/passwordVault.js";
import { getOrCreateGuildRow } from "../../db/guilds.js";
import { getRustServerByIdForGuild, listRustServersForGuild } from "../../db/rustServers.js";
import { pool } from "../../db/pool.js";
import { baseEmbed } from "../../embeds/standard.js";
import { runWebRconCommand } from "../../rcon/webrcon.js";

const SAY_TEST =
  "global.say <b><size=45><color=#22C55E>Your server is connected!</color>";

export const testConnectionCommand = {
  data: new SlashCommandBuilder()
    .setName("test-connection")
    .setDescription("Send a test in-game message over WebRcon to verify the connection.")
    .addStringOption((o) =>
      o
        .setName("server")
        .setDescription("Rust server registered in this Discord")
        .setRequired(true)
        .setAutocomplete(true)
    ),

  async autocomplete(interaction: AutocompleteInteraction) {
    if (!interaction.inGuild() || !interaction.guildId) {
      await interaction.respond([]);
      return;
    }

    const guildRowId = await getOrCreateGuildRow(pool, interaction.guildId);
    const servers = await listRustServersForGuild(pool, guildRowId);
    const focused = interaction.options.getFocused(true);
    if (focused.name !== "server") {
      await interaction.respond([]);
      return;
    }

    const q = focused.value.toLowerCase();
    const picked = servers
      .filter((s) => s.nickname.toLowerCase().includes(q))
      .slice(0, 25);

    await interaction.respond(
      picked.map((s) => ({
        name: s.nickname.length > 100 ? `${s.nickname.slice(0, 97)}...` : s.nickname,
        value: String(s.id),
      }))
    );
  },

  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.inGuild() || !interaction.guild || !interaction.member) {
      await interaction.reply({
        content: "This command can only be used inside a server.",
        ephemeral: true,
      });
      return;
    }

    if (!memberHasAdminRole(interaction.member, interaction.guild)) {
      await interaction.reply({
        content: `You need the **${ADMIN_ROLE_NAME}** role to use this command.`,
        ephemeral: true,
      });
      return;
    }

    const serverIdRaw = interaction.options.getString("server", true);
    const serverId = Number.parseInt(serverIdRaw, 10);
    if (!Number.isFinite(serverId) || serverId < 1) {
      await interaction.reply({ content: "Invalid server selection.", ephemeral: true });
      return;
    }

    await interaction.deferReply();

    const guildRowId = await getOrCreateGuildRow(pool, interaction.guild.id);
    const row = await getRustServerByIdForGuild(pool, guildRowId, serverId);
    if (!row) {
      await interaction.editReply({
        embeds: [
          baseEmbed()
            .setTitle("Server not found")
            .setDescription(
              "That server is not registered for this Discord, or it was removed."
            ),
        ],
      });
      return;
    }

    let password: string;
    try {
      password = decryptSecret(row.rcon_password_encrypted, config.encryptionKeyHex);
    } catch {
      await interaction.editReply({
        content: "Could not read stored credentials. Check ENCRYPTION_KEY on the bot host.",
      });
      return;
    }

    const result = await runWebRconCommand(row.id, row.server_ip, row.rcon_port, password, SAY_TEST);

    if (!result.ok) {
      await interaction.editReply({
        embeds: [
          baseEmbed()
            .setTitle("Connection failed")
            .setDescription(
              `Could not reach **${row.nickname}** via WebRcon. Check that the server is online and WebRcon is enabled.`
            )
            .addFields({ name: "Details", value: result.error }),
        ],
      });
      return;
    }

    await interaction.editReply({
      embeds: [
        baseEmbed()
          .setTitle("Test sent")
          .setDescription(
            `**${row.nickname}** responded over WebRcon. A test chat message was sent on the server.\n\n_${BOT_DISPLAY_NAME} never shows IP, port, or passwords in Discord._`
          ),
      ],
    });
  },
};
