const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, ChannelType, AttachmentBuilder } = require('discord.js');
const pool = require('../db');
const fs = require('fs');
const path = require('path');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ticket-system')
    .setDescription('Set up the ticket system panel')
    .addChannelOption(option =>
      option
        .setName('channel')
        .setDescription('Channel where the ticket panel will be sent')
        .setRequired(true)
        .addChannelTypes(ChannelType.GuildText)
    )
    .addStringOption(option =>
      option
        .setName('heading')
        .setDescription('Heading for the ticket panel')
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName('description_1')
        .setDescription('Sub-heading line 1')
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName('description_2')
        .setDescription('Sub-heading line 2')
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName('description_3')
        .setDescription('Sub-heading line 3')
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName('description_4')
        .setDescription('Sub-heading line 4')
        .setRequired(true)
    )
    .addRoleOption(option =>
      option
        .setName('adminrole')
        .setDescription('Admin role that can manage tickets')
        .setRequired(true)
    ),
  async execute(interaction) {
    // Defer immediately so the interaction can't expire mid-setup.
    await interaction.deferReply({ ephemeral: true }).catch(() => {});

    // Check if user has admin permissions
    const adminRoleName = 'Lucid Admin';
    const member = interaction.member;
    const hasAdminRole = member.roles.cache.some(role => role.name === adminRoleName) || member.permissions.has('Administrator');

    if (!hasAdminRole) {
      return interaction.editReply({
        content: 'You do not have permission to use this command.',
      });
    }

    const channel = interaction.options.getChannel('channel');
    const heading = interaction.options.getString('heading');
    const description1 = interaction.options.getString('description_1');
    const description2 = interaction.options.getString('description_2');
    const description3 = interaction.options.getString('description_3');
    const description4 = interaction.options.getString('description_4');
    const adminRole = interaction.options.getRole('adminrole');

    // Create the embed with purple and cyan theme
    const embed = new EmbedBuilder()
      .setColor(0x6A0DAD) // Deep purple
      .setTitle(heading)
      // Keep the description area empty; render sub-headings as fields for a cleaner layout.
      // Discord does not allow an empty string description.
      .setDescription('\u200B')
      .addFields(
        { name: description1, value: '\u200B', inline: false },
        { name: '\u200B', value: '\u200B', inline: false },
        { name: description2, value: '\u200B', inline: false },
        { name: '\u200B', value: '\u200B', inline: false },
        { name: description3, value: '\u200B', inline: false },
        { name: '\u200B', value: '\u200B', inline: false },
        { name: description4, value: '\u200B', inline: false }
      )
      .addFields(
        {
          name: 'Admin Role',
          value: `${adminRole}`,
          inline: true,
        }
      )
      .setFooter({ text: 'Lucid Support System' })
      .setTimestamp();

    // Attach support image under the text (if it exists)
    const supportImagePath = path.join(__dirname, '..', '..', 'assets', 'lucid_support.png');
    const files = [];
    if (fs.existsSync(supportImagePath)) {
      const attachment = new AttachmentBuilder(supportImagePath, { name: 'lucid_support.png' });
      embed.setImage('attachment://lucid_support.png');
      files.push(attachment);
    }

    // Create dropdown category selector (replaces buttons)
    const select = new StringSelectMenuBuilder()
      .setCustomId('ticket_category_select')
      .setPlaceholder('Select a support category…')
      .addOptions(
        { label: '☢️ Rust Support', value: 'rust' },
        { label: '🤖 Discord Support', value: 'discord' },
        { label: '💶 Payment support', value: 'payment' }
      );
    const row = new ActionRowBuilder().addComponents(select);

    try {
      // Reuse an existing panel message if one exists in the channel
      // (prevents "duplicate" panels when the command is run twice).
      let panelMsg = null;
      try {
        const recent = await channel.messages.fetch({ limit: 25 });
        panelMsg =
          recent.find((m) => {
            const footer = m.embeds?.[0]?.footer?.text ?? "";
            const hasTicketSelect =
              (m.components?.[0]?.components ?? []).some((c) => c.customId === "ticket_category_select");
            return m.author?.id === interaction.client.user.id && footer === "Lucid Support System" && hasTicketSelect;
          }) ?? null;
      } catch {
        panelMsg = null;
      }

      if (panelMsg) {
        await panelMsg.edit({ embeds: [embed], components: [row], files: files.length ? files : undefined });
      } else {
        await channel.send({ embeds: [embed], components: [row], files: files.length ? files : undefined });
      }

      // Store admin role in database
      await pool.query(
        `INSERT INTO lucid_ticket_config (guild_id, admin_role_id, panel_channel_id)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE
         admin_role_id = VALUES(admin_role_id),
         panel_channel_id = VALUES(panel_channel_id),
         updated_at = CURRENT_TIMESTAMP`,
        [interaction.guild.id, adminRole.id, channel.id]
      );

      await interaction.editReply({
        content: panelMsg
          ? `✅ Ticket system panel was updated in ${channel}!`
          : `✅ Ticket system panel has been sent to ${channel}!`,
      });
    } catch (error) {
      console.error('Error sending ticket panel:', error);
      await interaction.editReply({
        content: 'There was an error sending the ticket panel. Please check my permissions.',
      });
    }
  },
};

