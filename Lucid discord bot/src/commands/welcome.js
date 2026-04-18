const { SlashCommandBuilder, ChannelType } = require('discord.js');
const pool = require('../db');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('welcome')
    .setDescription('Set the welcome channel for new members')
    .addChannelOption(option =>
      option
        .setName('channel')
        .setDescription('Channel where welcome messages will be sent')
        .setRequired(true)
        .addChannelTypes(ChannelType.GuildText)
    ),
  async execute(interaction) {
    // Check if user has admin permissions
    const adminRoleName = 'Lucid Admin';
    const member = interaction.member;
    const hasAdminRole = member.roles.cache.some(role => role.name === adminRoleName) || member.permissions.has('Administrator');

    if (!hasAdminRole) {
      return interaction.reply({
        content: 'You do not have permission to use this command.',
        ephemeral: true,
      });
    }

    const channel = interaction.options.getChannel('channel');

    try {
      console.log(`[WELCOME COMMAND] Setting welcome channel for guild ${interaction.guild.id} (${interaction.guild.name}) to channel ${channel.id} (${channel.name})`);
      
      // Store welcome channel in database
      const result = await pool.query(
        `INSERT INTO lucid_welcome_config (guild_id, welcome_channel_id)
         VALUES (?, ?)
         ON DUPLICATE KEY UPDATE
         welcome_channel_id = VALUES(welcome_channel_id),
         updated_at = CURRENT_TIMESTAMP`,
        [interaction.guild.id, channel.id]
      );

      console.log(`[WELCOME COMMAND] Database update result:`, result);
      
      // Verify it was saved
      const [verify] = await pool.query(
        'SELECT welcome_channel_id FROM lucid_welcome_config WHERE guild_id = ?',
        [interaction.guild.id]
      );
      console.log(`[WELCOME COMMAND] Verification query result:`, verify);

      await interaction.reply({
        content: `✅ Welcome channel set to ${channel}! New members will receive welcome messages there.`,
        ephemeral: true,
      });
    } catch (error) {
      console.error('[WELCOME COMMAND] Error setting welcome channel:', error);
      console.error('[WELCOME COMMAND] Error stack:', error.stack);
      await interaction.reply({
        content: `There was an error setting the welcome channel: ${error.message}. Please try again.`,
        ephemeral: true,
      });
    }
  },
};


