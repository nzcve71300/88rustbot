import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";

export async function getOrCreateGuildRow(pool: Pool, discordGuildId: string): Promise<number> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT id FROM guilds WHERE discord_guild_id = :gid LIMIT 1",
    { gid: discordGuildId }
  );
  const existing = rows[0] as { id: number } | undefined;
  if (existing) return existing.id;

  const [res] = await pool.query<ResultSetHeader>(
    "INSERT INTO guilds (discord_guild_id) VALUES (:gid)",
    { gid: discordGuildId }
  );
  return Number(res.insertId);
}

export async function getDiscordGuildIdByRowId(pool: Pool, guildRowId: number): Promise<string | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT CAST(discord_guild_id AS CHAR) AS discordGuildId FROM guilds WHERE id = :id LIMIT 1",
    { id: guildRowId }
  );
  const r = rows[0] as { discordGuildId: string } | undefined;
  return r?.discordGuildId ? String(r.discordGuildId) : null;
}
