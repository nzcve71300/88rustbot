/**
 * Loads `.env` from the project root with `override: true` so file values win over
 * shell/system env (avoids 401 on VPS when DISCORD_TOKEN was exported empty/wrong).
 */
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: path.join(rootDir, ".env"), override: true });

/**
 * discord.js sends `Authorization: Bot <token>`. If `.env` includes a `Bot ` or `Bearer `
 * prefix (common bad paste), the API sees `Bot Bot …` and returns **401**.
 */
function normalizeDiscordTokenFromEnv(): void {
  const raw = process.env.DISCORD_TOKEN;
  if (raw === undefined || raw === "") return;
  let t = raw.trim();
  if (
    (t.startsWith('"') && t.endsWith('"')) ||
    (t.startsWith("'") && t.endsWith("'"))
  ) {
    t = t.slice(1, -1).trim();
  }
  if (t.toLowerCase().startsWith("bot ")) {
    t = t.slice(4).trim();
  }
  if (t.toLowerCase().startsWith("bearer ")) {
    t = t.slice(7).trim();
  }
  process.env.DISCORD_TOKEN = t;
}

normalizeDiscordTokenFromEnv();
