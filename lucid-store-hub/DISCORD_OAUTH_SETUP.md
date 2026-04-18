# Discord OAuth Setup Instructions

## Redirect URL for Discord Application

Add this redirect URL to your Discord application settings:

```
https://lucidclans.netlify.app/auth/callback
```

## Backend Endpoint Required

The Discord OAuth flow requires a backend endpoint to exchange the authorization code for an access token (because the client secret cannot be exposed in the frontend).

### Option 1: Netlify Functions (Recommended)

Create a Netlify Function at `netlify/functions/discord-token.js`:

```javascript
exports.handler = async (event, context) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const { code, redirect_uri } = JSON.parse(event.body);
  const CLIENT_ID = '1460597371863040112';
  const CLIENT_SECRET = 'KqmXUj44kxreu901fETmH_PlJPjfGSqX';

  try {
    const response = await fetch('https://discord.com/api/oauth2/token', {
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

    const data = await response.json();
    
    if (!response.ok) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: data.error_description || 'Token exchange failed' }),
      };
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ access_token: data.access_token }),
    };
  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Internal server error' }),
    };
  }
};
```

Then update `AuthContext.tsx` to use the correct endpoint:

```typescript
const response = await fetch('/.netlify/functions/discord-token', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ code, redirect_uri: DISCORD_REDIRECT_URI }),
});
```

### Option 2: Custom Backend API

If you have a custom backend, create an endpoint at `/api/discord/token` that:
1. Receives `{ code, redirect_uri }` in the request body
2. Exchanges the code for a token using Discord's API
3. Returns `{ access_token: "..." }`

## Discord Application Settings

1. Go to https://discord.com/developers/applications
2. Select your application (Client ID: 1460597371863040112)
3. Go to OAuth2 → Redirects
4. Add: `https://lucidclans.netlify.app/auth/callback`
5. Save changes

## Testing

1. Click "Login" on the website
2. You'll be redirected to Discord
3. Authorize the application
4. You'll be redirected back to `/auth/callback`
5. The backend endpoint exchanges the code for a token
6. User info is fetched and stored
7. You're redirected to the home page, logged in

