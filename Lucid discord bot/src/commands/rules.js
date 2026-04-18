const { SlashCommandBuilder, ChannelType, EmbedBuilder, AttachmentBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('rules')
    .setDescription('Send the server rules to a channel')
    .addChannelOption(option =>
      option
        .setName('channel')
        .setDescription('Channel where rules will be sent')
        .setRequired(true)
        .addChannelTypes(ChannelType.GuildText)
    )
    .addStringOption(option =>
      option
        .setName('discord')
        .setDescription('Discord rules text')
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName('in_game')
        .setDescription('In-game rules text')
        .setRequired(true)
    ),
  async execute(interaction) {
    try {
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

      await interaction.deferReply({ ephemeral: true });

      const channel = interaction.options.getChannel('channel');
      const discordRules = interaction.options.getString('discord');
      const inGameRules = interaction.options.getString('in_game');

      // Validate rules text length (Discord embed field limit is 1024 characters)
      if (discordRules.length > 1024) {
        return interaction.editReply({
          content: '❌ Discord rules text is too long (max 1024 characters).',
        });
      }

      if (inGameRules.length > 1024) {
        return interaction.editReply({
          content: '❌ In-game rules text is too long (max 1024 characters).',
        });
      }

      // Create embed with purple color
      const embed = new EmbedBuilder()
        .setColor(0x6A0DAD) // Deep purple
        .setTitle('**📜 SERVER RULES**')
        .addFields(
          {
            name: '**LUCID DISCORD RULES**',
            value: discordRules,
            inline: false
          },
          {
            name: '**LUCID IN GAME RULES**',
            value: inGameRules,
            inline: false
          }
        )
        .setTimestamp()
        .setFooter({ text: 'Lucid Clans - Server Rules' });

      // Check if image exists
      const imagePath = path.join(__dirname, '../../assets/rules_image.png');
      const files = [];
      
      if (fs.existsSync(imagePath)) {
        try {
          const attachment = new AttachmentBuilder(imagePath, { name: 'rules_image.png' });
          embed.setImage('attachment://rules_image.png');
          files.push(attachment);
        } catch (imageError) {
          console.error('[RULES] Error creating image attachment:', imageError);
        }
      } else {
        console.warn(`[RULES] Image not found at ${imagePath}`);
      }

      // Send message to the specified channel
      await channel.send({
        embeds: [embed],
        files: files.length > 0 ? files : undefined
      });

      await interaction.editReply({
        content: `✅ Rules sent to ${channel}!`,
      });
    } catch (error) {
      console.error('[RULES] Error executing rules command:', error);
      const errorMessage = error.message || 'Unknown error occurred';
      console.error('[RULES] Error details:', errorMessage);
      
      try {
        if (interaction.deferred || interaction.replied) {
          await interaction.editReply({
            content: `❌ There was an error sending the rules: ${errorMessage}`,
          });
        } else {
          await interaction.reply({
            content: `❌ There was an error sending the rules: ${errorMessage}`,
            ephemeral: true,
          });
        }
      } catch (replyError) {
        console.error('[RULES] Error sending error message:', replyError);
      }
    }
  },
};
