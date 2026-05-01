// Using built-in fetch (Node 18+)
const mysql = require('mysql2/promise');
const { validateCart } = require('./_loadKitsCatalog');
const { fingerprintFromValidatedCart } = require('./_checkoutHybrid');
const {
  enqueueStoreFulfillment,
  mysqlConnectionOptions,
  databaseConfigErrorResponse,
} = require('./_enqueueStoreFulfillment');

exports.handler = async (event, context) => {
  // Only allow POST requests
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({ error: 'Method Not Allowed' }),
    };
  }

  try {
    const { orderId, items, userId, username } = JSON.parse(event.body);

    let v;
    try {
      v = validateCart(items);
    } catch (catalogErr) {
      console.error("[capture-paypal-order] catalog / validateCart:", catalogErr);
      return {
        statusCode: 503,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify({
          success: false,
          error: "Store catalog unavailable",
          message: String(catalogErr?.message || catalogErr),
        }),
      };
    }
    if (!v.ok) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ success: false, error: v.error || 'Invalid cart' }),
      };
    }

    if (!orderId) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({ error: 'Order ID is required' }),
      };
    }

    // Get PayPal credentials from environment
    const PAYPAL_CLIENT_ID = process.env.PAYPAL_CLIENT_ID;
    const PAYPAL_CLIENT_SECRET = process.env.PAYPAL_CLIENT_SECRET;
    const PAYPAL_MODE = process.env.PAYPAL_MODE || 'sandbox';

    if (!PAYPAL_CLIENT_ID || !PAYPAL_CLIENT_SECRET) {
      return {
        statusCode: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({ error: 'Payment system not configured' }),
      };
    }

    const baseUrl = PAYPAL_MODE === 'live' 
      ? 'https://api-m.paypal.com'
      : 'https://api-m.sandbox.paypal.com';

    // Get access token
    const authResponse = await fetch(`${baseUrl}/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${Buffer.from(`${PAYPAL_CLIENT_ID}:${PAYPAL_CLIENT_SECRET}`).toString('base64')}`,
      },
      body: 'grant_type=client_credentials',
    });

    if (!authResponse.ok) {
      return {
        statusCode: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({ error: 'Failed to authenticate with PayPal' }),
      };
    }

    const authData = await authResponse.json();
    const accessToken = authData.access_token;

    // Capture the order
    const captureResponse = await fetch(`${baseUrl}/v2/checkout/orders/${orderId}/capture`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
      },
    });

    if (!captureResponse.ok) {
      const errorData = await captureResponse.text();
      console.error('PayPal capture error:', errorData);
      return {
        statusCode: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({ error: 'Failed to capture payment' }),
      };
    }

    const captureData = await captureResponse.json();
    
    // Check if payment was successful
    if (captureData.status !== 'COMPLETED') {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({ 
          success: false,
          error: 'Payment not completed',
          status: captureData.status 
        }),
      };
    }

    const purchaseAmount = parseFloat(captureData.purchase_units[0]?.payments?.captures[0]?.amount?.value || '0');

    let expectedPaypalAmount = v.totalEur;
    /** @type {number | null} */
    let prepaymentLucidsSpent = null;
    if (userId) {
      let pconn = null;
      try {
        pconn = await mysql.createConnection(mysqlConnectionOptions());
        const [prRows] = await pconn.execute(
          `SELECT remainder_eur, cart_fingerprint, lucids_spent FROM checkout_paypal_lucid_prepayment WHERE discord_user_id = ? LIMIT 1`,
          [String(userId)]
        );
        if (Array.isArray(prRows) && prRows.length > 0) {
          const row = prRows[0];
          const fp = fingerprintFromValidatedCart(v);
          if (String(row.cart_fingerprint) !== fp) {
            await pconn.end();
            return {
              statusCode: 400,
              headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
              body: JSON.stringify({
                success: false,
                error: 'Cart does not match your Lucids credit. Go back to checkout and sync your cart.',
              }),
            };
          }
          expectedPaypalAmount = Number(row.remainder_eur);
          prepaymentLucidsSpent = Math.max(0, Math.floor(Number(row.lucids_spent || 0)));
        }
        await pconn.end();
        pconn = null;
      } catch (pe) {
        if (pconn) await pconn.end().catch(() => {});
        console.error('[capture-paypal-order] prepayment read:', pe);
        return {
          statusCode: 503,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
          body: JSON.stringify({ success: false, error: 'Could not verify checkout credit.' }),
        };
      }
    }

    if (!Number.isFinite(purchaseAmount) || Math.abs(purchaseAmount - expectedPaypalAmount) > 0.05) {
      console.error('[capture-paypal-order] amount mismatch', {
        purchaseAmount,
        expectedPaypalAmount,
        catalogTotalEur: v.totalEur,
      });
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ success: false, error: 'Paid amount does not match cart. Contact support.' }),
      };
    }

    if (userId && prepaymentLucidsSpent != null) {
      try {
        const dconn = await mysql.createConnection(mysqlConnectionOptions());
        await dconn.execute(`DELETE FROM checkout_paypal_lucid_prepayment WHERE discord_user_id = ?`, [String(userId)]);
        await dconn.end();
      } catch (delErr) {
        console.error('[capture-paypal-order] prepayment clear:', delErr);
      }
    }

    /** @type {string|null} */
    let fulfillmentWarning = null;

    let mysqlOpts = null;
    try {
      mysqlOpts = mysqlConnectionOptions();
    } catch (e) {
      const cfg = databaseConfigErrorResponse(e);
      if (cfg) {
        try {
          fulfillmentWarning = JSON.parse(cfg.body).message;
        } catch {
          fulfillmentWarning = e.message;
        }
        console.warn('[capture-paypal-order] DB env not usable:', fulfillmentWarning);
      }
    }

    const paypalTransactionId = captureData.purchase_units[0]?.payments?.captures[0]?.id || orderId;

    // Save order to database (non-fatal — payment is already captured)
    if (mysqlOpts) {
      try {
        const connection = await mysql.createConnection(mysqlOpts);
        await connection.execute(`
          CREATE TABLE IF NOT EXISTS lucid_orders (
            id BIGINT AUTO_INCREMENT PRIMARY KEY,
            order_id VARCHAR(255) NOT NULL,
            paypal_order_id VARCHAR(255) NULL,
            paypal_transaction_id VARCHAR(255) NULL,
            user_id VARCHAR(255) NULL,
            username VARCHAR(255) NULL,
            items TEXT NOT NULL,
            total_amount DECIMAL(10,2) NOT NULL DEFAULT 0.00,
            status VARCHAR(32) NOT NULL DEFAULT 'completed',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE KEY uq_order_id (order_id),
            KEY idx_user (user_id),
            KEY idx_created (created_at)
          ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        await connection.execute(
          `INSERT INTO lucid_orders 
         (order_id, paypal_order_id, paypal_transaction_id, user_id, username, items, total_amount, status, created_at) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
          [
            orderId,
            orderId,
            paypalTransactionId,
            userId || null,
            username || 'Unknown',
            JSON.stringify(items),
            purchaseAmount,
            'completed',
          ]
        );
        await connection.end();
      } catch (dbError) {
        console.error('Database error (non-critical):', dbError);
        fulfillmentWarning =
          fulfillmentWarning ||
          `Order record not saved: ${dbError.message}. Fulfillment may be delayed — contact staff with PayPal receipt.`;
      }
    }

    // Queue fulfillment for Lucid Discord bot (roles + sales channel message).
    if (mysqlOpts && userId) {
      try {
        await enqueueStoreFulfillment({
          discordUserId: String(userId),
          username: username || null,
          paymentMethod: 'paypal',
          amountEur: v.totalEur,
          lucidsSpent: prepaymentLucidsSpent,
          idempotencyKey: `paypal:${paypalTransactionId}`,
          lines: v.lines,
        });
      } catch (fulErr) {
        console.error('[capture-paypal-order] fulfillment enqueue error', fulErr);
        fulfillmentWarning =
          fulfillmentWarning ||
          `Fulfillment queue failed: ${fulErr.message}. Payment was taken — contact staff with your Discord ID and order time.`;
      }
    } else if (!userId) {
      console.warn('[capture-paypal-order] skip fulfillment queue — missing userId');
    } else if (!mysqlOpts) {
      fulfillmentWarning =
        fulfillmentWarning ||
        'Fulfillment queue skipped (database not reachable from Netlify). Set DB_HOST to your MariaDB public host.';
    }

    // Optional: trigger instant Discord delivery via Lucid bot API (Cloudflare Tunnel).
    const botApiBase = String(process.env.LUCID_STORE_BOT_API_BASE_URL || "").trim().replace(/\/+$/, "");
    const botApiKey = String(process.env.LUCID_STORE_BOT_API_KEY || "").trim();
    if (botApiBase && botApiKey && userId) {
      try {
        const r = await fetch(`${botApiBase}/store/fulfill`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-store-key": botApiKey,
          },
          body: JSON.stringify({
            discordUserId: String(userId),
            username: username || null,
            amountEur: v.totalEur,
            lucidsSpent: prepaymentLucidsSpent,
            paymentMethod: "paypal",
            lines: v.lines,
          }),
        });
        if (!r.ok) {
          const t = await r.text().catch(() => "");
          console.warn("[capture-paypal-order] bot delivery trigger non-200:", r.status, t);
        }
      } catch (e) {
        console.warn("[capture-paypal-order] bot delivery trigger failed:", e?.message || e);
      }
    }

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        success: true,
        orderId,
        transactionId: captureData.purchase_units[0]?.payments?.captures[0]?.id,
        amount: captureData.purchase_units[0]?.payments?.captures[0]?.amount?.value,
        fulfillmentWarning,
      }),
    };
  } catch (error) {
    console.error('Error capturing PayPal order:', error);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({ 
        success: false,
        error: 'Internal server error',
        message: error.message 
      }),
    };
  }
};
