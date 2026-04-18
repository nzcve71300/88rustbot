import { type ChatInputCommandInteraction, EmbedBuilder, SlashCommandBuilder } from "discord.js";
import { memberHasAdminRole } from "../../admin/guildAdmin.js";
import { ADMIN_ROLE_NAME } from "../../constants.js";
import { getOrCreateGuildRow } from "../../db/guilds.js";
import { pool } from "../../db/pool.js";
import { deleteMatch, getMatchForServer } from "../../db/onev1.js";
import { baseEmbed } from "../../embeds/standard.js";
import { requestStopOneV1 } from "../../onev1/runner.js";
import { onev1KillTracker } from "../../onev1/killTracker.js";
import { onev1RespawnWait } from "../../onev1/respawnWait.js";
import { autocompleteServerOption, validateServerSelection } from "../shared/serverOption.js";

export const onev1DeleteCommand = {
  data: new SlashCommandBuilder()
    .setName("onev1-delete")
    .setDescription("Remove any pending or active 1v1 match on a server (admin only).")
    .addStringOption((o) =>
      o.setName("server").setDescription("Rust server").setRequired(true).setAutocomplete(true)
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

    await interaction.deferReply({ ephemeral: true });

    const match = await getMatchForServer(pool, serverId);
    if (!match) {
      await interaction.editReply({
        embeds: [
          baseEmbed()
            .setTitle("No active 1v1")
            .setDescription("There is no **pending** or **running** 1v1 match for this server."),
        ],
      });
      return;
    }

    requestStopOneV1(serverId);
    onev1RespawnWait.cancel(serverId);
    onev1KillTracker.releasePendingRound(serverId);
    await deleteMatch(pool, match.id);

    try {
      if (match.messageId) {
        const ch = await interaction.client.channels.fetch(match.channelId).catch(() => null);
        if (ch?.isTextBased() && "messages" in ch) {
          const msg = await ch.messages.fetch(match.messageId).catch(() => null);
          if (msg) {
            await msg.edit({
              embeds: [
                new EmbedBuilder()
                  .setTitle("⚔️ 1v1 — cancelled")
                  .setDescription("An admin removed this 1v1 with `/onev1-delete`.")
                  .setColor(0xed4245),
              ],
              components: [],
            });
          }
        }
      }
    } catch {
      /* message or channel may be gone */
    }

    await interaction.editReply({
      embeds: [
        baseEmbed()
          .setTitle("1v1 removed")
          .setDescription(
            [
              `**Server ID:** ${serverId}`,
              `**Match ID:** ${match.id}`,
              `**Was:** ${match.status}`,
              "",
              "If a match was in progress, the runner should stop shortly. Players can start a new 1v1 when ready.",
            ].join("\n")
          ),
      ],
    });
  },
};
