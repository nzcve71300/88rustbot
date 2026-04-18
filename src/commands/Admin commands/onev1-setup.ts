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
import { upsertOneV1Config } from "../../db/onev1.js";
import { listRustServersForGuild } from "../../db/rustServers.js";
import { autocompleteServerOption } from "../shared/serverOption.js";

export const onev1SetupCommand = {
  data: new SlashCommandBuilder()
    .setName("onev1-setup")
    .setDescription("Configure 1v1 duels for a Rust server (saved silently; no post in the announcement channel).")
    .addStringOption((o) =>
      o.setName("server").setDescription("Rust server").setRequired(true).setAutocomplete(true)
    )
    .addChannelOption((o) =>
      o
        .setName("announcement_channel")
        .setDescription("Channel for 1v1 nominations and results")
        .setRequired(true)
        .addChannelTypes(ChannelType.GuildText)
    )
    .addStringOption((o) =>
      o
        .setName("enable")
        .setDescription("Allow players to start 1v1 challenges")
        .setRequired(true)
        .addChoices({ name: "Yes", value: "yes" }, { name: "No", value: "no" })
    )
    .addStringOption((o) => o.setName("kit_name").setDescription("Kit name for both players").setRequired(true))
    .addIntegerOption((o) =>
      o
        .setName("gate_frequency")
        .setDescription("4-digit broadcaster frequency (same as other events)")
        .setRequired(true)
        .setMinValue(1000)
        .setMaxValue(9999)
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
      await interaction.reply({ content: `You need the **${ADMIN_ROLE_NAME}** role.`, ephemeral: true });
      return;
    }

    const serverId = Number.parseInt(interaction.options.getString("server", true), 10);
    const channel = interaction.options.getChannel("announcement_channel", true);
    const enableRaw = interaction.options.getString("enable", true);
    const kitName = interaction.options.getString("kit_name", true);
    const gateFrequency = interaction.options.getInteger("gate_frequency", true);

    if (!(channel instanceof TextChannel)) {
      await interaction.reply({ content: "Pick a text channel.", ephemeral: true });
      return;
    }

    await interaction.deferReply({ ephemeral: true });
    const guildRowId = await getOrCreateGuildRow(pool, interaction.guild.id);
    const servers = await listRustServersForGuild(pool, guildRowId);
    if (!servers.some((s) => String(s.id) === String(serverId))) {
      await interaction.editReply({ content: "Invalid server — use autocomplete." });
      return;
    }

    await upsertOneV1Config(
      pool,
      guildRowId,
      serverId,
      channel.id,
      enableRaw === "yes",
      kitName,
      gateFrequency
    );

    await interaction.editReply({
      content: "Saved. Configuration is stored; nothing was posted to the announcement channel.",
    });
  },
};
