// Using built-in fetch (Node 18+)
const mysql = require('mysql2/promise');
const crypto = require('crypto');
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

    const { items, userId, username } = requestBody;

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

    // Verify all items are free (price === 0)
    const totalPrice = items.reduce((sum, item) => sum + (item.price || 0) * (item.quantity || 1), 0);
    if (totalPrice > 0) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({ error: 'Items are not free. Total must be 0.' }),
      };
    }

    // Generate order ID
    const orderId = `FREE-${crypto.randomBytes(8).toString('hex').toUpperCase()}-${Date.now()}`;

    // Save order to database
    try {
      const connection = await mysql.createConnection({
        host: process.env.DB_HOST || 'localhost',
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        port: parseInt(process.env.DB_PORT || '3306'),
      });

      // Insert order record
      await connection.execute(
        `INSERT INTO lucid_orders 
         (order_id, paypal_order_id, paypal_transaction_id, user_id, username, items, total_amount, status, created_at) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
        [
          orderId,
          null, // No PayPal order for free items
          'FREE', // Mark as free transaction
          userId || null,
          username || 'Unknown',
          JSON.stringify(items),
          0, // Total amount is 0 for free items
          'completed',
        ]
      );

      await connection.end();
      console.log('Free order saved successfully:', { orderId, itemCount: items.length });
    } catch (dbError) {
      console.error('Database error saving free order:', dbError);
      return {
        statusCode: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({ 
          success: false,
          error: 'Database error',
          details: dbError.message 
        }),
      };
    }

    try {
      await notifyDiscordSale({
        event,
        userId: userId || null,
        username: username || null,
        items,
        amount: 0,
        currency: 'EUR',
      });
    } catch (e) {
      console.warn('[claim-free-items] discord notify error', e);
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
        transactionId: 'FREE',
        amount: 0,
        message: 'Free items claimed successfully'
      }),
    };
  } catch (error) {
    console.error('Error claiming free items:', error);
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
