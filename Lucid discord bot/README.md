# Lucid Discord Bot

A premium Discord bot with a beautiful ticket system featuring a purple and cyan theme.

## Features

- **Ticket System**: Create and manage support tickets with categories
- **Beautiful UI**: Purple and cyan theme with elegant embeds
- **Admin Controls**: Role-based permissions for ticket management
- **Auto Categories**: Automatically creates ticket categories
- **Secure**: Single guild restriction for security
- **Database Integration**: Uses same database as Zentro bot for ticket storage
- **PM2 Support**: Production-ready process management

## Setup

1. Install dependencies:
```bash
npm install
```

2. Create a `.env` file (use the same database credentials as Zentro bot):
```
BOT_TOKEN=MTQzNDkwNjI2NjkyMDI4ODMxOQ.GmbW0K.QDDZ7ts82-MyU99aCjxBICbOyr6dRfBSWzkDhg
CLIENT_ID=1434906266920288319
GUILD_ID=1420851415458386054

# Database (same as Zentro bot)
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=your_password
DB_NAME=zentro_bot
DB_PORT=3306
```

3. Deploy commands:
```bash
npm run deploy-commands
```

4. Start with PM2:
```bash
pm2 start ecosystem.config.js
```

Or start normally:
```bash
npm start
```

## PM2 Commands

```bash
# Start bot
pm2 start ecosystem.config.js

# Stop bot
pm2 stop lucid-discord-bot

# Restart bot
pm2 restart lucid-discord-bot

# View logs
pm2 logs lucid-discord-bot

# View status
pm2 status
```

## Commands

- `/ticket-system` - Set up the ticket system panel
- `/ticket-close` - Close the current ticket (admin only)

## Ticket System

The bot creates three ticket categories:
- Rust Help
- Discord Help
- Purchases Help

Each ticket includes:
- User information
- Claim/Close buttons
- Automatic channel management
- Status indicators (🟢 open, 🏁 closed)
- Database persistence

## Database Tables

The bot creates two tables in the shared database:
- `lucid_tickets` - Stores all ticket information
- `lucid_ticket_config` - Stores ticket system configuration per guild
