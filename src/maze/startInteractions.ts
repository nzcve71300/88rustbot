import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type ButtonInteraction,
} from "discord.js";
import { memberHasAdminRole } from "../admin/guildAdmin.js";
import { ADMIN_ROLE_NAME } from "../constants.js";
import {
  countMazeEventMembers,
  getActiveMazeEvent,
  getActiveMazeEventMeta,
  getMazeConfig,
  isMazeAutomationConfigComplete,
  listMazeSpawnViews,
  listMissingMazeSpawnCoords,
} from "../db/maze.js";
import { getOrCreateGuildRow } from "../db/guilds.js";
import { pool } from "../db/pool.js";
import { baseEmbed } from "../embeds/standard.js";
import { startMazeAutomation } from "./automation.js";
import { updateMazeMessage } from "./announce.js";
import { listRustServersForGuild } from "../db/rustServers.js";

export function mazeRestartCustomId(kind: "y" | "n", rustServerId: number): string {
  return `maze:rs:${kind}:${rustServerId}`;
}

export async function handleMazeForceRestart(interaction: ButtonInteraction): Promise<void> {
  if (!interaction.guild || !interaction.member) {
    await interaction.reply({ content: "Invalid context.", ephemeral: true });
    return;
  }
  if (!memberHasAdminRole(interaction.member, interaction.guild)) {
    await interaction.reply({
      content: `You need the **${ADMIN_ROLE_NAME}** role.`,
      ephemeral: true,
    });
    return;
  }
  const m = /^maze:rs:(y|n):(\d+)$/.exec(interaction.customId);
  if (!m) {
    await interaction.reply({ content: "Invalid button.", ephemeral: true });
    return;
  }
  const rustServerId = Number.parseInt(m[2] ?? "", 10);
  const guildRowId = await getOrCreateGuildRow(pool, interaction.guild.id);

  if (m[1] === "n") {
    await interaction.update({
      content: "Okay — automation settings unchanged.",
      embeds: [],
      components: [],
    });
    return;
  }

  const cfg = await getMazeConfig(pool, guildRowId, rustServerId);
  if (!cfg || !isMazeAutomationConfigComplete(cfg)) {
    await interaction.update({
      content: "Setup is incomplete. Run **/maze-setup** first.",
      embeds: [],
      components: [],
    });
    return;
  }

  // If a lobby is currently open, "force start" should close the lobby window and start the match now.
  const active = await getActiveMazeEvent(pool, guildRowId, rustServerId);
  if (active?.status === "lobby") {
    const members = await countMazeEventMembers(pool, active.id);
    if (members < 1) {
      await interaction.update({
        embeds: [
          baseEmbed()
            .setTitle("No players in lobby")
            .setDescription("At least **1** player must join the Maze lobby before you can force start it."),
        ],
        components: [],
      });
      return;
    }

    const missing = await listMissingMazeSpawnCoords(pool, guildRowId, rustServerId, cfg.spawnPoints);
    if (missing.length > 0) {
      await interaction.update({
        embeds: [
          baseEmbed()
            .setTitle("Missing spawn coordinates")
            .setDescription(
              `Configure Maze spawn positions in **/manage-positions** first. Missing slot(s): **${missing.join(", ")}**.`
            ),
        ],
        components: [],
      });
      return;
    }

    const ok = await startMazeAutomation(pool, guildRowId, rustServerId);
    if (!ok.ok) {
      await interaction.update({
        content: ok.error ?? "Could not start Maze automation.",
        embeds: [],
        components: [],
      });
      return;
    }

    // Start the match and update the lobby embed to reflect "started".
    const { startMazeMatchFromLobby } = await import("./automation.js");
    const started = await startMazeMatchFromLobby(pool, interaction.client, guildRowId, rustServerId, active.id);
    if (!started) {
      await interaction.update({
        embeds: [
          baseEmbed()
            .setTitle("Could not start")
            .setDescription("Failed to start the Maze from the lobby. Check RCON/config and try again."),
        ],
        components: [],
      });
      return;
    }

    try {
      const servers = await listRustServersForGuild(pool, guildRowId);
      const srv = servers.find((s) => String(s.id) === String(rustServerId));
      const serverName = srv?.nickname ?? "Server";
      const views = await listMazeSpawnViews(pool, guildRowId, active.id);
      const meta = await getActiveMazeEventMeta(pool, guildRowId, rustServerId);
      const durationMinutes = meta?.durationMinutes ?? cfg.durationMinutes ?? null;
      const countdownEndsAtMs =
        meta?.startedAtMs != null && durationMinutes != null ? meta.startedAtMs + durationMinutes * 60_000 : null;
      await updateMazeMessage(
        interaction.client,
        cfg.announcementChannelId,
        cfg.messageId!,
        serverName,
        serverName,
        views,
        durationMinutes,
        countdownEndsAtMs
      );
    } catch (e) {
      console.error("[maze force start] failed to update lobby message:", e);
    }

    await interaction.update({
      embeds: [
        baseEmbed()
          .setTitle("Maze force started")
          .setDescription("Lobby closed — the Maze match is starting now. (Teleport + kit are handled in-game.)"),
      ],
      components: [],
    });
    return;
  }

  // No lobby open: keep existing behavior (reset schedule so a lobby opens on next tick).
  const started = await startMazeAutomation(pool, guildRowId, rustServerId);
  if (!started.ok) {
    await interaction.update({
      content: started.error ?? "Could not restart automation.",
      embeds: [],
      components: [],
    });
    return;
  }

  await interaction.update({
    embeds: [
      baseEmbed()
        .setTitle("Maze automation")
        .setDescription("Schedule reset — the next **automatic lobby** will open on the next bot tick (usually within ~20 seconds)."),
    ],
    components: [],
  });
}
