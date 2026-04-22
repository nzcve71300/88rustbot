const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
} = require('discord.js');

const pool = require('../db');

const PANEL_FOOTER = 'Lucid Server Settings';
const DEFAULT_COLOR = 0x6a0dad;

function isAdmin(member) {
  const adminRoleName = 'Lucid Admin';
  return (
    member?.roles?.cache?.some((r) => r.name === adminRoleName) ||
    member?.permissions?.has('Administrator')
  );
}

function clampColorInt(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return DEFAULT_COLOR;
  return Math.max(0, Math.min(0xffffff, Math.floor(x)));
}

function parseHexColor(input) {
  const raw = String(input ?? '').trim();
  const m = raw.match(/^#?([0-9a-fA-F]{6})$/);
  if (!m) return null;
  return Number.parseInt(m[1], 16);
}

async function getSettings(guildId) {
  const [rows] = await pool.query(
    'SELECT title, description, embed_color AS embedColor FROM lucid_server_settings WHERE guild_id = ? LIMIT 1',
    [guildId]
  );
  const r = rows?.[0];
  if (!r) {
    return { title: 'Server Settings', description: '', embedColor: DEFAULT_COLOR };
  }
  return {
    title: r.title || 'Server Settings',
    description: r.description || '',
    embedColor: clampColorInt(r.embedColor),
  };
}

async function upsertSettings(guildId, patch) {
  const existing = await getSettings(guildId);
  const next = {
    title: patch.title ?? existing.title,
    description: patch.description ?? existing.description,
    embedColor: patch.embedColor ?? existing.embedColor,
  };
  await pool.query(
    `INSERT INTO lucid_server_settings (guild_id, title, description, embed_color)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       title = VALUES(title),
       description = VALUES(description),
       embed_color = VALUES(embed_color),
       updated_at = CURRENT_TIMESTAMP`,
    [guildId, next.title, next.description, next.embedColor]
  );
  return next;
}

async function removeSettings(guildId) {
  await pool.query('DELETE FROM lucid_server_settings WHERE guild_id = ?', [guildId]);
}

function buildPanelEmbed(settings) {
  return new EmbedBuilder()
    .setColor(clampColorInt(settings.embedColor))
    .setTitle('Server Settings')
    .setDescription(
      [
        '**Edit your server settings** by clicking the **Edit** button',
        '**Remove your server settings** with the **Remove** button',
        '**Edit your server settings embed color** with the **Embed Color** button',
        '**Save your server settings** by clicking the **Save** button',
        '**Send your server settings to a channel** by using the drop down category.',
        '',
        '—',
        `**Current title:** ${settings.title ? `**${settings.title}**` : '`(not set)`'}`,
        `**Current description:** ${settings.description ? settings.description.slice(0, 250) : '`(not set)`'}`,
      ].join('\n')
    )
    .setFooter({ text: PANEL_FOOTER })
    .setTimestamp();
}

function buildComponents() {
  const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('ss:edit').setLabel('Edit').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('ss:color').setLabel('Embed Color').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('ss:save').setLabel('Save').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('ss:remove').setLabel('Remove').setStyle(ButtonStyle.Danger)
  );

  const channelSelect = new ChannelSelectMenuBuilder()
    .setCustomId('ss:send')
    .setPlaceholder('Send server settings to a channel…')
    .setChannelTypes(ChannelType.GuildText);
  const channelRow = new ActionRowBuilder().addComponents(channelSelect);

  return [buttons, channelRow];
}

function buildEditModal(settings) {
  const modal = new ModalBuilder().setCustomId('ssmodal:edit').setTitle('Edit server settings');
  const title = new TextInputBuilder()
    .setCustomId('title')
    .setLabel('Embed title')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(256)
    .setValue(String(settings.title ?? 'Server Settings').slice(0, 256));
  const desc = new TextInputBuilder()
    .setCustomId('description')
    .setLabel('Embed description')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false)
    .setMaxLength(4000)
    .setValue(String(settings.description ?? '').slice(0, 4000));

  modal.addComponents(
    new ActionRowBuilder().addComponents(title),
    new ActionRowBuilder().addComponents(desc)
  );
  return modal;
}

function buildColorModal(settings) {
  const modal = new ModalBuilder().setCustomId('ssmodal:color').setTitle('Set embed color');
  const color = new TextInputBuilder()
    .setCustomId('hex')
    .setLabel('Hex color (example: #6A0DAD)')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(7)
    .setValue(`#${clampColorInt(settings.embedColor).toString(16).padStart(6, '0').toUpperCase()}`);
  modal.addComponents(new ActionRowBuilder().addComponents(color));
  return modal;
}

async function renderPanelMessage(channel, guildId) {
  const settings = await getSettings(guildId);
  const embed = buildPanelEmbed(settings);
  const components = buildComponents();

  // Try to re-use the latest panel we sent (prevents duplicates).
  let existing = null;
  try {
    const recent = await channel.messages.fetch({ limit: 25 });
    existing =
      recent.find((m) => m.author?.id === channel.client.user.id && m.embeds?.[0]?.footer?.text === PANEL_FOOTER) ??
      null;
  } catch {
    existing = null;
  }

  if (existing) {
    await existing.edit({ embeds: [embed], components });
    return existing;
  }
  return await channel.send({ embeds: [embed], components });
}

async function handleButton(interaction) {
  if (!interaction.inGuild()) return;
  if (!isAdmin(interaction.member)) {
    await interaction.reply({ content: '❌ You do not have permission to use this.', ephemeral: true }).catch(() => {});
    return;
  }

  const guildId = interaction.guildId;
  const settings = await getSettings(guildId);

  if (interaction.customId === 'ss:edit') {
    await interaction.showModal(buildEditModal(settings));
    return;
  }
  if (interaction.customId === 'ss:color') {
    await interaction.showModal(buildColorModal(settings));
    return;
  }
  if (interaction.customId === 'ss:remove') {
    await removeSettings(guildId);
    await interaction.reply({ content: '✅ Server settings removed.', ephemeral: true }).catch(() => {});
    // Update panel if this button came from it.
    const embed = buildPanelEmbed(await getSettings(guildId));
    const components = buildComponents();
    await interaction.message.edit({ embeds: [embed], components }).catch(() => {});
    return;
  }
  if (interaction.customId === 'ss:save') {
    // Settings are already upserted via modals; Save just confirms + refreshes the panel.
    const embed = buildPanelEmbed(settings);
    const components = buildComponents();
    await interaction.message.edit({ embeds: [embed], components }).catch(() => {});
    await interaction.reply({ content: '✅ Saved.', ephemeral: true }).catch(() => {});
  }
}

async function handleModal(interaction) {
  if (!interaction.inGuild()) return;
  if (!isAdmin(interaction.member)) {
    await interaction.reply({ content: '❌ You do not have permission to use this.', ephemeral: true }).catch(() => {});
    return;
  }
  const guildId = interaction.guildId;

  if (interaction.customId === 'ssmodal:edit') {
    const title = interaction.fields.getTextInputValue('title')?.trim() || 'Server Settings';
    const description = interaction.fields.getTextInputValue('description')?.trim() || '';
    const next = await upsertSettings(guildId, { title, description });
    // Refresh panel if possible.
    const embed = buildPanelEmbed(next);
    const components = buildComponents();
    await interaction.message?.edit?.({ embeds: [embed], components }).catch(() => {});
    await interaction.reply({ content: '✅ Updated. Click **Save** when you’re ready.', ephemeral: true }).catch(() => {});
    return;
  }

  if (interaction.customId === 'ssmodal:color') {
    const hex = interaction.fields.getTextInputValue('hex');
    const parsed = parseHexColor(hex);
    if (parsed == null) {
      await interaction.reply({ content: '❌ Invalid hex. Use something like `#6A0DAD`.', ephemeral: true }).catch(() => {});
      return;
    }
    const next = await upsertSettings(guildId, { embedColor: parsed });
    const embed = buildPanelEmbed(next);
    const components = buildComponents();
    await interaction.message?.edit?.({ embeds: [embed], components }).catch(() => {});
    await interaction.reply({ content: `✅ Color set to **#${parsed.toString(16).padStart(6, '0').toUpperCase()}**.`, ephemeral: true }).catch(() => {});
  }
}

async function handleChannelSelect(interaction) {
  if (!interaction.inGuild()) return;
  if (!isAdmin(interaction.member)) {
    await interaction.reply({ content: '❌ You do not have permission to use this.', ephemeral: true }).catch(() => {});
    return;
  }
  const channelId = interaction.values?.[0];
  const channel = interaction.guild.channels.cache.get(channelId);
  if (!channel || channel.type !== ChannelType.GuildText) {
    await interaction.reply({ content: '❌ Invalid channel selection.', ephemeral: true }).catch(() => {});
    return;
  }
  const settings = await getSettings(interaction.guildId);
  const embed = new EmbedBuilder()
    .setColor(clampColorInt(settings.embedColor))
    .setTitle(settings.title || 'Server Settings')
    .setDescription(settings.description || '\u200B')
    .setTimestamp();
  await channel.send({ embeds: [embed] });
  await interaction.reply({ content: `✅ Sent to ${channel}.`, ephemeral: true }).catch(() => {});
}

module.exports = {
  renderPanelMessage,
  handleButton,
  handleModal,
  handleChannelSelect,
};

