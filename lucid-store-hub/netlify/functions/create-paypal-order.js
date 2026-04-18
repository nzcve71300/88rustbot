// Using built-in fetch (Node 18+)

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

    const { items, total } = requestBody;

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

    if (!total || typeof total !== 'number' || total <= 0) {
      console.error('Invalid total:', total);
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({ error: 'Invalid total amount' }),
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

    // Validate and prepare items
    const validatedItems = items.map((item) => {
      const price = typeof item.price === 'number' ? item.price : parseFloat(item.price);
      const quantity = typeof item.quantity === 'number' ? item.quantity : parseInt(item.quantity, 10);
      
      if (isNaN(price) || price <= 0) {
        throw new Error(`Invalid price for item: ${item.name}`);
      }
      if (isNaN(quantity) || quantity <= 0) {
        throw new Error(`Invalid quantity for item: ${item.name}`);
      }
      
      return {
        name: String(item.name || 'Unnamed Item').substring(0, 127), // PayPal max length
        quantity: String(quantity),
        unit_amount: {
          currency_code: 'EUR',
          value: price.toFixed(2),
        },
      };
    });

    // Calculate item total to verify
    const calculatedTotal = validatedItems.reduce((sum, item) => {
      return sum + (parseFloat(item.unit_amount.value) * parseInt(item.quantity, 10));
    }, 0);

    console.log('Order calculation:', {
      providedTotal: total,
      calculatedTotal: calculatedTotal.toFixed(2),
      itemCount: validatedItems.length,
    });

    // Create order
    const orderData = {
      intent: 'CAPTURE',
      purchase_units: [
        {
          amount: {
            currency_code: 'EUR',
            value: total.toFixed(2),
            breakdown: {
              item_total: {
                currency_code: 'EUR',
                value: calculatedTotal.toFixed(2),
              },
            },
          },
          items: validatedItems,
        },
      ],
      application_context: {
        brand_name: 'Lucid Store Hub',
        landing_page: 'NO_PREFERENCE',
        user_action: 'PAY_NOW',
        return_url: `${event.headers.origin || event.headers.referer || ''}/checkout/success`,
        cancel_url: `${event.headers.origin || event.headers.referer || ''}/checkout/cancel`,
      },
    };

    console.log('Creating PayPal order with data:', {
      itemCount: validatedItems.length,
      total: total,
      calculatedTotal: calculatedTotal.toFixed(2),
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
