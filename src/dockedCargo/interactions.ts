import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type ChannelSelectMenuInteraction,
  type ModalSubmitInteraction,
  type Message,
} from "discord.js";
import { memberHasAdminRole } from "../admin/guildAdmin.js";
import { ADMIN_ROLE_NAME } from "../constants.js";
import { getOrCreateGuildRow } from "../db/guilds.js";
import { pool } from "../db/pool.js";
import {
  getDockedCargoConfig,
  isDockedCargoConfigComplete,
  mergeDockedCargoConfig,
} from "../db/dockedCargo.js";
import { baseEmbed } from "../embeds/standard.js";
import { validateServerSelection } from "../commands/shared/serverOption.js";
import { startDockedCargoAutomation } from "./runner.js";

const PREFIX = "dc";

export function dockedCargoButtonCustomId(kind: "coords" | "often" | "msg" | "cargo", rustServerId: number): string {
  return `${PREFIX}:b:${kind}:${rustServerId}`;
}

export function dockedCargoModalCustomId(kind: string, rustServerId: number): string {
  return `${PREFIX}:m:${kind}:${rustServerId}`;
}

export function dockedCargoChannelCustomId(rustServerId: number): string {
  return `${PREFIX}:ch:${rustServerId}`;
}

function parseServerId(customId: string): number | null {
  const parts = customId.split(":");
  const n = Number.parseInt(parts[parts.length - 1] ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function buildDockedCargoSetupComponents(rustServerId: number) {
  const row1 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(dockedCargoButtonCustomId("coords", rustServerId))
      .setLabel("Coordinates")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(dockedCargoButtonCustomId("often", rustServerId))
      .setLabel("How often (hours)")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(dockedCargoButtonCustomId("msg", rustServerId))
      .setLabel("In-game messages")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(dockedCargoButtonCustomId("cargo", rustServerId))
      .setLabel("Cargo settings")
      .setStyle(ButtonStyle.Primary)
  );
  const row2 = new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
    new ChannelSelectMenuBuilder()
      .setCustomId(dockedCargoChannelCustomId(rustServerId))
      .setPlaceholder("Announcement channel")
      .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
      .setMinValues(1)
      .setMaxValues(1)
  );
  return [row1, row2];
}

export function buildDockedCargoSetupEmbed(saved: boolean): ReturnType<typeof baseEmbed> {
  if (saved) {
    return baseEmbed()
      .setTitle("Docked Cargo — saved")
      .setDescription("**Your entries were saved!**");
  }
  return baseEmbed()
    .setTitle("Docked Cargo — setup")
    .setDescription(
      "**Let's get your Auto event setup.**\n\nChoose from the buttons below to setup your Cargo event, then pick an **announcement channel** from the dropdown."
    );
}

function parseCoords(raw: string): { x: number; y: number; z: number } | null {
  const s = raw.trim().replace(/\s+/g, "");
  const parts = s.split(",").filter(Boolean);
  if (parts.length !== 3) return null;
  const x = Number.parseFloat(parts[0]!);
  const y = Number.parseFloat(parts[1]!);
  const z = Number.parseFloat(parts[2]!);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
  return { x, y, z };
}

async function tryFinishSetupMessage(
  message: Message | null,
  guildRowId: number,
  rustServerId: number
): Promise<void> {
  if (!message?.editable) return;
  const cfg = await getDockedCargoConfig(pool, guildRowId, rustServerId);
  if (!cfg || !isDockedCargoConfigComplete(cfg)) return;
  await message.edit({
    embeds: [buildDockedCargoSetupEmbed(true)],
    components: [],
  });
}

export async function handleDockedCargoButton(interaction: ButtonInteraction): Promise<void> {
  if (!interaction.guild || !interaction.member) {
    await interaction.reply({ content: "This can only be used in a server.", ephemeral: true });
    return;
  }
  if (!memberHasAdminRole(interaction.member, interaction.guild)) {
    await interaction.reply({
      content: `You need the **${ADMIN_ROLE_NAME}** role.`,
      ephemeral: true,
    });
    return;
  }
  const rustServerId = parseServerId(interaction.customId);
  if (!rustServerId) {
    await interaction.reply({ content: "Invalid control.", ephemeral: true });
    return;
  }
  const ok = await validateServerSelection(interaction.guild.id, rustServerId);
  if (!ok) {
    await interaction.reply({ content: "Invalid server.", ephemeral: true });
    return;
  }
  const guildRowId = await getOrCreateGuildRow(pool, interaction.guild.id);

  const kind = interaction.customId.split(":")[2];

  if (kind === "coords") {
    const modal = new ModalBuilder()
      .setCustomId(dockedCargoModalCustomId("coords", rustServerId))
      .setTitle("Cargo spawn coordinates");
    const input = new TextInputBuilder()
      .setCustomId("coords")
      .setLabel("x,y,z")
      .setStyle(TextInputStyle.Short)
      .setPlaceholder("154.03,0.90,-765.32")
      .setRequired(true)
      .setMaxLength(128);
    modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));
    await interaction.showModal(modal);
    return;
  }

  if (kind === "often") {
    const modal = new ModalBuilder()
      .setCustomId(dockedCargoModalCustomId("often", rustServerId))
      .setTitle("How often (hours)");
    const input = new TextInputBuilder()
      .setCustomId("hours")
      .setLabel("Hours between full events")
      .setStyle(TextInputStyle.Short)
      .setPlaceholder("e.g. 6")
      .setRequired(true)
      .setMaxLength(10);
    modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));
    await interaction.showModal(modal);
    return;
  }

  if (kind === "msg") {
    const modal = new ModalBuilder()
      .setCustomId(dockedCargoModalCustomId("msg", rustServerId))
      .setTitle("In-game messages");
    const ig = new TextInputBuilder()
      .setCustomId("in_game")
      .setLabel("Arrival message (Rust say format)")
      .setStyle(TextInputStyle.Paragraph)
      .setPlaceholder("<color=#hex>text</color> — optional <b>, <size=>…")
      .setRequired(false)
      .setMaxLength(1800);
    const toggle = new TextInputBuilder()
      .setCustomId("toggle")
      .setLabel("Turn say commands on or off (type on or off)")
      .setStyle(TextInputStyle.Short)
      .setPlaceholder("on")
      .setRequired(true)
      .setMaxLength(3);
    const leave = new TextInputBuilder()
      .setCustomId("leave")
      .setLabel("Docked Cargo leave message")
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(false)
      .setMaxLength(1800);
    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(ig),
      new ActionRowBuilder<TextInputBuilder>().addComponents(toggle),
      new ActionRowBuilder<TextInputBuilder>().addComponents(leave)
    );
    await interaction.showModal(modal);
    return;
  }

  if (kind === "cargo") {
    const modal = new ModalBuilder()
      .setCustomId(dockedCargoModalCustomId("cargo", rustServerId))
      .setTitle("Cargo settings");
    const crates = new TextInputBuilder()
      .setCustomId("crates")
      .setLabel("Locked crates (1–5)")
      .setStyle(TextInputStyle.Short)
      .setPlaceholder("3")
      .setRequired(true)
      .setMaxLength(1);
    const mins = new TextInputBuilder()
      .setCustomId("minutes")
      .setLabel("Time docked (minutes)")
      .setStyle(TextInputStyle.Short)
      .setPlaceholder("30")
      .setRequired(true)
      .setMaxLength(6);
    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(crates),
      new ActionRowBuilder<TextInputBuilder>().addComponents(mins)
    );
    await interaction.showModal(modal);
    return;
  }

  await interaction.reply({ content: "Unknown button.", ephemeral: true });
}

export async function handleDockedCargoModal(interaction: ModalSubmitInteraction): Promise<void> {
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
  const rustServerId = parseServerId(interaction.customId);
  if (!rustServerId) {
    await interaction.reply({ content: "Invalid modal.", ephemeral: true });
    return;
  }
  const guildRowId = await getOrCreateGuildRow(pool, interaction.guild.id);
  const kind = interaction.customId.split(":")[2];

  if (kind === "coords") {
    const raw = interaction.fields.getTextInputValue("coords");
    const p = parseCoords(raw);
    if (!p) {
      await interaction.reply({
        content: "Invalid coordinates. Use **x,y,z** with three numbers (e.g. `154.03,0.90,-765.32`).",
        ephemeral: true,
      });
      return;
    }
    await mergeDockedCargoConfig(pool, guildRowId, rustServerId, {
      coordX: p.x,
      coordY: p.y,
      coordZ: p.z,
    });
    await interaction.reply({ content: "Coordinates saved.", ephemeral: true });
    await tryFinishSetupMessage(interaction.message, guildRowId, rustServerId);
    return;
  }

  if (kind === "often") {
    const raw = interaction.fields.getTextInputValue("hours").trim();
    const h = Number.parseFloat(raw);
    if (!Number.isFinite(h) || h <= 0) {
      await interaction.reply({ content: "Enter a positive number of **hours**.", ephemeral: true });
      return;
    }
    await mergeDockedCargoConfig(pool, guildRowId, rustServerId, { howOftenHours: h });
    await interaction.reply({ content: "How-often interval saved.", ephemeral: true });
    await tryFinishSetupMessage(interaction.message, guildRowId, rustServerId);
    return;
  }

  if (kind === "msg") {
    const toggleRaw = interaction.fields.getTextInputValue("toggle").trim().toLowerCase();
    const sayEnabled = toggleRaw === "on";
    if (toggleRaw !== "on" && toggleRaw !== "off") {
      await interaction.reply({ content: 'Type **on** or **off** for in-game messages.', ephemeral: true });
      return;
    }
    const inGame = interaction.fields.getTextInputValue("in_game")?.trim() ?? "";
    const leave = interaction.fields.getTextInputValue("leave")?.trim() ?? "";
    if (sayEnabled && (!inGame || !leave)) {
      await interaction.reply({
        content: "With messages **on**, both arrival and leave messages are required.",
        ephemeral: true,
      });
      return;
    }
    await mergeDockedCargoConfig(pool, guildRowId, rustServerId, {
      sayEnabled,
      inGameMessage: inGame || null,
      leaveMessage: leave || null,
    });
    await interaction.reply({ content: "Message settings saved.", ephemeral: true });
    await tryFinishSetupMessage(interaction.message, guildRowId, rustServerId);
    return;
  }

  if (kind === "cargo") {
    const cratesRaw = interaction.fields.getTextInputValue("crates").trim();
    const minRaw = interaction.fields.getTextInputValue("minutes").trim();
    const crates = Number.parseInt(cratesRaw, 10);
    const minutes = Number.parseInt(minRaw, 10);
    if (!Number.isFinite(crates) || crates < 1 || crates > 5) {
      await interaction.reply({ content: "Locked crates must be **1–5**.", ephemeral: true });
      return;
    }
    if (!Number.isFinite(minutes) || minutes < 1) {
      await interaction.reply({ content: "Time docked must be a positive number of **minutes**.", ephemeral: true });
      return;
    }
    await mergeDockedCargoConfig(pool, guildRowId, rustServerId, {
      lockedCrates: crates,
      timeDockedMinutes: minutes,
    });
    await interaction.reply({ content: "Cargo settings saved.", ephemeral: true });
    await tryFinishSetupMessage(interaction.message, guildRowId, rustServerId);
    return;
  }

  await interaction.reply({ content: "Unknown modal.", ephemeral: true });
}

export async function handleDockedCargoRestart(interaction: ButtonInteraction): Promise<void> {
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
  const m = /^dc:rs:(y|n):(\d+)$/.exec(interaction.customId);
  if (!m) {
    await interaction.reply({ content: "Invalid button.", ephemeral: true });
    return;
  }
  const rustServerId = Number.parseInt(m[2] ?? "", 10);
  const guildRowId = await getOrCreateGuildRow(pool, interaction.guild.id);

  if (m[1] === "n") {
    await interaction.update({
      content: "Okay — no changes. The automation continues on its current schedule.",
      embeds: [],
      components: [],
    });
    return;
  }

  const cfg = await getDockedCargoConfig(pool, guildRowId, rustServerId);
  if (!cfg || !isDockedCargoConfigComplete(cfg)) {
    await interaction.update({
      content: "Setup is incomplete. Run **/docked-cargo-setup** first.",
      embeds: [],
      components: [],
    });
    return;
  }

  const started = startDockedCargoAutomation(pool, guildRowId, rustServerId, { force: true });
  if (!started.ok) {
    await interaction.update({
      content: started.error ?? "Could not restart automation.",
      embeds: [],
      components: [],
    });
    return;
  }
  await mergeDockedCargoConfig(pool, guildRowId, rustServerId, { automationStarted: true });
  await interaction.update({
    embeds: [
      baseEmbed()
        .setTitle("Docked Cargo force-started")
        .setDescription("The How Often timer was reset and a new run started."),
    ],
    components: [],
  });
}

export async function handleDockedCargoChannelSelect(interaction: ChannelSelectMenuInteraction): Promise<void> {
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
  const rustServerId = parseServerId(interaction.customId);
  if (!rustServerId) {
    await interaction.reply({ content: "Invalid menu.", ephemeral: true });
    return;
  }
  const guildRowId = await getOrCreateGuildRow(pool, interaction.guild.id);
  const id = interaction.values[0];
  if (!id) {
    await interaction.reply({ content: "Pick a channel.", ephemeral: true });
    return;
  }
  await mergeDockedCargoConfig(pool, guildRowId, rustServerId, { announcementChannelId: id });
  await interaction.reply({ content: `Announcement channel set to <#${id}>.`, ephemeral: true });
  await tryFinishSetupMessage(interaction.message, guildRowId, rustServerId);
}
