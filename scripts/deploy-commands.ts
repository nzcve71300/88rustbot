/**
 * Deploys slash commands globally (all guilds the bot is in).
 * Only needs DISCORD_TOKEN in .env — not MariaDB or ENCRYPTION_KEY.
 *
 * Usage: npm run deploy-commands
 */
import "dotenv/config";
import { REST, Routes } from "discord.js";
import { slashCommands } from "../src/commands/registry.js";

const token = process.env.DISCORD_TOKEN?.trim();
if (!token) {
  console.error("Set DISCORD_TOKEN in your .env file.");
  process.exit(1);
}

async function main() {
  const rest = new REST({ version: "10" }).setToken(token);
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
