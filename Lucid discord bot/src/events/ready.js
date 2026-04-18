const { PermissionFlagsBits } = require('discord.js');

module.exports = {
  name: 'ready',
  once: true,
  async execute(client) {
    console.log(`✅ ${client.user.tag} is online!`);

    // Ensure bot is only in the correct guild
    const allowedGuildId = process.env.GUILD_ID;
    for (const [guildId, guild] of client.guilds.cache) {
      if (guildId !== allowedGuildId) {
        console.log(`Leaving unauthorized guild: ${guild.name} (${guildId})`);
        await guild.leave();
      }
    }

    // Create admin role if it doesn't exist
    const guild = client.guilds.cache.get(allowedGuildId);
    if (guild) {
      const adminRoleName = 'Lucid Admin';
      let adminRole = guild.roles.cache.find(role => role.name === adminRoleName);

      if (!adminRole) {
        try {
          adminRole = await guild.roles.create({
            name: adminRoleName,
            color: 0x6A0DAD, // Deep purple
            permissions: [PermissionFlagsBits.Administrator],
            mentionable: false,
            reason: 'Auto-created admin role for Lucid Bot',
          });
          console.log(`✅ Created admin role: ${adminRoleName}`);
        } catch (error) {
          console.error('Error creating admin role:', error);
        }
      }
    }
  },
};


