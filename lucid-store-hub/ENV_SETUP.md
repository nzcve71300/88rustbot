# Environment Variables Setup

## Local Development (.env file)

Create a `.env` file in the root of `lucid-store-hub`:

```env
# PayPal Configuration
VITE_PAYPAL_CLIENT_ID=your_paypal_client_id_here
```

**Note:** The `VITE_` prefix is required for Vite to expose the variable to the frontend.

## Netlify Environment Variables

Go to your Netlify site dashboard:
1. Navigate to **Site settings** > **Environment variables**
2. Add the following variables:

```
# Store purchase -> Discord channel (used by capture-paypal-order + claim-free-items)
# Prefer a dedicated sales webhook; falls back to DISCORD_WEBHOOK_URL if unset.
DISCORD_SALES_WEBHOOK_URL=your_discord_sales_channel_webhook_url

# Optional: PayPal server webhook -> Discord (separate function paypal-webhook.js)
DISCORD_WEBHOOK_URL=your_discord_channel_webhook_url

# Optional: full URL to sales banner image (otherwise uses https://your-site/sales.png)
# SALES_IMAGE_URL=https://your-site.netlify.app/sales.png

PAYPAL_CLIENT_ID=your_paypal_client_id
PAYPAL_CLIENT_SECRET=your_paypal_client_secret
PAYPAL_MODE=sandbox
PAYPAL_WEBHOOK_ID=your_paypal_webhook_id
DISCORD_CLIENT_ID=your_discord_client_id
DISCORD_CLIENT_SECRET=your_discord_client_secret
DB_HOST=localhost
DB_USER=your_database_user
DB_PASSWORD=your_database_password
DB_NAME=your_database_name
DB_PORT=3306
```

### Important Notes:

- **VITE_PAYPAL_CLIENT_ID**: Used in frontend (safe to expose)
- **PAYPAL_CLIENT_SECRET**: Only used in server-side functions (NEVER expose in frontend)
- **PAYPAL_MODE**: Set to `sandbox` for testing, `live` for production
- **PAYPAL_WEBHOOK_ID**: Used to verify PayPal webhooks (server-side only)
- **DISCORD_CLIENT_SECRET**: Only used in server-side functions (NEVER expose in frontend)
- **DISCORD_SALES_WEBHOOK_URL** / **DISCORD_WEBHOOK_URL**: Webhook URL where successful store purchases (paid or free) are posted. Set at least one.
- **SALES_IMAGE_URL** (optional): Override image URL for the embed banner; place `public/sales.png` in the repo for the default.
- **Database variables**: Only needed if you want to store orders in the database

## Getting PayPal Credentials

1. Go to [PayPal Developer Dashboard](https://developer.paypal.com/)
2. Sign in and navigate to **Dashboard** > **My Apps & Credentials**
3. For testing: Use **Sandbox** tab
4. For production: Use **Live** tab (requires business verification)
5. Create an app and copy the **Client ID** and **Secret**

See `PAYPAL_SETUP.md` for detailed setup instructions.
