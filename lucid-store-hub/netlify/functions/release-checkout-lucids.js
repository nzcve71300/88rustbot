const mysql = require("mysql2/promise");
const {
  mysqlConnectionOptions,
  databaseConfigErrorResponse,
} = require("./_enqueueStoreFulfillment");

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
      body: "",
    };
  }

  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({ ok: false, error: "Method Not Allowed" }),
    };
  }

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return { statusCode: 400, headers: corsJson(), body: JSON.stringify({ ok: false, error: "Invalid JSON" }) };
  }

  const sessionToken = String(body.sessionToken || "").trim();
  if (!sessionToken) {
    return { statusCode: 400, headers: corsJson(), body: JSON.stringify({ ok: false, error: "Missing sessionToken" }) };
  }

  let mysqlOpts;
  try {
    mysqlOpts = mysqlConnectionOptions();
  } catch (e) {
    const cfg = databaseConfigErrorResponse(e);
    if (cfg) {
      return { ...cfg, headers: corsJson(), body: JSON.stringify({ ok: false, ...(JSON.parse(cfg.body || "{}")) }) };
    }
    throw e;
  }

  let conn;
  try {
    conn = await mysql.createConnection(mysqlOpts);
  } catch (e) {
    return {
      statusCode: 500,
      headers: corsJson(),
      body: JSON.stringify({ ok: false, error: "Database connection failed" }),
    };
  }

  try {
    const [sessRows] = await conn.execute(
      `SELECT discord_id FROM store_sessions WHERE session_token = ? AND expires_at > NOW() LIMIT 1`,
      [sessionToken]
    );
    if (!Array.isArray(sessRows) || sessRows.length === 0) {
      return { statusCode: 401, headers: corsJson(), body: JSON.stringify({ ok: false, error: "Invalid or expired session" }) };
    }
    const discordUserId = String(sessRows[0].discord_id);

    const [prevRows] = await conn.execute(
      `SELECT lucids_spent FROM checkout_paypal_lucid_prepayment WHERE discord_user_id = ? LIMIT 1`,
      [discordUserId]
    );
    if (!Array.isArray(prevRows) || prevRows.length === 0) {
      return { statusCode: 200, headers: corsJson(), body: JSON.stringify({ ok: true, refunded: 0 }) };
    }

    const prevSpent = Math.max(0, Math.floor(Number(prevRows[0].lucids_spent || 0)));
    if (prevSpent > 0) {
      await conn.execute(
        `INSERT INTO store_user_balances (discord_id, lucids) VALUES (?, 0)
         ON DUPLICATE KEY UPDATE lucids = CAST(lucids AS SIGNED) + ?`,
        [discordUserId, prevSpent]
      );
    }
    await conn.execute(`DELETE FROM checkout_paypal_lucid_prepayment WHERE discord_user_id = ?`, [discordUserId]);

    return {
      statusCode: 200,
      headers: corsJson(),
      body: JSON.stringify({ ok: true, refunded: prevSpent }),
    };
  } catch (err) {
    console.error("[release-checkout-lucids]", err);
    return {
      statusCode: 500,
      headers: corsJson(),
      body: JSON.stringify({ ok: false, error: err?.message || String(err) }),
    };
  } finally {
    await conn.end().catch(() => {});
  }
};

function corsJson() {
  return { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" };
}
