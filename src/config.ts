import "dotenv/config";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v?.trim()) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return v.trim();
}

export const config = {
  discordToken: requireEnv("DISCORD_TOKEN"),
  maria: {
    host: requireEnv("MARIA_HOST"),
    port: Number.parseInt(process.env.MARIA_PORT ?? "3306", 10),
    user: requireEnv("MARIA_USER"),
    password: process.env.MARIA_PASSWORD ?? "",
    database: requireEnv("MARIA_DATABASE"),
  },
  /** 32-byte key as 64 hex characters. */
  encryptionKeyHex: requireEnv("ENCRYPTION_KEY"),
};
