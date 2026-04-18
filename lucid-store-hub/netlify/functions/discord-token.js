exports.handler = async (event, context) => {
  // Only allow POST requests
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method Not Allowed' }),
    };
  }

  try {
    const { code, redirect_uri } = JSON.parse(event.body);

    if (!code || !redirect_uri) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Missing code or redirect_uri' }),
      };
    }

    const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
    const CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;

    if (!CLIENT_ID || !CLIENT_SECRET) {
      return {
        statusCode: 500,
        body: JSON.stringify({
          error: 'Discord OAuth not configured',
          details: 'Missing DISCORD_CLIENT_ID or DISCORD_CLIENT_SECRET in environment variables.',
        }),
      };
    }

    // Exchange code for access token
    const tokenResponse = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        grant_type: 'authorization_code',
        code: code,
        redirect_uri: redirect_uri,
      }),
    });

    const tokenData = await tokenResponse.json();

    if (!tokenResponse.ok) {
      return {
        statusCode: 400,
        body: JSON.stringify({ 
          error: tokenData.error_description || 'Token exchange failed',
          details: tokenData 
        }),
      };
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ access_token: tokenData.access_token }),
    };
  } catch (error) {
    console.error('Discord token exchange error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Internal server error', message: error.message }),
    };
  }
};

