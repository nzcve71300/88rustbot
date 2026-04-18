# PayPal Integration Setup Guide

## Step 1: Create PayPal Developer Account

1. Go to [PayPal Developer Dashboard](https://developer.paypal.com/)
2. Sign in with your PayPal account or create a new one
3. Navigate to **Dashboard** > **My Apps & Credentials**

## Step 2: Create PayPal App

### For Testing (Sandbox):
1. Go to **Sandbox** tab
2. Click **Create App**
3. Name it "Lucid Store Hub" (or any name you prefer)
4. Select **Merchant** as the app type
5. Click **Create App**
6. Copy the **Client ID** and **Secret**

### For Production (Live):
1. Go to **Live** tab
2. Click **Create App**
3. Follow the same steps as above
4. **Important**: You'll need to complete PayPal's business verification for live mode

## Step 3: Configure Environment Variables

### Local Development (.env file):
Create a `.env` file in the root of `lucid-store-hub`:

```env
VITE_PAYPAL_CLIENT_ID=your_sandbox_client_id_here
```

### Netlify Environment Variables:
1. Go to your Netlify site dashboard
2. Navigate to **Site settings** > **Environment variables**
3. Add the following variables:

```
PAYPAL_CLIENT_ID=your_paypal_client_id
PAYPAL_CLIENT_SECRET=your_paypal_client_secret
PAYPAL_MODE=sandbox  (or 'live' for production)
DB_HOST=your_db_host
DB_USER=your_db_user
DB_PASSWORD=your_db_password
DB_NAME=your_db_name
DB_PORT=3306
```

## Step 4: Create Database Table

Run this SQL to create the orders table:

```sql
CREATE TABLE IF NOT EXISTS lucid_orders (
  id INT AUTO_INCREMENT PRIMARY KEY,
  order_id VARCHAR(255) NOT NULL UNIQUE,
  paypal_order_id VARCHAR(255) NOT NULL,
  paypal_transaction_id VARCHAR(255),
  user_id VARCHAR(255),
  username VARCHAR(255),
  items JSON NOT NULL,
  total_amount DECIMAL(10, 2) NOT NULL,
  status VARCHAR(50) DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_user_id (user_id),
  INDEX idx_paypal_order_id (paypal_order_id),
  INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

## Step 5: Test the Integration

1. Install dependencies: `npm install`
2. Start the dev server: `npm run dev`
3. Add items to cart and proceed to checkout
4. Use PayPal sandbox test accounts for testing:
   - Go to [PayPal Sandbox Accounts](https://developer.paypal.com/dashboard/accounts)
   - Create test buyer and seller accounts
   - Use these accounts to test payments

## Step 6: Go Live

When ready for production:
1. Complete PayPal business verification
2. Switch `PAYPAL_MODE` to `'live'` in Netlify
3. Update `VITE_PAYPAL_CLIENT_ID` with your live client ID
4. Update `PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_SECRET` in Netlify with live credentials
5. Test with a small transaction first

## Security Notes

- **Never commit** `.env` files to git
- Keep your `PAYPAL_CLIENT_SECRET` secure and only in server-side environment variables
- The client ID is safe to expose in the frontend
- Always use HTTPS in production
- Regularly review PayPal transaction logs

## Troubleshooting

### "Payment system not configured"
- Check that `VITE_PAYPAL_CLIENT_ID` is set in your `.env` file
- Restart your dev server after adding environment variables

### "Failed to authenticate with PayPal"
- Verify your `PAYPAL_CLIENT_SECRET` is correct in Netlify
- Check that you're using the correct mode (sandbox vs live)

### Orders not saving to database
- Verify database credentials in Netlify environment variables
- Check that the `lucid_orders` table exists
- Review Netlify function logs for database errors
