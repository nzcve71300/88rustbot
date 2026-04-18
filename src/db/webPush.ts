import type { Pool } from "mysql2/promise";

export type WebPushRow = {
  endpoint: string;
  p256dh: string;
  auth: string;
  discordUserId: string;
};

export async function upsertWebPushSubscription(
  pool: Pool,
  discordUserId: string,
  sub: { endpoint: string; keys: { p256dh: string; auth: string } }
): Promise<void> {
  await pool.query(
    `INSERT INTO web_push_subscriptions (discord_user_id, endpoint, p256dh, auth, updated_at)
     VALUES (:uid, :endpoint, :p256dh, :auth, CURRENT_TIMESTAMP)
     ON DUPLICATE KEY UPDATE
       discord_user_id = VALUES(discord_user_id),
       p256dh = VALUES(p256dh),
       auth = VALUES(auth),
       updated_at = CURRENT_TIMESTAMP`,
    {
      uid: discordUserId,
      endpoint: sub.endpoint,
      p256dh: sub.keys.p256dh,
      auth: sub.keys.auth,
    }
  );
}

export async function deleteWebPushSubscription(pool: Pool, discordUserId: string, endpoint: string): Promise<void> {
  await pool.query(
    `DELETE FROM web_push_subscriptions WHERE discord_user_id = :uid AND endpoint = :endpoint LIMIT 10`,
    { uid: discordUserId, endpoint }
  );
}

/**
 * Push recipients for this guild + Rust server: must be linked in the guild, and either
 * have no per-server scope rows (notify for all Rust servers in linked guilds) or include this `rustServerId` in scope.
 */
export async function listWebPushSubscriptionsForGuildAndServer(
  pool: Pool,
  guildRowId: number,
  rustServerId: number
): Promise<WebPushRow[]> {
  const [rows] = await pool.query(
    `SELECT DISTINCT s.endpoint AS endpoint, s.p256dh AS p256dh, s.auth AS auth,
            CAST(s.discord_user_id AS CHAR) AS discordUserId
     FROM web_push_subscriptions s
     INNER JOIN discord_links l
       ON l.guild_id = :gid AND l.discord_user_id = s.discord_user_id
     WHERE (
       NOT EXISTS (SELECT 1 FROM web_push_server_scope sc WHERE sc.discord_user_id = s.discord_user_id)
       OR EXISTS (
         SELECT 1 FROM web_push_server_scope sc
         WHERE sc.discord_user_id = s.discord_user_id AND sc.rust_server_id = :sid
       )
     )`,
    { gid: guildRowId, sid: rustServerId }
  );
  return (rows as WebPushRow[]).map((r) => ({
    endpoint: String(r.endpoint),
    p256dh: String(r.p256dh),
    auth: String(r.auth),
    discordUserId: String(r.discordUserId),
  }));
}

/**
 * Push endpoints for one Discord user on this guild + Rust server (same scope rules as
 * {@link listWebPushSubscriptionsForGuildAndServer}).
 */
export async function listWebPushSubscriptionsForDiscordUserGuildServer(
  pool: Pool,
  guildRowId: number,
  rustServerId: number,
  discordUserId: string
): Promise<WebPushRow[]> {
  const [rows] = await pool.query(
    `SELECT DISTINCT s.endpoint AS endpoint, s.p256dh AS p256dh, s.auth AS auth,
            CAST(s.discord_user_id AS CHAR) AS discordUserId
     FROM web_push_subscriptions s
     INNER JOIN discord_links l
       ON l.guild_id = :gid AND l.discord_user_id = s.discord_user_id
     WHERE CAST(s.discord_user_id AS CHAR) = :uid
     AND (
       NOT EXISTS (SELECT 1 FROM web_push_server_scope sc WHERE sc.discord_user_id = s.discord_user_id)
       OR EXISTS (
         SELECT 1 FROM web_push_server_scope sc
         WHERE sc.discord_user_id = s.discord_user_id AND sc.rust_server_id = :sid
       )
     )`,
    { gid: guildRowId, sid: rustServerId, uid: String(discordUserId) }
  );
  return (rows as WebPushRow[]).map((r) => ({
    endpoint: String(r.endpoint),
    p256dh: String(r.p256dh),
    auth: String(r.auth),
    discordUserId: String(r.discordUserId),
  }));
}

export async function getWebPushServerScopeForUser(
  pool: Pool,
  discordUserId: string
): Promise<{ restrictToServers: boolean; rustServerIds: number[] }> {
  const [rows] = await pool.query(
    `SELECT rust_server_id FROM web_push_server_scope WHERE discord_user_id = :uid ORDER BY rust_server_id ASC`,
    { uid: discordUserId }
  );
  const rustServerIds = (rows as { rust_server_id: number }[]).map((r) => Number(r.rust_server_id));
  return { restrictToServers: rustServerIds.length > 0, rustServerIds };
}

export async function replaceWebPushServerScopeForUser(
  pool: Pool,
  discordUserId: string,
  rustServerIds: number[]
): Promise<void> {
  const unique = [...new Set(rustServerIds.filter((n) => Number.isFinite(n) && n > 0))];
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query(`DELETE FROM web_push_server_scope WHERE discord_user_id = :uid`, { uid: discordUserId });
    for (const sid of unique) {
      await conn.query(
        `INSERT INTO web_push_server_scope (discord_user_id, rust_server_id) VALUES (:uid, :sid)`,
        { uid: discordUserId, sid }
      );
    }
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}
