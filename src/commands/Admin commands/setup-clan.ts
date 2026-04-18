import {
  ChannelType,
  type ChatInputCommandInteraction,
  SlashCommandBuilder,
  TextChannel,
} from "discord.js";
import { memberHasAdminRole } from "../../admin/guildAdmin.js";
import { ADMIN_ROLE_NAME, MAX_RUST_SERVERS_PER_GUILD } from "../../constants.js";
import { getOrCreateGuildRow } from "../../db/guilds.js";
import { listRustServersForGuild } from "../../db/rustServers.js";
import { pool } from "../../db/pool.js";
import { baseEmbed } from "../../embeds/standard.js";
import { upsertClanSettings } from "../../db/clans.js";
import { buildClanJoinEmbed, buildJoinClanButtonRow } from "../../clans/ui.js";

export const setupClanCommand = {
  data: new SlashCommandBuilder()
    .setName("setup-clan")
    .setDescription("Configure clan system for this Discord (all Rust servers in this Discord).")
    .addStringOption((o) =>
      o
        .setName("server")
        .setDescription("Select a configured Rust server in this Discord (validation only).")
        .setRequired(true)
        .setAutocomplete(true)
    )
    .addStringOption((o) =>
      o
        .setName("option")
        .setDescription("Enable or disable the clan system.")
        .setRequired(true)
        .addChoices(
          { name: "✅ Enable", value: "enable" },
          { name: "❌ Disable", value: "disable" }
        )
    )
    .addIntegerOption((o) =>
      o
        .setName("max")
        .setDescription("Max members per clan (1-20).")
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(20)
    )
    .addChannelOption((o) =>
      o
        .setName("channel")
        .setDescription("Channel to post the JOIN A CLAN message in.")
        .setRequired(true)
        .addChannelTypes(ChannelType.GuildText)
    ),

  async autocomplete(interaction: import("discord.js").AutocompleteInteraction) {
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
    const picked = servers.filter((s) => s.nickname.toLowerCase().includes(q)).slice(0, 25);
    await interaction.respond(
      picked.map((s) => ({
        name: s.nickname.length > 100 ? `${s.nickname.slice(0, 97)}...` : s.nickname,
        value: String(s.id),
      }))
    );
  },

  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.inGuild() || !interaction.guild || !interaction.member) {
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
    const opt = interaction.options.getString("option", true);
    const enabled = opt === "enable";
    const maxMembers = interaction.options.getInteger("max", true);
    const channel = interaction.options.getChannel("channel", true);
    if (!(channel instanceof TextChannel)) {
      await interaction.editReply({
        embeds: [baseEmbed().setTitle("Invalid channel").setDescription("Pick a normal text channel.")],
      });
      return;
    }

    await interaction.deferReply({ ephemeral: true });

    const guildRowId = await getOrCreateGuildRow(pool, interaction.guild.id);
    const servers = await listRustServersForGuild(pool, guildRowId);
    if (servers.length < 1) {
      await interaction.editReply({
        embeds: [baseEmbed().setTitle("No Rust servers").setDescription("Use `/setup-server` first.")],
      });
      return;
    }
    if (servers.length > MAX_RUST_SERVERS_PER_GUILD) {
      // should never happen due to earlier cap, but keep us safe
      console.warn("Server count exceeded expected cap.");
    }
    if (!servers.some((s) => String(s.id) === String(serverId))) {
      await interaction.editReply({
        embeds: [baseEmbed().setTitle("Invalid server").setDescription("Pick a server from autocomplete.")],
      });
      return;
    }

    const joinEmbed = buildClanJoinEmbed(enabled, maxMembers);
    const row = buildJoinClanButtonRow(!enabled);
    const sent = await channel.send({ embeds: [joinEmbed], components: [row] });

    await upsertClanSettings(pool, guildRowId, enabled, maxMembers, channel.id, sent.id);

    await interaction.editReply({
      embeds: [
        baseEmbed()
          .setTitle("Clan system updated")
          .setDescription(
            enabled
              ? `Clan system is **enabled**. Join message posted in ${channel}.`
              : `Clan system is **disabled**. Join message posted (button disabled) in ${channel}.`
          ),
      ],
    });
  },
};

