const { EmbedBuilder, AttachmentBuilder } = require('discord.js');
const pool = require('../db');
const fs = require('fs');
const path = require('path');

module.exports = {
  name: 'guildMemberAdd',
  async execute(member) {
    try {
      // Ensure member and guild are valid
      if (!member || !member.user || !member.guild) {
        console.error('[WELCOME] Invalid member or guild object');
        return;
      }

      console.log(`[WELCOME] New member joined: ${member.user.tag} (${member.user.id}) in guild ${member.guild.name} (${member.guild.id})`);
      
      // Ensure database connection is ready
      if (!pool) {
        console.error('[WELCOME] Database pool not available');
        return;
      }

      // Get welcome channel from database
      console.log(`[WELCOME] Querying database for guild_id: ${member.guild.id}`);
      const [configResult] = await pool.query(
        'SELECT welcome_channel_id FROM lucid_welcome_config WHERE guild_id = ?',
        [member.guild.id]
      );

      console.log(`[WELCOME] Database query result:`, configResult);

      if (configResult.length === 0) {
        // Try querying all configs to see what's in the database
        const [allConfigs] = await pool.query('SELECT guild_id, welcome_channel_id FROM lucid_welcome_config');
        console.log(`[WELCOME] All welcome configs in database:`, allConfigs);
        console.log(`[WELCOME] No welcome channel configured for guild ${member.guild.id} (${member.guild.name})`);
        console.log(`[WELCOME] Please use /welcome command to set the welcome channel`);
        return; // No welcome channel configured
      }

      const welcomeChannelId = configResult[0].welcome_channel_id;
      console.log(`[WELCOME] Looking for channel ${welcomeChannelId}`);
      
      // Try to fetch channel if not in cache
      let welcomeChannel = member.guild.channels.cache.get(welcomeChannelId);
      if (!welcomeChannel) {
        try {
          welcomeChannel = await member.guild.channels.fetch(welcomeChannelId);
        } catch (fetchError) {
          console.error(`[WELCOME] Failed to fetch channel ${welcomeChannelId}:`, fetchError.message);
          return;
        }
      }

      if (!welcomeChannel) {
        console.error(`[WELCOME] Welcome channel ${welcomeChannelId} not found in guild ${member.guild.name}`);
        return;
      }

      // Check bot permissions
      if (!welcomeChannel.permissionsFor(member.guild.members.me)?.has(['SendMessages', 'EmbedLinks'])) {
        console.error(`[WELCOME] Bot lacks permissions in channel ${welcomeChannelId}`);
        return;
      }

      // Check if welcome image exists
      const imagePath = path.join(__dirname, '../../assets/welcome-image.png');
      let attachment = null;
      
      if (fs.existsSync(imagePath)) {
        attachment = new AttachmentBuilder(imagePath, { name: 'welcome.png' });
        console.log(`[WELCOME] Found welcome image at ${imagePath}`);
      } else {
        console.log(`[WELCOME] No welcome image found at ${imagePath}`);
      }

      // Create welcome embed with purple and cyan theme
      const embed = new EmbedBuilder()
        .setColor(0x6A0DAD) // Deep purple
        .setTitle(`Welcome to Lucid RCE ${member.user.username}`)
        .setDescription(
         `To get started and enjoy everything our server has to offer, please make sure to:\n\n` +
         `• Read the <#1463871694187008062> \n` +
         `• Link your account <#1462928952401068246> \n` +
         `• Create a team (even if you play solo — teams are required to participate <#1462931978893525093> \n` +
         `• Invite your friends and earn rewards <#1463583788897538274> \n` +
         `• Claim the Discord free kit in the Lucid Store [ https://lucidrce.online ]\n\n` +
         `Have fun and enjoy your time on Lucid RCE! 🚀\n`
        )
        .setTimestamp()
        .setFooter({ text: 'Lucid RCE' });

      // Add image if it exists
      if (attachment) {
        embed.setImage('attachment://welcome.png');
      }

      // Send welcome message
      const messageOptions = {
        content: `${member}`,
        embeds: [embed],
      };
      
      if (attachment) {
        messageOptions.files = [attachment];
      }
      
      await welcomeChannel.send(messageOptions);
      console.log(`[WELCOME] ✅ Successfully sent welcome message for ${member.user.tag} in channel ${welcomeChannel.name}`);
    } catch (error) {
      console.error(`[WELCOME] ❌ Error sending welcome message for ${member.user.tag}:`, error);
      console.error('[WELCOME] Error stack:', error.stack);
    }
  },
};


