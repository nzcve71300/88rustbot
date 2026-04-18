const { SlashCommandBuilder } = require('discord.js');
const pool = require('../db');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ticket-close')
    .setDescription('Close the current ticket (closes in 1 minute)'),
  async execute(interaction) {
    // Check if this is a ticket channel
    if (!interaction.channel.name.includes('-')) {
      return interaction.reply({
        content: 'This command can only be used in ticket channels.',
        ephemeral: true,
      });
    }

    // Check if user has admin permissions
    const adminRoleName = 'Lucid Admin';
    const member = interaction.member;
    const hasAdminRole = member.roles.cache.some(role => role.name === adminRoleName) || member.permissions.has('Administrator');

    // Also check if they have the configured admin role from database
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
        content: 'You do not have permission to close tickets.',
        ephemeral: true,
      });
    }

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

    // Schedule ticket closure
    setTimeout(async () => {
      try {
        const ticketHandler = require('../handlers/ticketHandler');
        await ticketHandler.closeTicket(interaction.channel, interaction.guild, 'Admin closed via command');
      } catch (error) {
        console.error('Error closing ticket:', error);
      }
    }, 60000); // 1 minute
  },
};

