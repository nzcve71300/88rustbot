const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

// Color definitions with hex codes
const EMBED_COLORS = {
  'green': 0x00FF00,
  'red': 0xFF0000,
  'deep-purple': 0x6A0DAD,
  'light-purple': 0x9370DB,
  'cyan': 0x00CED1,
  'blue': 0x0000FF,
  'light-blue': 0x87CEEB,
  'orange': 0xFF8C00,
  'yellow': 0xFFD700,
  'pink': 0xFF69B4,
  'gold': 0xFFD700,
  'teal': 0x008080,
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName('embed')
    .setDescription('Create a custom embed message (Admin only)')
    .addStringOption(option =>
      option
        .setName('color')
        .setDescription('Choose a color for the embed')
        .setRequired(true)
        .setAutocomplete(true)
    )
    .addStringOption(option =>
      option
        .setName('heading')
        .setDescription('The heading/title for the embed')
        .setRequired(true)
        .setMaxLength(256)
    )
    .addStringOption(option =>
      option
        .setName('message')
        .setDescription('The message content for the embed')
        .setRequired(true)
        .setMaxLength(4000)
    ),

  async autocomplete(interaction) {
    const focusedValue = interaction.options.getFocused().toLowerCase();
    
    // Filter colors based on what user is typing
    const colorChoices = Object.keys(EMBED_COLORS)
      .filter(color => color.includes(focusedValue) || focusedValue === '')
      .map(color => ({
        name: color.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' '),
        value: color
      }))
      .slice(0, 25); // Discord limit

    await interaction.respond(colorChoices);
  },

  async execute(interaction) {
    // Check if user has admin permissions
    const adminRoleName = 'Lucid Admin';
    const member = interaction.member;
    const hasAdminRole = member.roles.cache.some(role => role.name === adminRoleName) || member.permissions.has('Administrator');

    if (!hasAdminRole) {
      return interaction.reply({
        content: '❌ You do not have permission to use this command. Only admins can create embeds.',
        ephemeral: true,
      });
    }

    const colorOption = interaction.options.getString('color');
    const heading = interaction.options.getString('heading');
    const message = interaction.options.getString('message');

    // Validate color
    if (!EMBED_COLORS[colorOption]) {
      return interaction.reply({
        content: `❌ Invalid color selected. Please choose from the available colors.`,
        ephemeral: true,
      });
    }

    const embedColor = EMBED_COLORS[colorOption];

    // Create a beautiful embed with amazing design
    const embed = new EmbedBuilder()
      .setColor(embedColor)
      .setTitle(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`)
      .setDescription(`\n\`\`\`\n**${heading.toUpperCase()}**\n\`\`\`\n\n${message}\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`)
      .setFooter({ 
        text: '✨ Lucid Clans • Custom Embed',
        iconURL: 'https://i.ibb.co/dKVrgmj/supply-drop.png'
      })
      .setTimestamp();

    // Send the embed
    await interaction.reply({
      embeds: [embed],
      ephemeral: false, // Make it public
    });
  },
};

