import type { Pool, RowDataPacket } from "mysql2/promise";

/** Discord user ids (strings) that have a link for this guild and are in a clan (member or owner). */
export async function listLinkedInClanUserIdsForGuild(pool: Pool, guildRowId: number): Promise<string[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT CAST(l.discord_user_id AS CHAR) AS uid
     FROM discord_links l
     WHERE l.guild_id = :gid
       AND (
         EXISTS (
           SELECT 1 FROM clan_members m
           INNER JOIN clans c ON c.id = m.clan_id
           WHERE c.guild_id = :gid AND CAST(m.discord_user_id AS CHAR) = CAST(l.discord_user_id AS CHAR)
         )
         OR EXISTS (
           SELECT 1 FROM clans c
           WHERE c.guild_id = :gid AND CAST(c.owner_discord_user_id AS CHAR) = CAST(l.discord_user_id AS CHAR)
         )
       )`,
    { gid: guildRowId }
  );
  return (rows as { uid: string }[]).map((r) => String(r.uid));
}
