# PayPal Checkout Troubleshooting

## Common Issues and Solutions

### Issue: PayPal popup opens then immediately closes (500 error)

**Possible Causes:**

1. **Missing Environment Variables in Netlify**
   - Check that `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, and `PAYPAL_MODE` are set in Netlify
   - Go to: Netlify Dashboard → Site Settings → Environment Variables
   - Make sure they're spelled correctly (case-sensitive)

2. **Invalid PayPal Credentials**
   - Verify your Client ID and Secret are correct
   - Make sure you're using Sandbox credentials if `PAYPAL_MODE=sandbox`
   - Check PayPal Developer Dashboard to confirm credentials

3. **Function Not Deployed**
   - Make sure you've deployed to Netlify after adding the functions
   - Functions need to be in `netlify/functions/` directory
   - Redeploy your site if you just added the functions

4. **CORS Issues**
   - The functions should handle CORS automatically
   - Check browser console for CORS errors

## How to Debug

### 1. Check Browser Console
Open browser DevTools (F12) → Console tab
- Look for error messages
- Check the Network tab for the failed request
- Look at the response body for error details

### 2. Check Netlify Function Logs
1. Go to Netlify Dashboard
2. Navigate to your site
3. Go to **Functions** tab
4. Click on `create-paypal-order`
5. View the logs to see error messages

### 3. Test Function Locally (Optional)
You can test the function locally using Netlify CLI:
```bash
npm install -g netlify-cli
netlify dev
```

### 4. Verify Environment Variables
In Netlify Dashboard:
- Site Settings → Environment Variables
- Make sure these are set:
  - `PAYPAL_CLIENT_ID` (should start with `AeA...` or similar)
  - `PAYPAL_CLIENT_SECRET` (should start with `EPM...` or similar)
  - `PAYPAL_MODE` (should be `sandbox` or `live`)

### 5. Check Request Format
The function expects:
```json
{
  "items": [
    {
      "id": "product-id",
      "name": "Product Name",
      "price": 10.99,
      "quantity": 1
    }
  ],
  "total": 10.99
}
```

## Quick Fixes

### If credentials are missing:
1. Add them to Netlify Environment Variables
2. Redeploy your site (or wait for auto-deploy)

### If function returns 500:
1. Check Netlify function logs
2. Look for specific error messages
3. Verify PayPal credentials are correct
4. Make sure `PAYPAL_MODE` matches your credentials (sandbox vs live)

### If PayPal popup closes immediately:
1. Check browser console for errors
2. Verify `VITE_PAYPAL_CLIENT_ID` is set in your `.env` file (for local dev)
3. Make sure the Client ID matches between frontend and backend

## Testing Checklist

- [ ] PayPal credentials added to Netlify
- [ ] `VITE_PAYPAL_CLIENT_ID` in `.env` file (local dev)
- [ ] Function logs show no errors
- [ ] Browser console shows no CORS errors
- [ ] Cart has items before checkout
- [ ] User is authenticated
- [ ] PayPal mode matches credentials (sandbox/live)

## Still Having Issues?

1. Check the exact error message in:
   - Browser console
   - Netlify function logs
   - Network tab (response body)

2. Verify your PayPal app is active in PayPal Developer Dashboard

3. Make sure you're using the correct environment (sandbox for testing, live for production)
