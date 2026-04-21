import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type ChatInputCommandInteraction,
  SlashCommandBuilder,
} from "discord.js";
import { memberHasAdminRole } from "../../admin/guildAdmin.js";
import { ADMIN_ROLE_NAME } from "../../constants.js";
import { getOrCreateGuildRow } from "../../db/guilds.js";
import { getNuketownConfig } from "../../db/nuketown.js";
import { pool } from "../../db/pool.js";
import { startNuketownAutomation } from "../../nuketown/automation.js";
import { baseEmbed } from "../../embeds/standard.js";
import { autocompleteServerOption, validateServerSelection } from "../shared/serverOption.js";

function modeKey(mode: "nuketown" | "tournament") {
  return mode === "tournament" ? "tournament" : "nuketown";
}

function restartCustomId(yesNo: "y" | "n", serverId: number, mode: "nuketown" | "tournament") {
  return `nuketownStart:${yesNo}:${serverId}:${modeKey(mode)}`;
}

export function isNuketownRestartButton(id: string): boolean {
  return id.startsWith("nuketownStart:");
}

export async function handleNuketownForceRestart(interaction: import("discord.js").ButtonInteraction) {
  if (!interaction.inGuild() || !interaction.guild || !interaction.member) {
    await interaction.reply({ content: "This can only be used inside a server.", ephemeral: true });
    return;
  }
  if (!memberHasAdminRole(interaction.member, interaction.guild)) {
    await interaction.reply({ content: "You cannot use this button.", ephemeral: true });
    return;
  }

  const parts = interaction.customId.split(":");
  const yesNo = parts[1] as "y" | "n";
  const serverId = Number.parseInt(parts[2] ?? "", 10);
  const mode = (parts[3] ?? "nuketown") === "tournament" ? "tournament" : "nuketown";

  if (yesNo !== "y") {
    await interaction.update({ embeds: [baseEmbed().setTitle("Ok").setDescription("No changes were made.")], components: [] });
    return;
  }

  const guildRowId = await getOrCreateGuildRow(pool, interaction.guild.id);
  // Force next lobby immediately.
  await pool.query(
    `UPDATE nuketown_configs
     SET ${mode === "tournament" ? "tournament_next_lobby_at_ms" : "next_lobby_at_ms"} = :nowMs
     WHERE guild_id = :gid AND rust_server_id = :sid`,
    { gid: guildRowId, sid: serverId, nowMs: Date.now() }
  );

  await interaction.update({
    embeds: [
      baseEmbed()
        .setTitle("Schedule reset")
        .setDescription(`Next **${mode === "tournament" ? "Nuketown Tournament" : "Nuketown"}** lobby will open as soon as possible.`),
    ],
    components: [],
  });
}

export const nuketownStartCommand = {
  data: new SlashCommandBuilder()
    .setName("nuketown-start")
    .setDescription("Start automatic Nuketown lobbies (admin).")
    .addStringOption((o) =>
      o.setName("server").setDescription("Rust server").setRequired(true).setAutocomplete(true)
    )
    .addStringOption((o) =>
      o
        .setName("mode")
        .setDescription("Which mode to automate")
        .setRequired(true)
        .addChoices(
          { name: "Nuketown", value: "nuketown" },
          { name: "Nuketown Tournament", value: "tournament" }
        )
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
      await interaction.reply({
        content: `You need the **${ADMIN_ROLE_NAME}** role to use this command.`,
        ephemeral: true,
      });
      return;
    }

    const serverId = Number.parseInt(interaction.options.getString("server", true), 10);
    if (!Number.isFinite(serverId) || !(await validateServerSelection(interaction.guild.id, serverId))) {
      await interaction.reply({
        embeds: [baseEmbed().setTitle("Invalid server").setDescription("Pick a server from autocomplete.")],
        ephemeral: true,
      });
      return;
    }

    const mode = interaction.options.getString("mode", true) === "tournament" ? "tournament" : "nuketown";

    const guildRowId = await getOrCreateGuildRow(pool, interaction.guild.id);
    const cfg = await getNuketownConfig(pool, guildRowId, serverId, mode);
    if (!cfg || !cfg.messageId) {
      await interaction.reply({
        embeds: [baseEmbed().setTitle("Setup incomplete").setDescription("Run **/nuketown-setup** first (post the lobby message).")],
        ephemeral: true,
      });
      return;
    }
    if (!cfg.howOftenHours || cfg.howOftenHours <= 0) {
      await interaction.reply({
        embeds: [baseEmbed().setTitle("Setup incomplete").setDescription("Set **How often** for automation in /nuketown-setup.")],
        ephemeral: true,
      });
      return;
    }

    if (cfg.automationStarted) {
      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(restartCustomId("y", serverId, mode))
          .setLabel("Yes, force next lobby now")
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(restartCustomId("n", serverId, mode))
          .setLabel("No")
          .setStyle(ButtonStyle.Secondary)
      );
      await interaction.reply({
        embeds: [
          baseEmbed()
            .setTitle("Automation already enabled")
            .setDescription("Do you want to **reset the schedule** and open the next automatic lobby **as soon as possible**?"),
        ],
        components: [row],
        ephemeral: true,
      });
      return;
    }

    const started = await startNuketownAutomation(pool, guildRowId, serverId, mode);
    if (!started.ok) {
      await interaction.reply({ content: started.error ?? "Could not start.", ephemeral: true });
      return;
    }

    await interaction.reply({
      embeds: [
        baseEmbed()
          .setTitle("Nuketown automation started")
          .setDescription(
            `The bot will open **${mode === "tournament" ? "Nuketown Tournament" : "Nuketown"}** lobbies on your **how often** schedule. ` +
              "Each lobby waits up to **15 minutes** (or until all clans fill)."
          ),
      ],
      ephemeral: true,
    });
  },
};

