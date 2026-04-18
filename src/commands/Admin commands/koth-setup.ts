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
import { ensureLobbyEventForJoin, upsertKothConfig } from "../../db/koth.js";
import { getRustServerByIdForGuild } from "../../db/rustServers.js";
import { renderKothEmbed } from "../../koth/render.js";
import { KOTH_RCON_SETUP, runSayRcon } from "../../rcon/eventBroadcasts.js";
import { autocompleteServerOption } from "../shared/serverOption.js";
import { notifyGuildWebPush } from "../../push/webPushNotify.js";

export const kothSetupCommand = {
  data: new SlashCommandBuilder()
    .setName("koth-setup")
    .setDescription("Setup King of the Hill announcements for a Rust server (admin only).")
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
    .addRoleOption((o) => o.setName("announcement_role").setDescription("Role to mention").setRequired(true)),

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
    const role = interaction.options.getRole("announcement_role", true);

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

    // Create the lobby immediately so we can include the event number in the announcement.
    const lobby = await ensureLobbyEventForJoin(pool, guildRowId, serverId);
    const eventNumber = lobby.ok ? lobby.eventId : null;

    const embed = renderKothEmbed(srv.nickname, srv.nickname, [], eventNumber, null);
    const sent = await channel.send({ content: `<@&${role.id}>`, embeds: [embed] });

    await upsertKothConfig(pool, guildRowId, serverId, channel.id, role.id, gates, gateFrequency, sent.id);

    void notifyGuildWebPush(pool, guildRowId, serverId, {
      title: "Grindset",
      body: "KOTH lobby is open. Join now!",
      tag: `koth-lobby-${lobby.ok ? lobby.eventId : "setup"}`,
    });

    await interaction.editReply({
      embeds: [baseEmbed().setTitle("KOTH configured").setDescription(`KOTH message posted in ${channel}.`)],
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

