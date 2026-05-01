const mysql = require("mysql2/promise");
const { validateCart } = require("./_loadKitsCatalog");
const { fingerprintFromValidatedCart, round2 } = require("./_checkoutHybrid");
const {
  mysqlConnectionOptions,
  databaseConfigErrorResponse,
} = require("./_enqueueStoreFulfillment");

async function ensurePrepaymentTable(conn) {
  await conn.execute(`
    CREATE TABLE IF NOT EXISTS checkout_paypal_lucid_prepayment (
      discord_user_id VARCHAR(32) NOT NULL PRIMARY KEY,
      cart_fingerprint VARCHAR(64) NOT NULL,
      cart_sig VARCHAR(512) NOT NULL,
      lucids_spent INT NOT NULL,
      remainder_eur DECIMAL(10,2) NOT NULL,
      total_eur DECIMAL(10,2) NOT NULL,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

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
  const items = body.items;
  if (!sessionToken) {
    return { statusCode: 400, headers: corsJson(), body: JSON.stringify({ ok: false, error: "Missing sessionToken" }) };
  }

  const base = String(process.env.EVENT_BOT_API_BASE_URL || "").trim().replace(/\/+$/, "");
  const key = String(process.env.EVENT_BOT_API_KEY || "").trim();
  if (!base || !key) {
    return {
      statusCode: 503,
      headers: corsJson(),
      body: JSON.stringify({ ok: false, error: "Lucids API not configured (EVENT_BOT_API_BASE_URL / EVENT_BOT_API_KEY)" }),
    };
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
    console.error("[apply-checkout-lucids] DB connect:", e);
    return {
      statusCode: 500,
      headers: corsJson(),
      body: JSON.stringify({ ok: false, error: "Database connection failed" }),
    };
  }

  try {
    await ensurePrepaymentTable(conn);

    const [sessRows] = await conn.execute(
      `SELECT discord_id FROM store_sessions WHERE session_token = ? AND expires_at > NOW() LIMIT 1`,
      [sessionToken]
    );
    if (!Array.isArray(sessRows) || sessRows.length === 0) {
      return { statusCode: 401, headers: corsJson(), body: JSON.stringify({ ok: false, error: "Invalid or expired session" }) };
    }
    const discordUserId = String(sessRows[0].discord_id);

    let v;
    try {
      v = validateCart(items);
    } catch (catalogErr) {
      console.error("[apply-checkout-lucids] validateCart:", catalogErr);
      return {
        statusCode: 503,
        headers: corsJson(),
        body: JSON.stringify({ ok: false, error: "Store catalog unavailable" }),
      };
    }
    if (!v.ok) {
      return { statusCode: 400, headers: corsJson(), body: JSON.stringify({ ok: false, error: v.error || "Invalid cart" }) };
    }

    if (v.totalLucids <= 0) {
      return { statusCode: 400, headers: corsJson(), body: JSON.stringify({ ok: false, error: "Nothing to purchase" }) };
    }

    const [balRows] = await conn.execute(
      `SELECT CAST(lucids AS CHAR) AS lucids FROM store_user_balances WHERE discord_id = ? LIMIT 1`,
      [discordUserId]
    );
    const rawBal =
      Array.isArray(balRows) && balRows.length > 0
        ? Number.parseInt(String(balRows[0].lucids || "0"), 10)
        : 0;
    const balance = Number.isFinite(rawBal) ? Math.max(0, Math.floor(rawBal)) : 0;

    if (balance <= 0) {
      return {
        statusCode: 400,
        headers: corsJson(),
        body: JSON.stringify({ ok: false, error: "You have no Lucids to apply. Use PayPal for the full amount." }),
      };
    }

    if (balance >= v.totalLucids) {
      return {
        statusCode: 400,
        headers: corsJson(),
        body: JSON.stringify({
          ok: false,
          error: "You have enough Lucids for this cart — use **Pay with Lucids** instead of splitting with PayPal.",
        }),
      };
    }

    const lucidsSpent = Math.min(balance, v.totalLucids);
    const remainderEur = round2(v.totalEur - lucidsSpent / 100);

    if (remainderEur < 0.01) {
      return {
        statusCode: 400,
        headers: corsJson(),
        body: JSON.stringify({ ok: false, error: "Remaining card amount is too small — refresh and try Pay with Lucids." }),
      };
    }

    const fp = fingerprintFromValidatedCart(v);
    const cartSig = v.lines
      .map((l) => `${l.id}:${l.quantity}`)
      .sort()
      .join("|");

    const [prevRows] = await conn.execute(
      `SELECT lucids_spent FROM checkout_paypal_lucid_prepayment WHERE discord_user_id = ? LIMIT 1`,
      [discordUserId]
    );
    const prevSpent =
      Array.isArray(prevRows) && prevRows.length > 0 ? Math.max(0, Math.floor(Number(prevRows[0].lucids_spent || 0))) : 0;

    if (prevSpent > 0) {
      await conn.execute(
        `INSERT INTO store_user_balances (discord_id, lucids) VALUES (?, 0)
         ON DUPLICATE KEY UPDATE lucids = CAST(lucids AS SIGNED) + ?`,
        [discordUserId, prevSpent]
      );
      await conn.execute(`DELETE FROM checkout_paypal_lucid_prepayment WHERE discord_user_id = ?`, [discordUserId]);
    }

    const spendRes = await fetch(`${base}/api/me/lucids/spend`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": key,
        "x-discord-user-id": discordUserId,
      },
      body: JSON.stringify({ amount: lucidsSpent }),
    });
    const spendText = await spendRes.text();
    let spendJson = null;
    try {
      spendJson = JSON.parse(spendText);
    } catch {
      spendJson = { ok: false, raw: spendText };
    }

    if (!spendRes.ok || !spendJson?.ok) {
      const msg =
        spendRes.status === 409
          ? "Insufficient Lucids."
          : spendJson?.error || spendJson?.message || "Could not spend Lucids.";
      return {
        statusCode: spendRes.status === 409 ? 409 : 502,
        headers: corsJson(),
        body: JSON.stringify({ ok: false, error: msg }),
      };
    }

    const newBalance =
      typeof spendJson.newBalance === "number"
        ? Math.max(0, Math.floor(spendJson.newBalance))
        : typeof spendJson.newBalance === "string"
          ? Math.max(0, Math.floor(parseInt(spendJson.newBalance, 10) || 0))
          : null;

    await conn.execute(
      `REPLACE INTO checkout_paypal_lucid_prepayment
       (discord_user_id, cart_fingerprint, cart_sig, lucids_spent, remainder_eur, total_eur)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [discordUserId, fp, cartSig.slice(0, 512), lucidsSpent, remainderEur, v.totalEur]
    );

    return {
      statusCode: 200,
      headers: corsJson(),
      body: JSON.stringify({
        ok: true,
        lucidsSpent,
        remainderEur,
        totalEur: v.totalEur,
        totalLucids: v.totalLucids,
        newBalance,
        cartFingerprint: fp,
        cartSig,
      }),
    };
  } catch (err) {
    console.error("[apply-checkout-lucids]", err);
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
