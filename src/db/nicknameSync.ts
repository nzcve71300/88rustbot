import type { Pool, RowDataPacket, ResultSetHeader } from "mysql2/promise";

export async function isNicknameSyncOptedIn(pool: Pool, guildRowId: number, discordUserId: string): Promise<boolean> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT 1 AS ok FROM nickname_sync_opt_in WHERE guild_id = :gid AND discord_user_id = :uid LIMIT 1`,
    { gid: guildRowId, uid: String(discordUserId) }
  );
  return rows.length > 0;
}

export async function optInNicknameSync(pool: Pool, guildRowId: number, discordUserId: string): Promise<void> {
  await pool.query<ResultSetHeader>(
    `INSERT IGNORE INTO nickname_sync_opt_in (guild_id, discord_user_id) VALUES (:gid, :uid)`,
    { gid: guildRowId, uid: String(discordUserId) }
  );
}

