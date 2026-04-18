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
import { config } from "../../config.js";
import { decryptSecret } from "../../crypto/passwordVault.js";
import { getRustServerByIdForGuild, listRustServersForGuild } from "../../db/rustServers.js";
import { baseEmbed } from "../../embeds/standard.js";
import { autocompleteServerOption } from "../shared/serverOption.js";
import { renderNuketownEmbed } from "../../nuketown/render.js";
import {
  deleteNuketownEventOnly,
  ensureLobbyNuketownForJoin,
  getActiveNuketownEventMeta,
  finishNuketownEvent,
  startNuketownEvent,
  upsertNuketownConfig,
  setNuketownLobbyEndsAtNow,
  listNuketownTeams,
  listNuketownParticipants,
} from "../../db/nuketown.js";
import { runNuketownBracket } from "../../nuketown/runner.js";
import { insertEventSnapshot } from "../../db/eventSnapshots.js";
import { notifyGuildWebPush } from "../../push/webPushNotify.js";

export const nuketownSetupCommand = {
  data: new SlashCommandBuilder()
    .setName("nuketown-setup")
    .setDescription("Setup Nuketown event for a Rust server (admin only).")
    .addStringOption((o) =>
      o.setName("server").setDescription("Rust server in this Discord").setRequired(true).setAutocomplete(true)
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
    const channel = interaction.options.getChannel("announcement_channel", true);
    const role = interaction.options.getRole("announcement_role", true);
    const gates = interaction.options.getInteger("gates", true);
    const gateFrequency = interaction.options.getInteger("gate_frequency", true);
    const teamLimit = interaction.options.getInteger("team_limit", true);
    const kitName = interaction.options.getString("kitname", true).trim();

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
    const lobby = await ensureLobbyNuketownForJoin(pool, guildRowId, serverId, 5);
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
      embeds: [renderNuketownEmbed(srv.nickname, srv.nickname, [], lobbyEndsAtMs, teamLimit, eventNumber)],
    });

    await upsertNuketownConfig(pool, guildRowId, serverId, channel.id, role.id, gates, gateFrequency, teamLimit, kitName, sent.id);

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
            `Nuketown lobby posted in ${channel}. Players can join for up to **5 minutes** (or until **4 clans** fill). Use **/manage-positions** to save **Nuketown Gate 1–20** coordinates.`
          ),
      ],
    });

    // Background: wait for full 4 teams or lobby timeout, then start bracket.
    void (async () => {
      try {
        while (true) {
          const m = await getActiveNuketownEventMeta(pool, guildRowId, serverId);
          if (!m || m.status !== "lobby") return;
          const teams = await listNuketownTeams(pool, m.id);
          const now = Date.now();
          if (teams.length >= 4) {
            await setNuketownLobbyEndsAtNow(pool, m.id);
            break;
          }
          if (m.lobbyEndsAtMs != null && now >= m.lobbyEndsAtMs) break;
          await new Promise((r) => setTimeout(r, 2000));
        }

        const m2 = await getActiveNuketownEventMeta(pool, guildRowId, serverId);
        if (!m2 || m2.status !== "lobby") return;

        const teams = await listNuketownTeams(pool, m2.id);
        if (teams.length < 2) {
          const ch = await interaction.client.channels.fetch(channel.id);
          if (ch && ch instanceof TextChannel) {
            await ch.send({
              embeds: [baseEmbed().setTitle("Nuketown cancelled").setDescription("Not enough clans joined (need at least **2**).")],
            });
          }

          // Snapshot cancellation for website, then delete the lobby row so status becomes "none".
          try {
            await insertEventSnapshot({
              pool,
              guildRowId,
              rustServerId: serverId,
              type: "nuketown",
              payload: { kind: "nuketown", cancelled: true, reason: "Not enough clans joined (need at least 2)." },
            });
          } catch (snapErr) {
            console.error("[nuketown-setup] cancel snapshot failed:", snapErr);
          }
          await finishNuketownEvent(pool, m2.id).catch(() => {});
          await deleteNuketownEventOnly(pool, m2.id).catch(() => {});
          return;
        }

        const participants = await listNuketownParticipants(pool, guildRowId, m2.id);
        const clanMeta = new Map<number, { clanTag: string; clanName: string; clanColor: string | null }>();
        for (const p of participants) clanMeta.set(p.clanId, { clanTag: p.clanTag, clanName: p.clanName, clanColor: (p as any).clanColor ?? null });
        const bracket = {
          kind: "nuketown",
          teams: teams
            .map((t) => ({
              slot: t.slot,
              clanId: t.clanId,
              clanTag: clanMeta.get(t.clanId)?.clanTag ?? "",
              clanName: clanMeta.get(t.clanId)?.clanName ?? "Clan",
              clanColor: clanMeta.get(t.clanId)?.clanColor ?? null,
            }))
            .sort((a, b) => a.slot - b.slot),
          stage: "running",
          currentMatch: null,
          winners: { semi1: null, semi2: null, champion: null },
        };

        const started = await startNuketownEvent(pool, m2.id, kitName, teamLimit, bracket);
        if (!started) return;

        const rustRow = await getRustServerByIdForGuild(pool, guildRowId, serverId);
        if (!rustRow) return;

        void notifyGuildWebPush(pool, guildRowId, serverId, {
          title: "Grindset",
          body: "Nuketown Started. Join now!",
          tag: `nuketown-${m2.id}`,
        });
        const password = decryptSecret(rustRow.rcon_password_encrypted, config.encryptionKeyHex);
        void runNuketownBracket({
          client: interaction.client,
          pool,
          guildRowId,
          rustServerId: serverId,
          eventId: m2.id,
          announcementChannelId: channel.id,
          serverNickname: rustRow.nickname,
          host: rustRow.server_ip,
          port: rustRow.rcon_port,
          password,
          kitName,
          gateFrequency,
        });
      } catch (err) {
        console.error("[nuketown-setup] auto-start loop failed:", err);
      }
    })();
  },
};

