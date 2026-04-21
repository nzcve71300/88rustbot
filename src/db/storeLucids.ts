import type { Pool, PoolConnection } from "mysql2/promise";

type DbConn = Pick<Pool, "execute"> | Pick<PoolConnection, "execute">;

export async function getLucidsBalance(db: DbConn, discordId: string): Promise<number> {
  const [rows] = await db.execute(`SELECT lucids FROM store_user_balances WHERE discord_id = :discordId LIMIT 1`, {
    discordId,
  });
  const row = Array.isArray(rows) && rows.length > 0 ? (rows[0] as { lucids?: unknown }) : null;
  const lucids = row && typeof row.lucids === "string" ? Number.parseInt(row.lucids, 10) : Number(row?.lucids ?? 0);
  return Number.isFinite(lucids) ? Math.max(0, Math.floor(lucids)) : 0;
}

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

    const lucids = await getLucidsBalance(conn, discordId);

    await conn.commit();
    return lucids;
  } catch (err) {
    await conn.rollback().catch(() => {});
    throw err;
  } finally {
    conn.release();
  }
}

/**
 * Attempts to spend `amount` Lucids from the user.
 * - Atomic (transaction)
 * - Never allows negative balances
 * - If insufficient, does not change balance and returns ok:false
 */
export async function trySpendLucids(
  pool: Pool,
  discordId: string,
  amount: number
): Promise<{ ok: true; newBalance: number } | { ok: false; balance: number }> {
  const spend = Math.max(0, Math.floor(amount));
  if (spend <= 0) {
    const balance = await getLucidsBalance(pool, discordId);
    return { ok: true, newBalance: balance };
  }

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

    // Lock row for update and read current balance.
    const [rows] = await conn.execute(
      `SELECT lucids FROM store_user_balances WHERE discord_id = :discordId LIMIT 1 FOR UPDATE`,
      { discordId }
    );
    const row = Array.isArray(rows) && rows.length > 0 ? (rows[0] as { lucids?: unknown }) : null;
    const current =
      row && typeof row.lucids === "string" ? Number.parseInt(row.lucids, 10) : Number(row?.lucids ?? 0);
    const balance = Number.isFinite(current) ? Math.max(0, Math.floor(current)) : 0;

    if (balance < spend) {
      await conn.rollback().catch(() => {});
      return { ok: false, balance };
    }

    const newBalance = balance - spend;
    await conn.execute(
      `UPDATE store_user_balances SET lucids = :lucids WHERE discord_id = :discordId`,
      { discordId, lucids: newBalance }
    );

    await conn.commit();
    return { ok: true, newBalance };
  } catch (err) {
    await conn.rollback().catch(() => {});
    throw err;
  } finally {
    conn.release();
  }
}

