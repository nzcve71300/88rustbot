import type { Pool } from "mysql2/promise";

export async function ensureStoreUserRow(pool: Pool, discordId: string): Promise<void> {
  await pool.execute(
    `
      INSERT INTO store_user_balances (discord_id, lucids)
      VALUES (:discordId, 0)
      ON DUPLICATE KEY UPDATE discord_id = discord_id
    `,
    { discordId }
  );
}

/**
 * Updates a user's Lucids balance by delta (can be negative).
 * Never allows the stored balance to go below 0.
 * Returns the resulting balance.
 */
export async function updateLucidsByDelta(pool: Pool, discordId: string, delta: number): Promise<number> {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    await conn.execute(
      `
        INSERT INTO store_user_balances (discord_id, lucids)
        VALUES (:discordId, 0)
        ON DUPLICATE KEY UPDATE discord_id = discord_id
      `,
      { discordId }
    );

    await conn.execute(
      `
        UPDATE store_user_balances
        SET lucids = GREATEST(0, CAST(lucids AS SIGNED) + :delta)
        WHERE discord_id = :discordId
      `,
      { discordId, delta: Math.trunc(delta) }
    );

    const [rows] = await conn.execute(
      `SELECT lucids FROM store_user_balances WHERE discord_id = :discordId LIMIT 1`,
      { discordId }
    );
    const row = Array.isArray(rows) && rows.length > 0 ? (rows[0] as { lucids?: unknown }) : null;
    const lucids = row && typeof row.lucids === "string" ? Number.parseInt(row.lucids, 10) : Number(row?.lucids ?? 0);

    await conn.commit();
    return Number.isFinite(lucids) ? Math.max(0, Math.floor(lucids)) : 0;
  } catch (err) {
    await conn.rollback().catch(() => {});
    throw err;
  } finally {
    conn.release();
  }
}

