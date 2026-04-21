import { randomInt } from "node:crypto";
import { type ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";
import { memberHasAdminRole } from "../../admin/guildAdmin.js";
import { ADMIN_ROLE_NAME, BOT_DISPLAY_NAME, MAX_RUST_SERVERS_PER_GUILD } from "../../constants.js";
import { config } from "../../config.js";
import { encryptSecret } from "../../crypto/passwordVault.js";
import { getOrCreateGuildRow } from "../../db/guilds.js";
import { countGuildServers, insertRustServer } from "../../db/rustServers.js";
import { baseEmbed } from "../../embeds/standard.js";
import { pool } from "../../db/pool.js";
import { rconConsoleFanout } from "../../rcon/consoleFanout.js";
import { verifyWebRconConnection } from "../../rcon/webrcon.js";

const IPV4 =
  /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;

export const setupServerCommand = {
  data: new SlashCommandBuilder()
    .setName("setup-server")
    .setDescription("Register a Rust console server (WebRcon) for this Discord.")
    .addStringOption((o) =>
      o
        .setName("nickname")
        .setDescription("A short name people will use for this server.")
        .setRequired(true)
        .setMaxLength(100)
    )
    .addStringOption((o) =>
      o
        .setName("server_ip")
        .setDescription("Rust server IP, e.g. 147.93.162.85")
        .setRequired(true)
        .setMaxLength(255)
    )
    .addIntegerOption((o) =>
      o
        .setName("rcon_port")
        .setDescription("WebRcon port, e.g. 28516")
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(65535)
    )
    .addStringOption((o) =>
      o
        .setName("rcon_password")
        .setDescription("WebRcon password")
        .setRequired(true)
        .setMinLength(1)
        .setMaxLength(256)
    ),

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

    const nickname = interaction.options.getString("nickname", true).trim();
    const serverIp = interaction.options.getString("server_ip", true).trim();
    const rconPort = interaction.options.getInteger("rcon_port", true);
    const rconPassword = interaction.options.getString("rcon_password", true);

    if (!nickname) {
      await interaction.reply({ content: "Nickname cannot be empty.", ephemeral: true });
      return;
    }

    if (!IPV4.test(serverIp)) {
      await interaction.reply({
        content: "Server IP must be a valid IPv4 address (example: 147.93.162.85).",
        ephemeral: true,
      });
      return;
    }

    await interaction.deferReply();

    const guildRowId = await getOrCreateGuildRow(pool, interaction.guild.id);
    const current = await countGuildServers(pool, guildRowId);
    if (current >= MAX_RUST_SERVERS_PER_GUILD) {
      await interaction.editReply({
        embeds: [
          baseEmbed()
            .setTitle("Server limit reached")
            .setDescription(
              `This Discord can have at most **${MAX_RUST_SERVERS_PER_GUILD}** Rust servers configured.`
            ),
        ],
      });
      return;
    }

    // Temporary id so this verify pass never shares a socket with an existing registered server.
    const verifyRustServerId = -randomInt(1, 2 ** 31 - 2);
    const rcon = await verifyWebRconConnection(verifyRustServerId, serverIp, rconPort, rconPassword);
    if (!rcon.ok) {
      await interaction.editReply({
        embeds: [
          baseEmbed()
            .setTitle("Could not connect")
            .setDescription(
              "The bot could not verify WebRcon with the details provided. Double-check IP, port, password, and that WebRcon is enabled on the Rust server."
            )
            .addFields({ name: "Details", value: rcon.error }),
        ],
      });
      return;
    }

    let encrypted: Buffer;
    try {
      encrypted = encryptSecret(rconPassword, config.encryptionKeyHex);
    } catch {
      await interaction.editReply({
        content: "Server encryption is misconfigured on the bot host (ENCRYPTION_KEY).",
      });
      return;
    }

    try {
      await insertRustServer(pool, guildRowId, nickname, serverIp, rconPort, encrypted);
    } catch (e: unknown) {
      const code = typeof e === "object" && e && "code" in e ? String((e as { code: string }).code) : "";
      if (code === "ER_DUP_ENTRY") {
        await interaction.editReply({
          embeds: [
            baseEmbed()
              .setTitle("Duplicate nickname")
              .setDescription(
                `You already have a Rust server registered with the nickname **${nickname}** in this Discord.`
              ),
          ],
        });
        return;
      }
      throw e;
    }

    try {
      await rconConsoleFanout.refresh(pool);
    } catch (err) {
      console.error("[rcon console] refresh after setup-server failed:", err);
    }

    await interaction.editReply({
      embeds: [
        baseEmbed()
          .setTitle("Connected")
          .setDescription(`**${nickname}** is successfully connected to **${BOT_DISPLAY_NAME}**.`),
      ],
    });
  },
};
