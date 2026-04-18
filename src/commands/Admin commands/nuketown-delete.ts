import { type ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";
import { memberHasAdminRole } from "../../admin/guildAdmin.js";
import { ADMIN_ROLE_NAME } from "../../constants.js";
import { getOrCreateGuildRow } from "../../db/guilds.js";
import { pool } from "../../db/pool.js";
import { baseEmbed } from "../../embeds/standard.js";
import { requestStopNuketown } from "../../nuketown/runner.js";
import { autocompleteServerOption, validateServerSelection } from "../shared/serverOption.js";
import { getActiveNuketownEventMeta, deleteNuketownEventOnly, finishNuketownEvent } from "../../db/nuketown.js";
import { insertEventSnapshot } from "../../db/eventSnapshots.js";

export const nuketownDeleteCommand = {
  data: new SlashCommandBuilder()
    .setName("nuketown-delete")
    .setDescription("Force-stop and remove the Nuketown event for a server (admin only).")
    .addStringOption((o) => o.setName("server").setDescription("Rust server").setRequired(true).setAutocomplete(true)),

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

    await interaction.deferReply({ ephemeral: true });

    const guildRowId = await getOrCreateGuildRow(pool, interaction.guild.id);
    const active = await getActiveNuketownEventMeta(pool, guildRowId, serverId);
    if (!active) {
      await interaction.editReply({
        embeds: [baseEmbed().setTitle("No active Nuketown").setDescription("There is no lobby or running Nuketown for this server.")],
      });
      return;
    }

    const stopped = requestStopNuketown(serverId);

    // Snapshot deletion for website (shows as Cancelled for 10 minutes), then delete the row so status becomes none.
    try {
      await insertEventSnapshot({
        pool,
        guildRowId,
        rustServerId: serverId,
        type: "nuketown",
        payload: { kind: "nuketown", cancelled: true, reason: "Deleted by admin.", deletedAtMs: Date.now() },
      });
    } catch (err) {
      console.error("[nuketown-delete] snapshot failed:", err);
    }

    await finishNuketownEvent(pool, active.id).catch(() => {});
    await deleteNuketownEventOnly(pool, active.id);

    await interaction.editReply({
      embeds: [
        baseEmbed()
          .setTitle("Nuketown removed")
          .setDescription(
            [
              `**Server ID:** ${serverId}`,
              `**Was:** ${active.status}`,
              stopped ? "**Runner:** abort signal sent" : "**Runner:** not running (lobby only or other process)",
              "",
              "The Nuketown event row was deleted to clear stuck pending/running state. (The Nuketown config is kept.)",
            ].join("\n")
          ),
      ],
    });
  },
};

