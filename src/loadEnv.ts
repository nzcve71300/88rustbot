/**
 * Loads `.env` from the project root with `override: true` so file values win over
 * shell/system env (avoids 401 on VPS when DISCORD_TOKEN was exported empty/wrong).
 */
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: path.join(rootDir, ".env"), override: true });
