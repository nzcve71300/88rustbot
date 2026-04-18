const { Client, GatewayIntentBits, Collection, PermissionFlagsBits } = require('discord.js');
const { config } = require('dotenv');
const fs = require('fs');
const path = require('path');
const { initializeDatabase } = require('./db');

config();

// Prevent running multiple bot instances (avoids duplicate messages/panels).
const lockPath = path.join(__dirname, '..', '.lucid-bot.lock');
let lockFd = null;
function acquireLockOrExit() {
  try {
    lockFd = fs.openSync(lockPath, 'wx');
    fs.writeFileSync(lockFd, String(process.pid));
  } catch (e) {
    console.error('❌ [LUCID] Another Lucid bot instance is already running. Exiting to prevent duplicate messages.');
    process.exit(1);
  }
}
function releaseLock() {
  try {
    if (lockFd != null) fs.closeSync(lockFd);
  } catch {
    // ignore
  }
  lockFd = null;
  try {
    if (fs.existsSync(lockPath)) fs.unlinkSync(lockPath);
  } catch {
    // ignore
  }
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
});

// Load commands
client.commands = new Collection();
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

for (const file of commandFiles) {
  const command = require(path.join(commandsPath, file));
  client.commands.set(command.data.name, command);
}

// Load event handlers
const eventsPath = path.join(__dirname, 'events');
const eventFiles = fs.readdirSync(eventsPath).filter(file => file.endsWith('.js'));

for (const file of eventFiles) {
  const event = require(path.join(eventsPath, file));
  if (event.once) {
    client.once(event.name, (...args) => event.execute(...args));
  } else {
    client.on(event.name, (...args) => event.execute(...args));
  }
}

// Guild restriction check
client.on('guildCreate', async (guild) => {
  if (guild.id !== process.env.GUILD_ID) {
    console.log(`Bot joined unauthorized guild: ${guild.name} (${guild.id}). Leaving...`);
    await guild.leave();
  }
});

// Initialize database and start bot
async function startBot() {
  try {
    acquireLockOrExit();
    console.log('[LUCID] Initializing database...');
    await initializeDatabase();
    console.log('[LUCID] Database initialized, logging in...');
    await client.login(process.env.BOT_TOKEN);
    console.log('[LUCID] Bot login successful!');
  } catch (error) {
    console.error('❌ [LUCID] Failed to start bot:', error);
    console.error('❌ [LUCID] Error stack:', error.stack);
    releaseLock();
    process.exit(1);
  }
}

// Handle unhandled promise rejections
process.on('unhandledRejection', (error) => {
  console.error('❌ [LUCID] Unhandled promise rejection:', error);
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('❌ [LUCID] Uncaught exception:', error);
  releaseLock();
  process.exit(1);
});

process.on('SIGINT', () => {
  releaseLock();
  process.exit(0);
});
process.on('SIGTERM', () => {
  releaseLock();
  process.exit(0);
});

startBot();

