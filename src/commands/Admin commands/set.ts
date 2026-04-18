import { type ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";
import { memberHasAdminRole } from "../../admin/guildAdmin.js";
import { ADMIN_ROLE_NAME } from "../../constants.js";
import { getOrCreateGuildRow } from "../../db/guilds.js";
import {
  upsertKillfeedEnabled,
  upsertKillfeedFormatString,
  upsertKillfeedRandomizer,
} from "../../db/killfeedConfig.js";
import { pool } from "../../db/pool.js";
import { listRustServersForGuild } from "../../db/rustServers.js";
import { baseEmbed } from "../../embeds/standard.js";
import { reloadKillfeedConfigForServer } from "../../killfeed/service.js";
import { autocompleteServerOption } from "../shared/serverOption.js";

const onOffChoices = [
  { name: "On", value: "on" },
  { name: "Off", value: "off" },
] as const;

export const setCommand = {
  data: new SlashCommandBuilder()
    .setName("set")
    .setDescription("Configure per-server bot options (admin only).")
    .addStringOption((o) =>
      o
        .setName("server")
        .setDescription("Rust server")
        .setRequired(true)
        .setAutocomplete(true)
    )
    .addStringOption((o) =>
      o
        .setName("killfeed_game")
        .setDescription("Broadcast killfeed in-game (say)")
        .addChoices(...onOffChoices)
    )
    .addStringOption((o) =>
      o
        .setName("killfeed_format")
        .setDescription('Killfeed text — placeholders {Killer}, {Victim} (e.g. "{Killer} killed {Victim}")')
        .setMaxLength(2000)
    )
    .addStringOption((o) =>
      o
        .setName("killfeed_randomizer")
        .setDescription('Rotate verbs instead of "killed" (format must include "killed")')
        .addChoices(...onOffChoices)
    ),

  async autocomplete(interaction: import("discord.js").AutocompleteInteraction) {
    try {
      await autocompleteServerOption(interaction, "server");
    } catch (err) {
      console.error("[set] autocomplete failed:", err);
      try {
        await interaction.respond([]);
      } catch {
        /* already acknowledged */
      }
    }
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
    const killfeedGame = interaction.options.getString("killfeed_game");
    const killfeedFormat = interaction.options.getString("killfeed_format");
    const killfeedRandomizer = interaction.options.getString("killfeed_randomizer");

    const hasGame = killfeedGame != null;
    const hasFormat = killfeedFormat != null;
    const hasRandomizer = killfeedRandomizer != null;

    if (!hasGame && !hasFormat && !hasRandomizer) {
      await interaction.reply({
        embeds: [
          baseEmbed()
            .setTitle("Missing options")
            .setDescription(
              "Set **server**, then at least one of: **killfeed_game** (On/Off), **killfeed_format** (text), **killfeed_randomizer** (On/Off)."
            ),
        ],
        ephemeral: true,
      });
      return;
    }

    if (hasFormat && killfeedFormat!.trim().length === 0) {
      await interaction.reply({
        embeds: [baseEmbed().setTitle("Invalid format").setDescription("**killfeed_format** cannot be empty.")],
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
        embeds: [baseEmbed().setTitle("Invalid server").setDescription("Pick a server from the list (type to filter).")],
      });
      return;
    }

    try {
      const lines: string[] = [];

      if (hasGame) {
        const v = killfeedGame!.trim().toLowerCase();
        await upsertKillfeedEnabled(pool, guildRowId, serverId, v === "on");
        lines.push(`**Killfeed (in-game):** ${v}`);
      }

      if (hasFormat) {
        await upsertKillfeedFormatString(pool, guildRowId, serverId, killfeedFormat!);
        lines.push("**Killfeed format:** saved (`{Killer}`, `{Victim}`)");
      }

      if (hasRandomizer) {
        const v = killfeedRandomizer!.trim().toLowerCase();
        await upsertKillfeedRandomizer(pool, guildRowId, serverId, v === "on");
        lines.push(`**Killfeed randomizer:** ${v}`);
      }

      await reloadKillfeedConfigForServer(pool, serverId);

      await interaction.editReply({
        embeds: [
          baseEmbed()
            .setTitle("Settings updated")
            .setDescription(`**${srv.nickname}**\n${lines.join("\n")}`),
        ],
      });
    } catch (err) {
      console.error("[set] failed:", err);
      await interaction.editReply({
        embeds: [baseEmbed().setTitle("Error").setDescription("Something went wrong saving settings.")],
      });
    }
  },
};
