const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  PermissionOverwrites,
  PermissionFlagsBits,
  ChannelType,
} = require('discord.js');
const pool = require('../db');

async function getNextTicketNumber(guildId) {
  const [result] = await pool.query(
    'SELECT MAX(ticket_number) as max_number FROM lucid_tickets WHERE guild_id = ?',
    [guildId]
  );
  const maxNumber = result[0]?.max_number || 0;
  return maxNumber + 1;
}

async function createTicketCategory(guild, categoryName) {
  let category = guild.channels.cache.find(
    (c) => c.type === ChannelType.GuildCategory && c.name === categoryName
  );

  if (!category) {
    category = await guild.channels.create({
      name: categoryName,
      type: ChannelType.GuildCategory,
      permissionOverwrites: [
        {
          id: guild.id,
          deny: [PermissionFlagsBits.ViewChannel],
        },
      ],
    });
  }

  return category;
}

async function showTicketModal(interaction, kind) {
  if (kind === 'rust') {
    const modal = new ModalBuilder()
      .setCustomId('ticket_modal_rusthelp')
      .setTitle('Rust Help Ticket');

    const ignInput = new TextInputBuilder()
      .setCustomId('ign_input')
      .setLabel('In Game Name')
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setPlaceholder('Enter your in-game name');

    const helpInput = new TextInputBuilder()
      .setCustomId('help_input')
      .setLabel('How can we help?')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(true)
      .setPlaceholder('Describe your issue or question...');

    const row1 = new ActionRowBuilder().addComponents(ignInput);
    const row2 = new ActionRowBuilder().addComponents(helpInput);

    modal.addComponents(row1, row2);
    await interaction.showModal(modal);
    return;
  }

  if (kind === 'discord') {
    const modal = new ModalBuilder()
      .setCustomId('ticket_modal_discordhelp')
      .setTitle('Discord Help Ticket');

    const helpInput = new TextInputBuilder()
      .setCustomId('help_input')
      .setLabel('How can we help?')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(true)
      .setPlaceholder('Describe your issue or question...');

    const row = new ActionRowBuilder().addComponents(helpInput);
    modal.addComponents(row);
    await interaction.showModal(modal);
    return;
  }

  if (kind === 'payment') {
    const modal = new ModalBuilder()
      .setCustomId('ticket_modal_purchaseshelp')
      .setTitle('Payment Support Ticket');

    const helpInput = new TextInputBuilder()
      .setCustomId('help_input')
      .setLabel('How can we help?')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(true)
      .setPlaceholder('Describe your issue or question...');

    const row = new ActionRowBuilder().addComponents(helpInput);
    modal.addComponents(row);
    await interaction.showModal(modal);
    return;
  }

  await interaction.reply({ content: 'Invalid support category.', ephemeral: true }).catch(() => {});
}

module.exports = {
  async handleButton(interaction) {
    const customId = interaction.customId;

    // Backwards-compatible: old button panels still open the same modals.
    if (customId === 'ticket_rusthelp') {
      await showTicketModal(interaction, 'rust');
    } else if (customId === 'ticket_discordhelp') {
      await showTicketModal(interaction, 'discord');
    } else if (customId === 'ticket_purchaseshelp') {
      await showTicketModal(interaction, 'payment');
    } else if (customId === 'ticket_claim') {
      // Check if user has admin permissions
      const adminRoleName = 'Lucid Admin';
      const member = interaction.member;
      const hasAdminRole = member.roles.cache.some(role => role.name === adminRoleName) || member.permissions.has('Administrator');

      let hasTicketAdminRole = false;
      const [configResult] = await pool.query(
        'SELECT admin_role_id FROM lucid_ticket_config WHERE guild_id = ?',
        [interaction.guild.id]
      );
      if (configResult.length > 0) {
        hasTicketAdminRole = member.roles.cache.has(configResult[0].admin_role_id);
      }

      if (!hasAdminRole && !hasTicketAdminRole) {
        return interaction.reply({
          content: 'Only admins can claim tickets.',
          ephemeral: true,
        });
      }

      // Defer so we don't hit the 3s interaction deadline (and so double-clicks don't spam replies).
      await interaction.deferReply({ ephemeral: true }).catch(() => {});

      // Atomic claim: only one click wins (prevents duplicate "claimed" messages).
      const [res] = await pool.query(
        `UPDATE lucid_tickets
         SET status = 'claimed', claimed_by = ?
         WHERE channel_id = ? AND status = 'open'`,
        [interaction.user.id, interaction.channel.id]
      );

      const affected = typeof res === 'object' && res && 'affectedRows' in res ? Number(res.affectedRows) : 0;
      if (affected < 1) {
        return interaction.editReply({
          content: 'This ticket is already claimed.',
        }).catch(() => {});
      }

      // Update channel name to show claimed (best-effort; doesn't affect claim state).
      const channelName = interaction.channel.name ?? '';
      const baseName = channelName.replace('🟢-', '').replace('🏁-', '').split('-')[0];
      interaction.channel.setName(`🟢-${baseName}-claimed`).catch(() => {});

      const claimEmbed = new EmbedBuilder()
        .setColor(0x00CED1) // Cyan
        .setTitle('Ticket Claimed')
        .setDescription(`This ticket has been claimed by ${interaction.user}`)
        .setTimestamp();

      await interaction.channel.send({ embeds: [claimEmbed] });
      await interaction.editReply({ content: '✅ Ticket claimed successfully!' }).catch(() => {});
    } else if (customId === 'ticket_close') {
      // Update channel name immediately to show closed emoji
      const currentName = interaction.channel.name;
      const newName = currentName.replace('🟢', '🏁').replace('-claimed', '');
      try {
        await interaction.channel.setName(newName);
      } catch (error) {
        console.error('Error updating channel name:', error);
      }

      await interaction.reply({
        content: 'This ticket will be closed in 1 minute...',
      });
      
      setTimeout(async () => {
        await this.closeTicket(interaction.channel, interaction.guild, `Closed by ${interaction.user.tag}`);
      }, 60000); // 1 minute
    }
  },

  async handleTicketCategorySelect(interaction) {
    const v = String(interaction.values?.[0] ?? '');
    await showTicketModal(interaction, v);
  },

  async handleModal(interaction) {
    // Defer reply IMMEDIATELY to prevent timeout (must respond within 3 seconds)
    let deferred = false;
    try {
      await interaction.deferReply({ ephemeral: true });
      deferred = true;
    } catch (error) {
      console.error('Error deferring reply:', error);
      // Try to reply normally if defer fails
      try {
        await interaction.reply({ content: 'Processing your ticket...', ephemeral: true });
        deferred = true;
      } catch (replyError) {
        console.error('Error replying to interaction:', replyError);
        return; // Can't respond, interaction is dead
      }
    }

    try {
      const modalId = interaction.customId;
      const categoryMap = {
        'ticket_modal_rusthelp': 'Rust Help',
        'ticket_modal_discordhelp': 'Discord Help',
        'ticket_modal_purchaseshelp': 'Purchases Help',
      };

      const categoryName = categoryMap[modalId] || 'Support';

      // Get ticket number from database
      const ticketNumber = await getNextTicketNumber(interaction.guild.id);

    // Create category if it doesn't exist
    const category = await createTicketCategory(interaction.guild, categoryName);

    // Get admin role from database
    let adminRoleId = null;
    const [configResult] = await pool.query(
      'SELECT admin_role_id FROM lucid_ticket_config WHERE guild_id = ?',
      [interaction.guild.id]
    );
    if (configResult.length > 0) {
      adminRoleId = configResult[0].admin_role_id;
    }

    // Create ticket channel
    const channelName = `${interaction.user.username}-${ticketNumber}`.toLowerCase().replace(/[^a-z0-9-]/g, '');
    const ticketChannel = await interaction.guild.channels.create({
      name: `🟢-${channelName}`,
      type: ChannelType.GuildText,
      parent: category.id,
      permissionOverwrites: [
        {
          id: interaction.guild.id,
          deny: [PermissionFlagsBits.ViewChannel],
        },
        {
          id: interaction.user.id,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory,
          ],
        },
        ...(adminRoleId ? [{
          id: adminRoleId,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory,
            PermissionFlagsBits.ManageMessages,
          ],
        }] : []),
      ],
    });

    // Build embed based on modal type
    const embed = new EmbedBuilder()
      .setColor(0x6A0DAD) // Deep purple
      .setTitle(`${categoryName} Ticket #${ticketNumber}`)
      .setDescription('Thank you for contacting support. A team member will assist you shortly.')
      .setFooter({ text: `Ticket created by ${interaction.user.tag}` })
      .setTimestamp();

    let inGameName = null;
    let helpMessage = '';

    if (modalId === 'ticket_modal_rusthelp') {
      inGameName = interaction.fields.getTextInputValue('ign_input');
      helpMessage = interaction.fields.getTextInputValue('help_input');
      embed.addFields(
        { name: 'In Game Name', value: inGameName, inline: false },
        { name: 'How can we help?', value: helpMessage, inline: false }
      );
    } else {
      helpMessage = interaction.fields.getTextInputValue('help_input');
      embed.addFields(
        { name: 'How can we help?', value: helpMessage, inline: false }
      );
    }

    // Create action buttons
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('ticket_claim')
        .setLabel('Claim Ticket')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId('ticket_close')
        .setLabel('Close Ticket')
        .setStyle(ButtonStyle.Danger)
    );

      await ticketChannel.send({
        content: `${interaction.user} ${adminRoleId ? `<@&${adminRoleId}>` : ''}`,
        embeds: [embed],
        components: [row],
      });

      // Save ticket to database
      await pool.query(
        `INSERT INTO lucid_tickets 
         (guild_id, channel_id, user_id, ticket_number, category, status, in_game_name, help_message, admin_role_id)
         VALUES (?, ?, ?, ?, ?, 'open', ?, ?, ?)`,
        [
          interaction.guild.id,
          ticketChannel.id,
          interaction.user.id,
          ticketNumber,
          categoryName,
          inGameName,
          helpMessage,
          adminRoleId,
        ]
      );

      if (deferred) {
        await interaction.editReply({
          content: `✅ Your ticket has been created: ${ticketChannel}`,
        });
      } else {
        await interaction.followUp({
          content: `✅ Your ticket has been created: ${ticketChannel}`,
          ephemeral: true,
        });
      }
    } catch (error) {
      console.error('Error in handleModal:', error);
      console.error('Error stack:', error.stack);
      
      // Try to send error message
      try {
        if (deferred) {
          await interaction.editReply({
            content: '❌ There was an error creating your ticket. Please try again or contact an admin.',
          });
        } else if (interaction.replied || interaction.deferred) {
          await interaction.followUp({
            content: '❌ There was an error creating your ticket. Please try again or contact an admin.',
            ephemeral: true,
          });
        } else {
          await interaction.reply({
            content: '❌ There was an error creating your ticket. Please try again or contact an admin.',
            ephemeral: true,
          });
        }
      } catch (replyError) {
        console.error('Error sending error message:', replyError);
      }
    }
  },

  async closeTicket(channel, guild, reason) {
    try {
      // Update ticket in database
      await pool.query(
        `UPDATE lucid_tickets 
         SET status = 'closed', closed_at = CURRENT_TIMESTAMP 
         WHERE channel_id = ?`,
        [channel.id]
      );

      // Update channel name (emoji should already be changed, but ensure it's correct)
      const currentName = channel.name;
      const newName = currentName.replace('🟢', '🏁').replace('-claimed', '');
      if (currentName !== newName) {
        await channel.setName(newName);
      }

      const closeEmbed = new EmbedBuilder()
        .setColor(0x6A0DAD) // Deep purple
        .setTitle('Ticket Closed')
        .setDescription(`This ticket has been closed.\n\nReason: ${reason}`)
        .setTimestamp();

      await channel.send({ embeds: [closeEmbed] });

      // Disable sending messages
      await channel.permissionOverwrites.edit(guild.id, {
        SendMessages: false,
      });

      // Delete channel after 5 seconds
      setTimeout(async () => {
        try {
          await channel.delete();
        } catch (error) {
          console.error('Error deleting ticket channel:', error);
        }
      }, 5000);
    } catch (error) {
      console.error('Error closing ticket:', error);
    }
  },
};

