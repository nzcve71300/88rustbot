const { InteractionType, EmbedBuilder, AttachmentBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');

function isUnknownInteractionError(err) {
  const code = err && typeof err === 'object' && 'code' in err ? err.code : null;
  return code === 10062 || code === '10062';
}

module.exports = {
  name: 'interactionCreate',
  async execute(interaction) {
    // Handle autocomplete interactions
    if (interaction.type === InteractionType.ApplicationCommandAutocomplete) {
      const command = interaction.client.commands.get(interaction.commandName);

      if (!command) {
        console.error(`No command matching ${interaction.commandName} was found.`);
        return;
      }

      try {
        if (command.autocomplete) {
          await command.autocomplete(interaction);
        }
      } catch (error) {
        console.error(`Error handling autocomplete for ${interaction.commandName}:`, error);
      }
      return;
    }

    if (interaction.type === InteractionType.ApplicationCommand) {
      const command = interaction.client.commands.get(interaction.commandName);

      if (!command) {
        console.error(`No command matching ${interaction.commandName} was found.`);
        return;
      }

      try {
        await command.execute(interaction);
      } catch (error) {
        console.error(`Error executing ${interaction.commandName}:`, error);
        const errorMessage = { content: 'There was an error while executing this command!', ephemeral: true };
        try {
          if (interaction.replied || interaction.deferred) {
            await interaction.followUp(errorMessage).catch(() => {});
          } else {
            await interaction.reply(errorMessage).catch(() => {});
          }
        } catch (replyErr) {
          if (!isUnknownInteractionError(replyErr)) {
            console.error('Error sending command error response:', replyErr);
          }
        }
      }
    } else if (interaction.isButton()) {
      // Handle button interactions
      if (interaction.customId === 'store_buy_button') {
        try {
          // Send private message with store link
          await interaction.reply({
            content: 'https://lucidrce.online',
            ephemeral: true // Private message
          });
        } catch (error) {
          console.error('Error handling store button:', error);
          await interaction.reply({
            content: 'There was an error. Please try again.',
            ephemeral: true
          }).catch(() => {});
        }
        return;
      }
      
      if (interaction.customId.startsWith('ticket_')) {
        try {
          const ticketHandler = require('../handlers/ticketHandler');
          await ticketHandler.handleButton(interaction);
        } catch (error) {
          console.error('Error handling button interaction:', error);
          const errorMessage = { 
            content: 'There was an error processing your request. Please try again.', 
            ephemeral: true 
          };
          if (interaction.replied || interaction.deferred) {
            await interaction.followUp(errorMessage).catch(() => {});
          } else {
            await interaction.reply(errorMessage).catch(() => {});
          }
        }
      }
      if (interaction.customId.startsWith('ss:')) {
        try {
          const serverSettingsHandler = require('../handlers/serverSettingsHandler');
          await serverSettingsHandler.handleButton(interaction);
        } catch (error) {
          console.error('Error handling server settings button:', error);
          await interaction.reply({ content: 'There was an error. Please try again.', ephemeral: true }).catch(() => {});
        }
        return;
      }
    } else if (interaction.isStringSelectMenu()) {
      // Handle dropdown menu selections
      if (interaction.customId === 'ticket_category_select') {
        try {
          const ticketHandler = require('../handlers/ticketHandler');
          await ticketHandler.handleTicketCategorySelect(interaction);
        } catch (error) {
          console.error('Error handling ticket category selection:', error);
          await interaction.reply({
            content: 'There was an error opening the ticket form. Please try again.',
            ephemeral: true,
          }).catch(() => {});
        }
        return;
      }
      if (interaction.customId === 'ss:send') {
        try {
          const serverSettingsHandler = require('../handlers/serverSettingsHandler');
          await serverSettingsHandler.handleChannelSelect(interaction);
        } catch (error) {
          console.error('Error handling server settings channel select:', error);
          await interaction.reply({ content: 'There was an error. Please try again.', ephemeral: true }).catch(() => {});
        }
        return;
      }
      if (interaction.customId === 'kit_info_select') {
        try {
          await interaction.deferReply({ ephemeral: true });
          
          const kitData = {
            kit1: {
              name: 'Comps',
              image: 'COMPS.png',
              timer: 'We will release the timer soon',
              emote: 'I need High Quality Metal'
            },
            kit2: {
              name: 'FreeKit',
              image: 'Freekit.png',
              timer: 'will release soon',
              emote: 'i need wood'
            },
            kit3: {
              name: 'FreeKit2',
              image: 'Freekit2.png',
              timer: 'will release soon',
              emote: 'I need water'
            },
            kit4: {
              name: 'discord booster kit',
              image: 'Discord_booster_kit.png',
              timer: 'will be released soon',
              emote: 'I need Scrap'
            },
            kit5: {
              name: 'Soldier VIP',
              image: 'Soldier_VIP.png',
              timer: 'will be released soon',
              emote: 'i need low Grade fuel'
            },
            kit6: {
              name: 'Major VIP',
              image: 'Major_VIP.png',
              timer: 'will be released soon',
              emote: 'I need food'
            },
            kit7: {
              name: 'General VIP',
              image: 'General_VIP.png',
              timer: 'will release soon',
              emote: 'I have hatched'
            },
            kit8: {
              name: 'Base kit',
              image: 'Base_kit.png',
              timer: 'will release soon',
              emote: 'i have high quality metal'
            },
            kit9: {
              name: 'Big Base kit',
              image: 'Big_Base_Kit.png',
              timer: 'will release soon',
              emote: 'i have scrap'
            },
            kit10: {
              name: 'Turret kit',
              image: 'Turret_kit.png',
              timer: 'will release soon',
              emote: 'i have low Grade Fuel'
            },
            kit11: {
              name: 'Raid base',
              image: 'Raid_base.png',
              timer: 'will release soon',
              emote: 'i have food'
            }
          };
          
          const selectedKit = kitData[interaction.values[0]];
          
          if (!selectedKit) {
            return interaction.editReply({
              content: '❌ Kit not found. Please try again.',
            });
          }
          
          // Create embed for kit details
          const kitEmbed = new EmbedBuilder()
            .setColor(0x6A0DAD) // Deep purple
            .setTitle(`**${selectedKit.name}**`)
            .addFields(
              {
                name: '⏰ **Timer**',
                value: selectedKit.timer,
                inline: false
              },
              {
                name: '🎭 **Emote to Claim**',
                value: selectedKit.emote,
                inline: false
              }
            )
            .setTimestamp()
            .setFooter({ text: 'Lucid Clans - Kit Information' });
          
          // Check if kit image exists
          const imagePath = path.join(__dirname, '../../assets', selectedKit.image);
          const files = [];
          
          if (fs.existsSync(imagePath)) {
            try {
              const attachment = new AttachmentBuilder(imagePath, { name: selectedKit.image });
              kitEmbed.setImage(`attachment://${selectedKit.image}`);
              files.push(attachment);
            } catch (imageError) {
              console.error(`[KIT INFO] Error creating image attachment for ${selectedKit.image}:`, imageError);
            }
          } else {
            console.warn(`[KIT INFO] Image not found at ${imagePath}`);
          }
          
          await interaction.editReply({
            embeds: [kitEmbed],
            files: files.length > 0 ? files : undefined
          });
          
        } catch (error) {
          console.error('Error handling kit info selection:', error);
          const errorMessage = { 
            content: 'There was an error displaying kit information. Please try again.', 
            ephemeral: true 
          };
          if (interaction.replied || interaction.deferred) {
            await interaction.editReply(errorMessage).catch(() => {});
          } else {
            await interaction.reply(errorMessage).catch(() => {});
          }
        }
      }
    } else if (interaction.isModalSubmit()) {
      // Handle modal submissions
      if (interaction.customId.startsWith('ticket_modal_')) {
        try {
          const ticketHandler = require('../handlers/ticketHandler');
          await ticketHandler.handleModal(interaction);
        } catch (error) {
          console.error('Error handling modal submission:', error);
          const errorMessage = { 
            content: 'There was an error processing your ticket. Please try again or contact an admin.', 
            ephemeral: true 
          };
          if (interaction.replied || interaction.deferred) {
            await interaction.followUp(errorMessage).catch(() => {});
          } else {
            await interaction.reply(errorMessage).catch(() => {});
          }
        }
      }
      if (interaction.customId.startsWith('ssmodal:')) {
        try {
          const serverSettingsHandler = require('../handlers/serverSettingsHandler');
          await serverSettingsHandler.handleModal(interaction);
        } catch (error) {
          console.error('Error handling server settings modal:', error);
          await interaction.reply({ content: 'There was an error. Please try again.', ephemeral: true }).catch(() => {});
        }
        return;
      }
    }
  },
};

