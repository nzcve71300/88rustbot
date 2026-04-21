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
import { listRustServersForGuild } from "../../db/rustServers.js";
import { baseEmbed } from "../../embeds/standard.js";
import { autocompleteServerOption } from "../shared/serverOption.js";
import { renderNuketownEmbed } from "../../nuketown/render.js";
import { ensureLobbyNuketownForJoin, getActiveNuketownEventMeta, upsertNuketownConfig } from "../../db/nuketown.js";
import { scheduleNuketownLobbyWatch } from "../../nuketown/nuketownLobbyWatch.js";
import { notifyGuildWebPush } from "../../push/webPushNotify.js";

export const nuketownSetupCommand = {
  data: new SlashCommandBuilder()
    .setName("nuketown-setup")
    .setDescription("Setup Nuketown event for a Rust server (admin only).")
    .addStringOption((o) =>
      o.setName("server").setDescription("Rust server in this Discord").setRequired(true).setAutocomplete(true)
    )
    .addStringOption((o) =>
      o
        .setName("mode")
        .setDescription("Which mode to setup")
        .setRequired(true)
        .addChoices(
          { name: "Nuketown", value: "nuketown" },
          { name: "Nuketown Tournament", value: "tournament" }
        )
    )
    .addChannelOption((o) =>
      o
        .setName("announcement_channel")
        .setDescription("Channel to post Nuketown message")
        .setRequired(true)
        .addChannelTypes(ChannelType.GuildText)
    )
    .addRoleOption((o) =>
      o.setName("announcement_role").setDescription("Role to mention on announcement").setRequired(true)
    )
    .addIntegerOption((o) =>
      o.setName("gates").setDescription("Number of Nuketown gates (2–20)").setRequired(true).setMinValue(2).setMaxValue(20)
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
      o.setName("team_limit").setDescription("Max members per clan (1–5)").setRequired(true).setMinValue(1).setMaxValue(5)
    )
    .addIntegerOption((o) =>
      o
        .setName("how_often_hours")
        .setDescription("Automation: how often to open a new lobby (hours). Set 0 to disable automation scheduling.")
        .setRequired(true)
        .setMinValue(0)
        .setMaxValue(168)
    )
    .addStringOption((o) => o.setName("kitname").setDescription("Kit name to give players").setRequired(true)),

  async autocomplete(interaction: import("discord.js").AutocompleteInteraction) {
    await autocompleteServerOption(interaction, "server");
  },

  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.inGuild() || !interaction.guild || !interaction.member || !interaction.client) {
      await interaction.reply({ content: "This command can only be used inside a server.", ephemeral: true });
      return;
    }
    if (!memberHasAdminRole(interaction.member, interaction.guild)) {
      await interaction.reply({ content: `You need the **${ADMIN_ROLE_NAME}** role to use this command.`, ephemeral: true });
      return;
    }

    const serverId = Number.parseInt(interaction.options.getString("server", true), 10);
    const mode = interaction.options.getString("mode", true) === "tournament" ? "tournament" : "nuketown";
    const channel = interaction.options.getChannel("announcement_channel", true);
    const role = interaction.options.getRole("announcement_role", true);
    const gatesIn = interaction.options.getInteger("gates", true);
    const gateFrequency = interaction.options.getInteger("gate_frequency", true);
    const teamLimit = interaction.options.getInteger("team_limit", true);
    const howOftenHours = interaction.options.getInteger("how_often_hours", true);
    const kitName = interaction.options.getString("kitname", true).trim();

    const gates = mode === "tournament" ? 4 : gatesIn;
    if (mode === "tournament" && gatesIn !== 4) {
      await interaction.reply({
        embeds: [baseEmbed().setTitle("Tournament gates").setDescription("Nuketown Tournament requires exactly **4 gates** (one per clan).")],
        ephemeral: true,
      });
      return;
    }

    if (!(channel instanceof TextChannel)) {
      await interaction.reply({ embeds: [baseEmbed().setTitle("Invalid channel").setDescription("Pick a text channel.")], ephemeral: true });
      return;
    }
    if (!kitName) {
      await interaction.reply({ embeds: [baseEmbed().setTitle("Invalid kit").setDescription("kitname cannot be empty.")], ephemeral: true });
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

    // Create or reuse lobby with a 5 minute join window.
    const lobby = await ensureLobbyNuketownForJoin(pool, guildRowId, serverId, 5, mode);
    if (!lobby.ok) {
      await interaction.editReply({ embeds: [baseEmbed().setTitle("Already running").setDescription("Nuketown is already running on this server.")] });
      return;
    }

    const meta = await getActiveNuketownEventMeta(pool, guildRowId, serverId);
    const lobbyEndsAtMs = meta?.lobbyEndsAtMs ?? (Date.now() + 5 * 60_000);
    const eventNumber = meta?.id ?? lobby.eventId;

    // Post message and save config.
    const sent = await channel.send({
      content: `<@&${role.id}>`,
      embeds: [renderNuketownEmbed(srv.nickname, srv.nickname, [], lobbyEndsAtMs, teamLimit, mode === "tournament" ? "tournament" : "nuketown", eventNumber)],
    });

    await upsertNuketownConfig(
      pool,
      guildRowId,
      serverId,
      channel.id,
      role.id,
      gates,
      gateFrequency,
      teamLimit,
      kitName,
      sent.id,
      howOftenHours > 0 ? howOftenHours : null,
      false,
      howOftenHours > 0 ? Date.now() + howOftenHours * 3600_000 : null,
      mode
    );

    void notifyGuildWebPush(pool, guildRowId, serverId, {
      title: "Grindset",
      body: "Nuketown lobby is open. Join now!",
      tag: `nuketown-lobby-${eventNumber}`,
    });

    await interaction.editReply({
      embeds: [
        baseEmbed()
          .setTitle("Nuketown configured")
          .setDescription(
            `${mode === "tournament" ? "Nuketown Tournament" : "Nuketown"} lobby posted in ${channel}. Players can join for up to **5 minutes** (or until **${mode === "tournament" ? "4" : "2"} clans** fill). Use **/manage-positions** to save **Nuketown Gate 1–20** coordinates.`
          ),
      ],
    });

    scheduleNuketownLobbyWatch(
      interaction.client,
      pool,
      guildRowId,
      serverId,
      channel.id,
      kitName,
      teamLimit,
      gateFrequency,
      mode === "tournament" ? 4 : 2
    );
  },
};

