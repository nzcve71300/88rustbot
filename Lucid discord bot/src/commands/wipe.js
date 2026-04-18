const { SlashCommandBuilder, EmbedBuilder, AttachmentBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('wipe')
    .setDescription('Send a wipe announcement embed (Admin only)')
    .addStringOption(option =>
      option
        .setName('option')
        .setDescription('Choose wipe status')
        .setRequired(true)
        .addChoices(
          { name: 'Wiped', value: 'wiped' },
          { name: 'Wipes Soon', value: 'wipes_soon' }
        )
    ),

  async execute(interaction) {
    // Check if user has admin permissions
    const adminRoleName = 'Lucid Admin';
    const member = interaction.member;
    const hasAdminRole = member.roles.cache.some(role => role.name === adminRoleName) || member.permissions.has('Administrator');

    if (!hasAdminRole) {
      return interaction.reply({
        content: '❌ You do not have permission to use this command. Only admins can send wipe announcements.',
        ephemeral: true,
      });
    }

    const option = interaction.options.getString('option');

    let embed;
    let imagePath;
    let imageName;

    if (option === 'wiped') {
      // Wiped embed
      embed = new EmbedBuilder()
        .setColor(0x00FF00) // Green
        .setTitle('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
        .setDescription(
          `\n\`\`\`\nLUCID CLANS IS LIVE ✅\n\`\`\`\n\n` +
          `Find us in-game: \`\`\`LUCID CLANS | EU | 6X\`\`\`\n\n` +
          `Wipes Every Friday at \`\`\`8PM (GMT)\`\`\`\n\n` +
          `Fresh start, fast progress, and constant PvP.\n` +
          `Get in early, secure your spot, and be ready for heavy events and serious competition.\n\n` +
          `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`
        )
        .setFooter({ 
          text: '✨ Lucid Clans • Server is Live!',
          iconURL: 'https://i.ibb.co/dKVrgmj/supply-drop.png'
        })
        .setTimestamp();

      imagePath = path.join(__dirname, '../../assets/wiped_image.png');
      imageName = 'wiped_image.png';
    } else if (option === 'wipes_soon') {
      // Wipes Soon embed
      embed = new EmbedBuilder()
        .setColor(0x6A0DAD) // Deep Purple
        .setTitle('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
        .setDescription(
          `\n\`\`\`\nWIPE INCOMING\n\`\`\`\n\n` +
          `Every Friday @ 8pm (GMT)\n\n` +
          `A fresh start is coming with brand-new features you won't find anywhere else.\n` +
          `Custom-generated maps, high-intensity events, and constant action from the moment wipe hits.\n\n` +
          `\`\`\`\nWipe Schedule\n\`\`\`\n` +
          `Every Friday @ 8pm (GMT)\n\n` +
          `Get your team locked in.\n\n` +
          `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`
        )
        .setFooter({ 
          text: '✨ Lucid Clans • Wipe Coming Soon!',
          iconURL: 'https://i.ibb.co/dKVrgmj/supply-drop.png'
        })
        .setTimestamp();

      imagePath = path.join(__dirname, '../../assets/wipesSoon_image.png');
      imageName = 'wipesSoon_image.png';
    }

    // Check if image exists and attach it
    let attachment = null;
    if (fs.existsSync(imagePath)) {
      attachment = new AttachmentBuilder(imagePath, { name: imageName });
      embed.setImage(`attachment://${imageName}`);
    } else {
      console.warn(`[WIPE] Image not found at: ${imagePath}`);
    }

    // Send the embed
    await interaction.reply({
      embeds: [embed],
      files: attachment ? [attachment] : [],
      ephemeral: false, // Make it public
    });
  },
};

