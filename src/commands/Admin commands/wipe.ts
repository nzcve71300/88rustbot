import { type AutocompleteInteraction, type ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";
import { memberHasAdminRole } from "../../admin/guildAdmin.js";
import { ADMIN_ROLE_NAME } from "../../constants.js";
import { baseEmbed } from "../../embeds/standard.js";
import { pool } from "../../db/pool.js";
import { wipeAllPlayerKd } from "../../db/playerKd.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const SYSTEM_CLAN_LEADERBOARD = "Clan Leaderboard";

export const wipeCommand = {
  data: new SlashCommandBuilder()
    .setName("wipe")
    .setDescription("Wipe a system (admin only).")
    .addStringOption((o) =>
      o.setName("system").setDescription("System to wipe").setRequired(true).setAutocomplete(true)
    ),

  async autocomplete(interaction: AutocompleteInteraction) {
    try {
      const focused = interaction.options.getFocused(true);
      const q = String(focused?.value ?? "").toLowerCase();
      const options = [SYSTEM_CLAN_LEADERBOARD]
        .filter((x) => x.toLowerCase().includes(q))
        .slice(0, 25)
        .map((name) => ({ name, value: name }));
      await interaction.respond(options);
    } catch (err) {
      console.error("[wipe] autocomplete failed:", err);
      try {
        await interaction.respond([]);
      } catch {
        /* ignore */
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

    const system = String(interaction.options.getString("system", true)).trim();
    if (system !== SYSTEM_CLAN_LEADERBOARD) {
      await interaction.reply({
        embeds: [baseEmbed().setTitle("Invalid system").setDescription(`Pick **${SYSTEM_CLAN_LEADERBOARD}** from autocomplete.`)],
        ephemeral: true,
      });
      return;
    }

    await interaction.reply({
      embeds: [baseEmbed().setTitle("Please wait...").setDescription(`Wiping **${system}**.`)],
      ephemeral: true,
    });

    try {
      const wipePromise = wipeAllPlayerKd(pool);
      await Promise.all([wipePromise, sleep(5000)]);
      await interaction.editReply({
        embeds: [baseEmbed().setTitle("Success").setDescription(`Success the **${system}** has been wiped.`)],
      });
    } catch (err) {
      console.error("[wipe] failed:", err);
      await interaction.editReply({
        embeds: [baseEmbed().setTitle("Error").setDescription("Something went wrong wiping the system. Check bot logs.")],
      });
    }
  },
};

