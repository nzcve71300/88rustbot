import { type ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";
import { baseEmbed } from "../../embeds/standard.js";
import { pool } from "../../db/pool.js";
import { getMemberClan, updateClanDetails } from "../../db/clans.js";
import { autocompleteServerOption, validateServerSelection } from "../shared/serverOption.js";
import { ensureClanSystemEnabled } from "../../clans/guard.js";
import { refreshActiveClansPanelsForGuild } from "../../clans/activeClansPanel.js";
import { resolveRoleColor } from "../../clans/discordAssets.js";
import { syncLinkedNicknamesForClan } from "../../clans/nicknames.js";

const TAG_RE = /^[A-Za-z]{3,4}$/;

const COLOR_CHOICES = [
  { name: "🟥 Red", value: "red" },
  { name: "🟧 Orange", value: "orange" },
  { name: "🟨 Yellow", value: "yellow" },
  { name: "🟩 Green", value: "green" },
  { name: "🟦 Blue", value: "blue" },
  { name: "🟪 Purple", value: "purple" },
  { name: "⬛ Black", value: "black" },
  { name: "⬜ White", value: "white" },
  { name: "🟫 Brown", value: "brown" },
  { name: "🩷 Pink", value: "pink" },
  { name: "🩵 Cyan", value: "cyan" },
  { name: "🌿 Lime", value: "lime" },
] as const;

function toDiscordChannelName(input: string): string {
  const s = input
    .trim()
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return (s || "clan").slice(0, 100);
}

export const clanEditCommand = {
  data: new SlashCommandBuilder()
    .setName("clan-edit")
    .setDescription("Edit your clan name/tag/color (owner only).")
    .addStringOption((o) =>
      o
        .setName("server")
        .setDescription("Select a configured Rust server in this Discord (validation only).")
        .setRequired(true)
        .setAutocomplete(true)
    )
    .addStringOption((o) =>
      o
        .setName("new_name")
        .setDescription("New clan name.")
        .setRequired(true)
        .setMaxLength(64)
    )
    .addStringOption((o) =>
      o
        .setName("new_tag")
        .setDescription("New clan tag (3–4 letters).")
        .setRequired(true)
        .setMinLength(3)
        .setMaxLength(4)
    )
    .addStringOption((o) =>
      o
        .setName("new_color")
        .setDescription("New clan color.")
        .setRequired(true)
        .addChoices(...COLOR_CHOICES)
    ),

  async autocomplete(interaction: import("discord.js").AutocompleteInteraction) {
    await autocompleteServerOption(interaction, "server");
  },

  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.inGuild() || !interaction.guildId || !interaction.guild) {
      await interaction.reply({ content: "This command can only be used inside a server." });
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

    const newName = interaction.options.getString("new_name", true).trim();
    const newTagRaw = interaction.options.getString("new_tag", true).trim();
    const newTag = newTagRaw.toUpperCase();
    const newColor = interaction.options.getString("new_color", true);

    if (!newName) {
      await interaction.reply({
        embeds: [baseEmbed().setTitle("Invalid name").setDescription("Clan name can't be empty.")],
        ephemeral: true,
      });
      return;
    }
    if (!TAG_RE.test(newTag)) {
      await interaction.reply({
        embeds: [baseEmbed().setTitle("Invalid tag").setDescription("Tag must be **3–4 letters** (A-Z).")],
        ephemeral: true,
      });
      return;
    }

    await interaction.deferReply({ ephemeral: true });

    const guard = await ensureClanSystemEnabled(interaction);
    if (!guard.ok) return;
    const guildRowId = guard.guildRowId;

    const memberClan = await getMemberClan(pool, guildRowId, interaction.user.id);
    if (!memberClan) {
      await interaction.editReply({
        embeds: [baseEmbed().setTitle("No clan").setDescription("You are not currently in a clan.")],
      });
      return;
    }
    if (!memberClan.ownerDiscordUserId || String(memberClan.ownerDiscordUserId) !== String(interaction.user.id)) {
      await interaction.editReply({
        embeds: [baseEmbed().setTitle("Owner only").setDescription("Only the **clan owner** can edit the clan.")],
      });
      return;
    }

    const prevName = memberClan.clanName;
    const prevTag = memberClan.clanTag ?? "";

    try {
      const r = await updateClanDetails(pool, guildRowId, memberClan.clanId, interaction.user.id, {
        name: newName,
        tag: newTag,
        color: newColor,
      });
      if (r !== "ok") {
        await interaction.editReply({
          embeds: [baseEmbed().setTitle("Owner only").setDescription("Only the **clan owner** can edit the clan.")],
        });
        return;
      }
    } catch (e: unknown) {
      const code = typeof e === "object" && e && "code" in e ? String((e as { code: string }).code) : "";
      if (code === "ER_DUP_ENTRY") {
        await interaction.editReply({
          embeds: [
            baseEmbed()
              .setTitle("Name or tag taken")
              .setDescription("That **clan name** or **tag** is already used in this Discord. Pick a different one."),
          ],
        });
        return;
      }
      throw e;
    }

    // Best-effort: update Discord assets (role + private channel).
    const roleId = memberClan.discordRoleId?.trim() || null;
    if (roleId) {
      const role = await interaction.guild.roles.fetch(roleId).catch(() => null);
      if (role) {
        await role
          .edit({ name: newName, color: resolveRoleColor(newColor), reason: "Clan edited: update role name/color" })
          .catch(() => {});
      }
    }

    const channelId = memberClan.discordChannelId?.trim() || null;
    if (channelId) {
      const ch = await interaction.guild.channels.fetch(channelId).catch(() => null);
      if (ch && "setName" in ch) {
        const desired = toDiscordChannelName(newName);
        await (ch as { setName: (name: string, reason?: string) => Promise<unknown> })
          .setName(desired, "Clan edited: update private channel name")
          .catch(() => {});
      }
    }

    // Best-effort: update tracked /active-clans message(s).
    await refreshActiveClansPanelsForGuild(interaction.client, interaction.guild.id).catch(() => {});

    // Best-effort: update nicknames (tag may have changed).
    await syncLinkedNicknamesForClan({
      pool,
      guildRowId,
      guild: interaction.guild,
      clanId: memberClan.clanId,
    }).catch(() => {});

    await interaction.editReply({
      embeds: [
        baseEmbed()
          .setTitle("Clan updated")
          .setDescription(
            [
              `Updated **${prevName}** \`${prevTag || "—"}\` → **${newName}** \`${newTag}\`.`,
              "",
              "Role + private channel will update automatically (if the bot has permission).",
            ].join("\n")
          ),
      ],
    });
  },
};

