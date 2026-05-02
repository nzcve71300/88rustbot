// Using built-in fetch (Node 18+)
const mysql = require("mysql2/promise");
const { validateCart } = require("./_loadKitsCatalog");
const { fingerprintFromValidatedCart, round2 } = require("./_checkoutHybrid");
const { mysqlConnectionOptions } = require("./_enqueueStoreFulfillment");

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
    // Parse request body
    let requestBody;
    try {
      requestBody = JSON.parse(event.body);
    } catch (parseError) {
      console.error('Error parsing request body:', parseError);
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({ error: 'Invalid request body', details: parseError.message }),
      };
    }

    const { items, total, sessionToken: sessionTokenRaw, userId: userIdRaw } = requestBody;

    if (!items || !Array.isArray(items) || items.length === 0) {
      console.error('Invalid items:', items);
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({ error: 'Invalid items - items array is required' }),
      };
    }

    let validated;
    try {
      validated = validateCart(items);
    } catch (catalogErr) {
      console.error('[create-paypal-order] catalog / validateCart error:', catalogErr);
      return {
        statusCode: 503,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({
          error: 'Store catalog unavailable',
          message: catalogErr?.message || String(catalogErr),
        }),
      };
    }
    if (!validated.ok) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ error: validated.error || 'Invalid cart' }),
      };
    }

    const sessionToken = String(sessionTokenRaw || "").trim();
    const requestUserId = String(userIdRaw || "").trim();

    let validatedItemsForPaypal = validated.lines.map((line) => {
      const name = `[${line.kind === 'one-time' ? 'One Time' : 'Lifetime'}] ${line.name}`.substring(0, 127);
      return {
        name,
        quantity: String(line.quantity),
        unit_amount: {
          currency_code: 'EUR',
          value: line.priceEur.toFixed(2),
        },
      };
    });

    let paypalTotalNum = validatedItemsForPaypal.reduce((sum, item) => {
      return sum + parseFloat(item.unit_amount.value) * parseInt(item.quantity, 10);
    }, 0);

    if (sessionToken) {
      let conn = null;
      try {
        conn = await mysql.createConnection(mysqlConnectionOptions());
        const [sessRows] = await conn.execute(
          `SELECT CAST(discord_id AS CHAR) AS discord_id FROM store_sessions WHERE session_token = ? AND expires_at > NOW() LIMIT 1`,
          [sessionToken]
        );
        if (Array.isArray(sessRows) && sessRows.length > 0) {
          const sid = String(sessRows[0].discord_id);
          if (requestUserId && requestUserId !== sid) {
            await conn.end();
            return {
              statusCode: 403,
              headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
              body: JSON.stringify({ error: 'Session does not match this Discord account.' }),
            };
          }
          const fp = fingerprintFromValidatedCart(validated);
          const [prRows] = await conn.execute(
            `SELECT remainder_eur, cart_fingerprint FROM checkout_paypal_lucid_prepayment WHERE discord_user_id = ? LIMIT 1`,
            [sid]
          );
          if (Array.isArray(prRows) && prRows.length > 0) {
            const pr = prRows[0];
            if (String(pr.cart_fingerprint) !== fp) {
              await conn.end();
              return {
                statusCode: 400,
                headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
                body: JSON.stringify({
                  error:
                    'Your cart changed after applying Lucids. Change your cart back or click checkout Lucids reset (edit cart), then try again.',
                }),
              };
            }
            paypalTotalNum = round2(Number(pr.remainder_eur));
            const ps = paypalTotalNum.toFixed(2);
            validatedItemsForPaypal = [
              {
                name: 'Lucid Store order (Lucids balance applied)',
                quantity: '1',
                unit_amount: {
                  currency_code: 'EUR',
                  value: ps,
                },
              },
            ];
          }
        }
        await conn.end();
      } catch (dbErr) {
        if (conn) await conn.end().catch(() => {});
        console.error('[create-paypal-order] Lucids prepayment lookup:', dbErr);
        return {
          statusCode: 503,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
          body: JSON.stringify({
            error: 'Could not verify Lucids checkout credit',
            message: String(dbErr?.message || dbErr),
          }),
        };
      }
    }

    const paypalTotalStr = paypalTotalNum.toFixed(2);

    const clientTotal = typeof total === 'number' ? total : parseFloat(total);
    if (!Number.isFinite(clientTotal) || clientTotal <= 0) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ error: 'Invalid total amount' }),
      };
    }
    if (Math.abs(clientTotal - paypalTotalNum) > 0.02) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ error: 'Cart total mismatch — refresh the store and try again.' }),
      };
    }

    // Get PayPal credentials from environment
    const PAYPAL_CLIENT_ID = process.env.PAYPAL_CLIENT_ID;
    const PAYPAL_CLIENT_SECRET = process.env.PAYPAL_CLIENT_SECRET;
    const PAYPAL_MODE = process.env.PAYPAL_MODE || 'sandbox'; // 'sandbox' or 'live'

    console.log('PayPal Config Check:', {
      hasClientId: !!PAYPAL_CLIENT_ID,
      hasClientSecret: !!PAYPAL_CLIENT_SECRET,
      mode: PAYPAL_MODE,
      clientIdLength: PAYPAL_CLIENT_ID?.length || 0,
    });

    if (!PAYPAL_CLIENT_ID || !PAYPAL_CLIENT_SECRET) {
      console.error('PayPal credentials not configured:', {
        hasClientId: !!PAYPAL_CLIENT_ID,
        hasClientSecret: !!PAYPAL_CLIENT_SECRET,
      });
      return {
        statusCode: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({ 
          error: 'Payment system not configured',
          details: 'PayPal credentials are missing. Please check Netlify environment variables.'
        }),
      };
    }

    const baseUrl = PAYPAL_MODE === 'live' 
      ? 'https://api-m.paypal.com'
      : 'https://api-m.sandbox.paypal.com';

    // Get access token
    console.log('Requesting PayPal access token from:', `${baseUrl}/v1/oauth2/token`);
    let authResponse;
    try {
      authResponse = await fetch(`${baseUrl}/v1/oauth2/token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Authorization': `Basic ${Buffer.from(`${PAYPAL_CLIENT_ID}:${PAYPAL_CLIENT_SECRET}`).toString('base64')}`,
        },
        body: 'grant_type=client_credentials',
      });
      console.log('PayPal auth response received:', {
        status: authResponse.status,
        statusText: authResponse.statusText,
        ok: authResponse.ok,
      });
    } catch (fetchError) {
      console.error('Error fetching PayPal auth token:', {
        message: fetchError.message,
        stack: fetchError.stack,
      });
      return {
        statusCode: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({ 
          error: 'Network error connecting to PayPal',
          details: fetchError.message,
        }),
      };
    }

    if (!authResponse.ok) {
      let errorData;
      try {
        errorData = await authResponse.text();
      } catch (e) {
        errorData = 'Could not read error response';
      }
      console.error('PayPal auth error:', {
        status: authResponse.status,
        statusText: authResponse.statusText,
        error: errorData,
      });
      return {
        statusCode: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({ 
          error: 'Failed to authenticate with PayPal',
          details: errorData,
          status: authResponse.status,
        }),
      };
    }

    let authData;
    try {
      authData = await authResponse.json();
      console.log('PayPal auth successful, access token received:', {
        hasToken: !!authData.access_token,
        tokenLength: authData.access_token?.length || 0,
        tokenType: authData.token_type,
      });
    } catch (jsonError) {
      console.error('Error parsing PayPal auth response:', {
        message: jsonError.message,
        responseText: await authResponse.text().catch(() => 'Could not read response'),
      });
      return {
        statusCode: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({ 
          error: 'Invalid response from PayPal',
          details: 'Could not parse authentication response',
        }),
      };
    }

    const accessToken = authData.access_token;

    if (!accessToken) {
      console.error('No access token in auth response:', authData);
      return {
        statusCode: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({ 
          error: 'Failed to get access token from PayPal',
          details: 'Access token missing in response',
        }),
      };
    }

    console.log('Order calculation:', {
      catalogTotalEur: validated.totalEur,
      paypalTotalStr,
      itemCount: validatedItemsForPaypal.length,
    });

    // Tie PayPal captures to Discord user (appears on PAYMENT.CAPTURE.COMPLETED as resource.custom_id).
    const purchaseUnit = {
      amount: {
        currency_code: 'EUR',
        value: paypalTotalStr,
        breakdown: {
          item_total: {
            currency_code: 'EUR',
            value: paypalTotalStr,
          },
        },
      },
      items: validatedItemsForPaypal,
    };
    const uidRaw = String(requestUserId || '').trim();
    if (/^\d{17,20}$/.test(uidRaw)) {
      purchaseUnit.custom_id = uidRaw.slice(0, 127);
    }

    // Create order
    const orderData = {
      intent: 'CAPTURE',
      purchase_units: [purchaseUnit],
      application_context: {
        brand_name: 'Lucid Store Hub',
        landing_page: 'NO_PREFERENCE',
        user_action: 'PAY_NOW',
        return_url: `${event.headers.origin || event.headers.referer || ''}/checkout/success`,
        cancel_url: `${event.headers.origin || event.headers.referer || ''}/checkout/cancel`,
      },
    };

    console.log('Creating PayPal order with data:', {
      itemCount: validatedItemsForPaypal.length,
      totalEur: paypalTotalStr,
      currency: 'EUR',
    });

    let orderResponse;
    try {
      orderResponse = await fetch(`${baseUrl}/v2/checkout/orders`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`,
          'PayPal-Request-Id': `order-${Date.now()}`,
        },
        body: JSON.stringify(orderData),
      });
      console.log('PayPal order request completed');
    } catch (fetchError) {
      console.error('Error creating PayPal order (network):', {
        message: fetchError.message,
        stack: fetchError.stack,
      });
      return {
        statusCode: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({ 
          error: 'Network error creating PayPal order',
          details: fetchError.message,
        }),
      };
    }

    console.log('PayPal order response status:', {
      status: orderResponse.status,
      statusText: orderResponse.statusText,
      ok: orderResponse.ok,
    });

    if (!orderResponse.ok) {
      const errorData = await orderResponse.text();
      console.error('PayPal order creation error:', {
        status: orderResponse.status,
        statusText: orderResponse.statusText,
        error: errorData,
        orderData: JSON.stringify(orderData, null, 2),
      });
      return {
        statusCode: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({ 
          error: 'Failed to create PayPal order',
          details: errorData,
          status: orderResponse.status,
        }),
      };
    }

    let orderDataResponse;
    try {
      orderDataResponse = await orderResponse.json();
      console.log('PayPal order created successfully:', {
        orderId: orderDataResponse.id,
        status: orderDataResponse.status,
        hasId: !!orderDataResponse.id,
      });
    } catch (jsonError) {
      const responseText = await orderResponse.text().catch(() => 'Could not read response');
      console.error('Error parsing PayPal order response:', {
        message: jsonError.message,
        responseText: responseText.substring(0, 500), // Limit length
      });
      return {
        statusCode: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({ 
          error: 'Invalid response from PayPal',
          details: 'Could not parse order creation response',
        }),
      };
    }

    const orderId = orderDataResponse.id;

    if (!orderId) {
      console.error('No order ID in PayPal response:', JSON.stringify(orderDataResponse, null, 2));
      return {
        statusCode: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({ 
          error: 'Invalid response from PayPal',
          details: 'Order ID missing in response',
        }),
      };
    }

    console.log('Returning order ID to client:', orderId);
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({ orderId }),
    };
  } catch (error) {
    console.error('Error creating PayPal order:', {
      message: error.message,
      stack: error.stack,
      name: error.name,
    });
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({ 
        error: 'Internal server error',
        message: error.message,
        type: error.name,
      }),
    };
  }
};
