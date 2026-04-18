// Using built-in fetch (Node 18+)
const mysql = require('mysql2/promise');
const { notifyDiscordSale } = require('./discord-sale-notify');

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

    // Save order to database
    try {
      const connection = await mysql.createConnection({
        host: process.env.DB_HOST || 'localhost',
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        port: parseInt(process.env.DB_PORT || '3306'),
      });

      const purchaseAmount = parseFloat(captureData.purchase_units[0]?.payments?.captures[0]?.amount?.value || '0');
      const paypalTransactionId = captureData.purchase_units[0]?.payments?.captures[0]?.id || orderId;

      // Insert order record
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
      // Don't fail the payment if DB save fails - payment is already captured
    }

    // Notify Discord via webhook (non-blocking for payment success).
    try {
      const purchaseAmount = captureData.purchase_units[0]?.payments?.captures[0]?.amount?.value || null;
      const purchaseCurrency = captureData.purchase_units[0]?.payments?.captures[0]?.amount?.currency_code || 'EUR';

      await notifyDiscordSale({
        event,
        userId: userId || null,
        username: username || null,
        items,
        amount: purchaseAmount,
        currency: purchaseCurrency,
      });
    } catch (notifyErr) {
      console.warn('[capture-paypal-order] sale notify error', notifyErr);
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
