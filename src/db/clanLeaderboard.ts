import type { Pool, RowDataPacket } from "mysql2/promise";

export type ClanLeaderboardRow = {
  clanId: number;
  clanName: string;
  clanTag: string | null;
  memberCount: number;
  kills: number;
  deaths: number;
};

/**
 * Top clans on a Rust server by aggregated linked-member kills/deaths from `rust_player_kd`.
 * Scoped to guild + server only.
 */
export async function getTopClansForServerLeaderboard(
  pool: Pool,
  guildRowId: number,
  rustServerId: number,
  limit: number
): Promise<ClanLeaderboardRow[]> {
  const lim = Math.max(1, Math.min(50, Math.floor(limit)));
  const [rows] = await pool.query<RowDataPacket[]>(
    `
    SELECT
      c.id AS clanId,
      c.name AS clanName,
      c.tag AS clanTag,
      COUNT(DISTINCT cm.discord_user_id) AS memberCount,
      COALESCE(SUM(k.kills), 0) AS kills,
      COALESCE(SUM(k.deaths), 0) AS deaths
    FROM clans c
    INNER JOIN clan_members cm ON cm.clan_id = c.id
    LEFT JOIN discord_links l
      ON l.guild_id = c.guild_id
     AND CAST(l.discord_user_id AS CHAR) = CAST(cm.discord_user_id AS CHAR)
    LEFT JOIN rust_player_kd k
      ON k.guild_id = c.guild_id
     AND k.rust_server_id = :sid
     AND LOWER(TRIM(k.ingame_name)) = LOWER(TRIM(l.ingame_name))
    WHERE c.guild_id = :gid
    GROUP BY c.id, c.name, c.tag
    HAVING kills > 0 OR deaths > 0
    ORDER BY kills DESC, deaths ASC, c.name ASC
    LIMIT ${lim}
    `,
    { gid: guildRowId, sid: rustServerId }
  );

  return rows.map((r) => ({
    clanId: Number((r as { clanId: unknown }).clanId),
    clanName: String((r as { clanName: unknown }).clanName ?? ""),
    clanTag: (r as { clanTag: unknown }).clanTag != null ? String((r as { clanTag: unknown }).clanTag) : null,
    memberCount: Number((r as { memberCount: unknown }).memberCount ?? 0),
    kills: Number((r as { kills: unknown }).kills ?? 0),
    deaths: Number((r as { deaths: unknown }).deaths ?? 0),
  }));
}
