const { SlashCommandBuilder, EmbedBuilder, AttachmentBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('bounty')
    .setDescription('Create a bounty announcement (Admin only)')
    .addStringOption(option =>
      option
        .setName('target')
        .setDescription('Name of the team/clan to put a bounty on')
        .setRequired(true)
        .setMaxLength(100)
    )
    .addStringOption(option =>
      option
        .setName('grid')
        .setDescription('Grid location on the map')
        .setRequired(true)
        .setMaxLength(50)
    )
    .addStringOption(option =>
      option
        .setName('prize')
        .setDescription('Prize for raiding or defending the bounty')
        .setRequired(true)
        .setMaxLength(500)
    )
    .addStringOption(option =>
      option
        .setName('rules')
        .setDescription('Rules for the bounty')
        .setRequired(true)
        .setMaxLength(2000)
    ),

  async execute(interaction) {
    // Defer reply immediately to prevent timeout
    await interaction.deferReply({ ephemeral: false });

    // Check if user has admin permissions
    const adminRoleName = 'Lucid Admin';
    const member = interaction.member;
    const hasAdminRole = member.roles.cache.some(role => role.name === adminRoleName) || member.permissions.has('Administrator');

    if (!hasAdminRole) {
      return interaction.editReply({
        content: '❌ You do not have permission to use this command. Only admins can create bounties.',
      });
    }

    const target = interaction.options.getString('target');
    const grid = interaction.options.getString('grid');
    const prize = interaction.options.getString('prize');
    const rules = interaction.options.getString('rules');

    // Create the bounty embed with beautiful formatting
    const embed = new EmbedBuilder()
      .setColor(0x6A0DAD) // Deep Purple
      .setTitle('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
      .setDescription(
        `\n\`\`\`\nLUCID CLANS BOUNTIES\n\`\`\`\n\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
        `\`\`\`\nTARGET\n\`\`\`\n` +
        `${target}\n\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
        `\`\`\`\nGRID\n\`\`\`\n` +
        `${grid}\n\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
        `\`\`\`\nPRIZE\n\`\`\`\n` +
        `${prize}\n\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
        `\`\`\`\nRULES\n\`\`\`\n` +
        `${rules}\n\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`
      )
      .setFooter({ 
        text: '✨ Lucid Clans • Bounty System',
        iconURL: 'https://i.ibb.co/dKVrgmj/supply-drop.png'
      })
      .setTimestamp();

    // Check if image exists and attach it
    const imagePath = path.join(__dirname, '../../assets/bounty_image.png');
    let attachment = null;
    
    if (fs.existsSync(imagePath)) {
      attachment = new AttachmentBuilder(imagePath, { name: 'bounty_image.png' });
      embed.setImage(`attachment://bounty_image.png`);
    } else {
      console.warn(`[BOUNTY] Image not found at: ${imagePath}`);
    }

    // Edit the deferred reply with the embed
    await interaction.editReply({
      embeds: [embed],
      files: attachment ? [attachment] : [],
    });
  },
};

