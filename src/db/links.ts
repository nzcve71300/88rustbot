import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";

export type LinkRow = {
  discordUserId: string;
  ingameName: string;
};

/** True if this Discord user has linked an in-game name in any guild (for site-wide push eligibility). */
export async function hasDiscordLinkForUser(pool: Pool, discordUserId: string): Promise<boolean> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT 1 AS ok FROM discord_links WHERE discord_user_id = :uid LIMIT 1`,
    { uid: discordUserId }
  );
  return rows.length > 0;
}

/**
 * All Rust server row IDs in guilds where this user has a link. One `discord_links` row per guild applies to every
 * Rust server in that guild — there is no per-server link.
 */
export async function listRustServerIdsForDiscordUser(pool: Pool, discordUserId: string): Promise<number[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT DISTINCT rs.id AS id
     FROM rust_servers rs
     INNER JOIN discord_links l ON l.guild_id = rs.guild_id AND l.discord_user_id = :uid
     ORDER BY rs.id ASC`,
    { uid: discordUserId }
  );
  return rows.map((r) => Number((r as { id: number }).id));
}

export async function getLinkByDiscordUser(
  pool: Pool,
  guildRowId: number,
  discordUserId: string
): Promise<LinkRow | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT CAST(discord_user_id AS CHAR) AS discordUserId, ingame_name AS ingameName
     FROM discord_links WHERE guild_id = :gid AND discord_user_id = :uid LIMIT 1`,
    { gid: guildRowId, uid: discordUserId }
  );
  return (rows[0] as LinkRow | undefined) ?? null;
}

export async function insertLink(
  pool: Pool,
  guildRowId: number,
  discordUserId: string,
  ingameName: string
): Promise<void> {
  await pool.query<ResultSetHeader>(
    `INSERT INTO discord_links (guild_id, discord_user_id, ingame_name)
     VALUES (:gid, :uid, :name)`,
    { gid: guildRowId, uid: discordUserId, name: ingameName }
  );
}

/** Removes the Discord ↔ in-game link only. KD and other per-name data stay in the DB. */
export async function deleteLinkByDiscordUser(
  pool: Pool,
  guildRowId: number,
  discordUserId: string
): Promise<boolean> {
  const [res] = await pool.query<ResultSetHeader>(
    `DELETE FROM discord_links WHERE guild_id = :gid AND discord_user_id = :uid LIMIT 1`,
    { gid: guildRowId, uid: discordUserId }
  );
  return res.affectedRows > 0;
}

export async function getLinkByIngameName(
  pool: Pool,
  guildRowId: number,
  ingameName: string
): Promise<LinkRow | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT CAST(discord_user_id AS CHAR) AS discordUserId, ingame_name AS ingameName
     FROM discord_links WHERE guild_id = :gid AND ingame_name = :name LIMIT 1`,
    { gid: guildRowId, name: ingameName }
  );
  return (rows[0] as LinkRow | undefined) ?? null;
}

/** Case-insensitive match for Rust console names vs stored link. */
export async function getLinkByIngameNameCi(
  pool: Pool,
  guildRowId: number,
  ingameName: string
): Promise<LinkRow | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT CAST(discord_user_id AS CHAR) AS discordUserId, ingame_name AS ingameName
     FROM discord_links
     WHERE guild_id = :gid AND LOWER(TRIM(ingame_name)) = LOWER(TRIM(:name)) LIMIT 1`,
    { gid: guildRowId, name: ingameName }
  );
  return (rows[0] as LinkRow | undefined) ?? null;
}

/**
 * Exact CI match first, then if the console shows a **longer** name than the link (e.g. link `nzcve`,
 * console `nzcve7130`), match when only one row qualifies.
 */
export async function getLinkByIngameNameBestEffort(
  pool: Pool,
  guildRowId: number,
  consoleName: string
): Promise<LinkRow | null> {
  const trimmed = consoleName.replace(/\u200b/g, "").trim();
  if (!trimmed) return null;

  const exact = await getLinkByIngameNameCi(pool, guildRowId, trimmed);
  if (exact) return exact;

  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT CAST(discord_user_id AS CHAR) AS discordUserId, ingame_name AS ingameName
     FROM discord_links
     WHERE guild_id = :gid
       AND LOWER(TRIM(:name)) LIKE CONCAT(LOWER(TRIM(ingame_name)), '%')
       AND CHAR_LENGTH(TRIM(ingame_name)) >= 3`,
    { gid: guildRowId, name: trimmed }
  );
  const list = rows as LinkRow[];
  if (list.length === 1) return list[0];
  return null;
}

/** Every Discord user id with an `/link` row for this guild (internal `guilds.id`). */
export async function listLinkedDiscordUserIdsForGuild(pool: Pool, guildRowId: number): Promise<string[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT CAST(discord_user_id AS CHAR) AS discordUserId
     FROM discord_links
     WHERE guild_id = :gid
     ORDER BY discord_user_id ASC`,
    { gid: guildRowId }
  );
  return (rows as { discordUserId: string }[]).map((r) => String(r.discordUserId));
}

