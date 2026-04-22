const { EmbedBuilder, AttachmentBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');

module.exports = {
  name: 'messageCreate',
  async execute(message) {
    // Ignore bot messages
    if (message.author.bot) return;
    
    // Check for prefix commands
    const prefix = '!';
    if (!message.content.startsWith(prefix)) return;
    
    const args = message.content.slice(prefix.length).trim().split(/ +/);
    const commandName = args.shift().toLowerCase();

    // Handle !serversettings command (admin only)
    if (commandName === 'serversettings') {
      try {
        const adminRoleName = 'Lucid Admin';
        const member = message.member;
        const hasAdminRole =
          member?.roles?.cache?.some(role => role.name === adminRoleName) ||
          member?.permissions?.has('Administrator');

        if (!hasAdminRole) {
          return message.reply('❌ You do not have permission to use this command.');
        }

        const serverSettingsHandler = require('../handlers/serverSettingsHandler');
        await serverSettingsHandler.renderPanelMessage(message.channel, message.guild.id);
        await message.delete().catch(() => {});
      } catch (error) {
        console.error('Error executing !serversettings command:', error);
        await message.reply('❌ An error occurred while executing the serversettings command.');
      }
      return;
    }
    
    // Handle !store command
    if (commandName === 'store') {
      try {
        // Create embed
        const embed = new EmbedBuilder()
          .setColor(0x6A0DAD) // Deep purple
          .setTitle('**LUCID STORE**')
          .setDescription(
            '**Welcome to the Lucid Store.**\n\n' +
            'Thank you for your interest in buying something we appreciate it a lot. Your presence already means a lot to us.\n\n' +
            'If you are satisfied with your purchase react with a ✅'
          )
          .setTimestamp();
        
        // Check if image exists
        const imagePath = path.join(__dirname, '../../assets/store_image.png');
        let attachment = null;
        
        if (fs.existsSync(imagePath)) {
          attachment = new AttachmentBuilder(imagePath, { name: 'store_image.png' });
          embed.setImage('attachment://store_image.png');
        }
        
        // Create button using ActionRowBuilder and ButtonBuilder
        const button = new ActionRowBuilder()
          .addComponents(
            new ButtonBuilder()
              .setCustomId('store_buy_button')
              .setLabel('Buy')
              .setStyle(ButtonStyle.Primary)
          );
        
        // Send message with embed and button
        await message.channel.send({
          embeds: [embed],
          components: [button],
          files: attachment ? [attachment] : []
        });
        
      } catch (error) {
        console.error('Error executing !store command:', error);
        await message.reply('❌ An error occurred while executing the store command.');
      }
    }
    
    // Handle !claim command (admin only)
    if (commandName === 'claim') {
      try {
        // Check if user has admin permissions
        const adminRoleName = 'Lucid Admin';
        const member = message.member;
        const hasAdminRole = member.roles.cache.some(role => role.name === adminRoleName) || member.permissions.has('Administrator');

        if (!hasAdminRole) {
          return message.reply('❌ You do not have permission to use this command.');
        }

        // Create embed
        const embed = new EmbedBuilder()
          .setColor(0x6A0DAD) // Deep purple
          .setDescription('Please use the drop down category below and choose a kit that you want more information on.')
          .setTimestamp();
        
        // Check if welcome-image.png exists and add as thumbnail (top right)
        const welcomeImagePath = path.join(__dirname, '../../assets/welcome-image.png');
        let welcomeAttachment = null;
        
        if (fs.existsSync(welcomeImagePath)) {
          welcomeAttachment = new AttachmentBuilder(welcomeImagePath, { name: 'welcome-image.png' });
          embed.setThumbnail('attachment://welcome-image.png');
        }
        
        // Create dropdown menu with all kits
        const selectMenu = new StringSelectMenuBuilder()
          .setCustomId('kit_info_select')
          .setPlaceholder('Kit Info')
          .addOptions(
            {
              label: 'Comps',
              value: 'kit1',
              description: 'Kit 1 - Comps'
            },
            {
              label: 'FreeKit',
              value: 'kit2',
              description: 'Kit 2 - FreeKit'
            },
            {
              label: 'FreeKit2',
              value: 'kit3',
              description: 'Kit 3 - FreeKit2'
            },
            {
              label: 'Discord Booster Kit',
              value: 'kit4',
              description: 'Kit 4 - Discord Booster Kit'
            },
            {
              label: 'Soldier VIP',
              value: 'kit5',
              description: 'Kit 5 - Soldier VIP'
            },
            {
              label: 'Major VIP',
              value: 'kit6',
              description: 'Kit 6 - Major VIP'
            },
            {
              label: 'General VIP',
              value: 'kit7',
              description: 'Kit 7 - General VIP'
            },
            {
              label: 'Base Kit',
              value: 'kit8',
              description: 'Kit 8 - Base Kit'
            },
            {
              label: 'Big Base Kit',
              value: 'kit9',
              description: 'Kit 9 - Big Base Kit'
            },
            {
              label: 'Turret Kit',
              value: 'kit10',
              description: 'Kit 10 - Turret Kit'
            },
            {
              label: 'Raid Base',
              value: 'kit11',
              description: 'Kit 11 - Raid Base'
            }
          );
        
        const selectRow = new ActionRowBuilder()
          .addComponents(selectMenu);
        
        // Send message with embed and dropdown
        await message.channel.send({
          embeds: [embed],
          components: [selectRow],
          files: welcomeAttachment ? [welcomeAttachment] : []
        });
        
        // Delete the command message
        await message.delete().catch(() => {});
        
      } catch (error) {
        console.error('Error executing !claim command:', error);
        await message.reply('❌ An error occurred while executing the claim command.');
      }
    }
  }
};

