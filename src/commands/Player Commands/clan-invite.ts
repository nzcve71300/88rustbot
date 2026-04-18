import { type ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";
import { baseEmbed } from "../../embeds/standard.js";
import { getOrCreateGuildRow } from "../../db/guilds.js";
import { pool } from "../../db/pool.js";
import {
  createInvite,
  deleteExpiredInvites,
  getClanSettings,
  getMemberClan,
  inviteCodeExists,
} from "../../db/clans.js";
import { autocompleteServerOption, validateServerSelection } from "../shared/serverOption.js";

function random4Digits(): string {
  return String(Math.floor(Math.random() * 10_000)).padStart(4, "0");
}

export const clanInviteCommand = {
  data: new SlashCommandBuilder()
    .setName("clan-invite")
    .setDescription("Generate a 4-digit clan invite code (expires in 24 hours).")
    .addStringOption((o) =>
      o
        .setName("server")
        .setDescription("Select a configured Rust server in this Discord (validation only).")
        .setRequired(true)
        .setAutocomplete(true)
    ),

  async autocomplete(interaction: import("discord.js").AutocompleteInteraction) {
    await autocompleteServerOption(interaction, "server");
  },

  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.inGuild() || !interaction.guildId) {
      await interaction.reply({ content: "This command can only be used inside a server.", ephemeral: true });
      return;
    }

    const serverId = Number.parseInt(interaction.options.getString("server", true), 10);
    if (!Number.isFinite(serverId) || serverId < 1 || !(await validateServerSelection(interaction.guildId, serverId))) {
      await interaction.reply({
        embeds: [baseEmbed().setTitle("Invalid server").setDescription("Pick a server from autocomplete.")],
        ephemeral: true,
      });
      return;
    }

    await interaction.deferReply({ ephemeral: true });

    const guildRowId = await getOrCreateGuildRow(pool, interaction.guildId);
    const settings = await getClanSettings(pool, guildRowId);
    if (!settings.enabled) {
      await interaction.editReply({
        embeds: [baseEmbed().setTitle("Clan system disabled").setDescription("An admin must enable it first.")],
      });
      return;
    }

    const clan = await getMemberClan(pool, guildRowId, interaction.user.id);
    if (!clan) {
      await interaction.editReply({
        embeds: [baseEmbed().setTitle("No clan").setDescription("You must be in a clan to create an invite.")],
      });
      return;
    }

    await deleteExpiredInvites(pool);

    let code = random4Digits();
    for (let i = 0; i < 15; i++) {
      if (!(await inviteCodeExists(pool, guildRowId, code))) break;
      code = random4Digits();
    }

    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await createInvite(pool, guildRowId, clan.clanId, code, expiresAt);

    await interaction.editReply({
      embeds: [
        baseEmbed()
          .setTitle("Invite code created")
          .setDescription(
            `Your clan invite code is **${code}**.\\n\\nIt expires in **24 hours**. Share it with players you want to join **${clan.clanName}**.`
          ),
      ],
    });
  },
};

