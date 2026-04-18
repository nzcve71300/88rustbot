import { type ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";
import { memberHasAdminRole } from "../../admin/guildAdmin.js";
import { ADMIN_ROLE_NAME } from "../../constants.js";
import { config } from "../../config.js";
import { decryptSecret } from "../../crypto/passwordVault.js";
import { getOrCreateGuildRow } from "../../db/guilds.js";
import { pool } from "../../db/pool.js";
import { deleteKothEventAndClearConfig, getActiveKothEvent, getKothConfig } from "../../db/koth.js";
import { getRustServerByIdForGuild } from "../../db/rustServers.js";
import { baseEmbed } from "../../embeds/standard.js";
import { kothKillTracker } from "../../koth/killTracker.js";
import { requestStopKoth } from "../../koth/runner.js";
import { buildKothEndedSay, runSayRcon } from "../../rcon/eventBroadcasts.js";
import { getKothEventTopKillerWithLink } from "../../db/koth.js";
import { runWebRconCommand } from "../../rcon/webrcon.js";
import { autocompleteServerOption, validateServerSelection } from "../shared/serverOption.js";
import { insertEventSnapshot } from "../../db/eventSnapshots.js";
import { listKothParticipantsWithGatesAndClan, listWaveKillsDetailed, sumKillsByClanForWave } from "../../db/koth.js";

export const kothEndCommand = {
  data: new SlashCommandBuilder()
    .setName("koth-end")
    .setDescription("End any active KOTH (lobby or running) for a Rust server (admin only).")
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

    const guildRowId = await getOrCreateGuildRow(pool, interaction.guild.id);
    const active = await getActiveKothEvent(pool, guildRowId, serverId);
    if (!active) {
      await interaction.editReply({
        embeds: [baseEmbed().setTitle("No active KOTH").setDescription("There is no lobby or running KOTH for this server.")],
      });
      return;
    }

    // Stop wave loop if it is running in this process.
    const stopped = requestStopKoth(serverId);

    // Best-effort: close any gates that might be open; in-game “ended” line; then delete DB state.
    try {
      const cfg = await getKothConfig(pool, guildRowId, serverId);
      const srv = await getRustServerByIdForGuild(pool, guildRowId, serverId);
      if (cfg && srv) {
        const password = decryptSecret(srv.rcon_password_encrypted, config.encryptionKeyHex);
        await runWebRconCommand(serverId, srv.server_ip, srv.rcon_port, password, "rf.removefakeboardcaster");
        try {
          await kothKillTracker.drain(serverId);
          const top = await getKothEventTopKillerWithLink(pool, guildRowId, active.id);
          const endedCmd = buildKothEndedSay(top?.clanName ?? "N/A", top?.ingameName ?? "N/A");
          void runSayRcon(serverId, srv.server_ip, srv.rcon_port, password, endedCmd, "koth-end");
        } catch (err) {
          console.error("[koth-end] in-game say failed:", err);
        }
      }
    } catch (err) {
      console.error("[koth-end] rf.removefakeboardcaster failed:", err);
    }

    // Remove event and clear setup so admins must /koth-setup again (gate coords remain).
    // Safe website support: snapshot results for 10 minutes, then keep existing delete behavior unchanged.
    try {
      const top = await getKothEventTopKillerWithLink(pool, guildRowId, active.id);
      const participants = await listKothParticipantsWithGatesAndClan(pool, guildRowId, active.id);
      // We don't know waves here (admin can end early); snapshot wave 1..currentWave (best-effort).
      const perWave: unknown[] = [];
      for (let w = 1; w <= 10; w++) {
        const players = await listWaveKillsDetailed(pool, active.id, w);
        if (players.length === 0 && w > 1) break;
        const clans = await sumKillsByClanForWave(pool, active.id, w);
        perWave.push({ wave: w, players, clans });
      }
      await insertEventSnapshot({
        pool,
        guildRowId,
        rustServerId: serverId,
        type: "koth",
        payload: { kind: "koth", endedAtMs: Date.now(), topKiller: top, participants, perWave },
      });
    } catch (err) {
      console.error("[koth-end] failed to snapshot ended event:", err);
    }
    await deleteKothEventAndClearConfig(pool, guildRowId, serverId, active.id);

    await interaction.editReply({
      embeds: [
        baseEmbed()
          .setTitle("KOTH ended")
          .setDescription(
            [
              `**Server ID:** ${serverId}`,
              `**Event:** ${active.status}`,
              stopped ? "**Runner:** stopped" : "**Runner:** not running (or on another process)",
              "",
              "KOTH config was cleared. Run **/koth-setup** again before the next event. Gate positions are kept.",
            ].join("\n")
          ),
      ],
    });
  },
};

