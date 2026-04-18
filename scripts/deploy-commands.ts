/**
 * Deploys slash commands globally (all guilds the bot is in).
 * Only needs DISCORD_TOKEN in .env — not MariaDB or ENCRYPTION_KEY.
 *
 * Usage: npm run deploy-commands
 */
import "../src/loadEnv.js";
import { REST, Routes } from "discord.js";
import { slashCommands } from "../src/commands/registry.js";

/** Value from env var DISCORD_TOKEN (see .env). */
const rawDiscordToken = process.env.DISCORD_TOKEN?.trim();
if (!rawDiscordToken) {
  console.error("Set DISCORD_TOKEN in your .env file.");
  process.exit(1);
}
const discordToken: string = rawDiscordToken;

async function main() {
  const rest = new REST({ version: "10" }).setToken(discordToken);
  const app = (await rest.get(Routes.currentApplication())) as { id: string };
  const body = slashCommands.map((cmd) => cmd.data.toJSON());

  await rest.put(Routes.applicationCommands(app.id), { body });

  console.log(`Deployed ${body.length} global command(s) for application ${app.id}.`);
  console.log("Global commands can take up to an hour to propagate; re-invite the bot if needed.");
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
