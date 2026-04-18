/**
 * Quick check: does Discord accept this bot token? Does not print the token.
 * Usage: npm run verify-discord-token
 */
import "../src/loadEnv.js";

const t = process.env.DISCORD_TOKEN?.trim();
if (!t) {
  console.error("DISCORD_TOKEN is missing or empty after loading .env");
  process.exit(1);
}

console.log("Token length:", t.length);
console.log("Starts with 'Bot ' (bad for .env):", t.toLowerCase().startsWith("bot "));

const res = await fetch("https://discord.com/api/v10/users/@me", {
  headers: { Authorization: `Bot ${t}` },
});
console.log("GET https://discord.com/api/v10/users/@me → HTTP", res.status);
if (res.status === 200) {
  const j = (await res.json()) as { username?: string; id?: string };
  console.log("OK — bot user:", j.username ?? "?", "id:", j.id ?? "?");
} else {
  const err = await res.text();
  console.error("Discord rejected the token. Body (truncated):", err.slice(0, 200));
  process.exit(1);
}
