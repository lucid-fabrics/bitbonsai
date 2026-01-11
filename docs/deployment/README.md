# Stripe Integration - Deployment Checklist

## ✅ Completed: Implementation

All code changes complete and builds successful:
- ✅ License-API checkout endpoint
- ✅ Website checkout flow
- ✅ Frontend license-api integration
- ✅ Refund webhook handler
- ✅ CORS configuration
- ✅ All builds pass

## 🧪 Step 1: Local Testing

### Start License-API

```bash
cd ~/git/bitbonsai
nx serve license-api
```

Verify:
- Server starts on port 3200
- Swagger docs: http://localhost:3200/docs
- Health endpoint: http://localhost:3200/api/health

### Run Automated Tests

```bash
./test-stripe-integration.sh
```

Should show:
- ✓ License-API running
- ✓ Pricing API working
- ✓ Checkout endpoint validates
- ✓ CORS configured

### Manual Website Test

```bash
# Terminal 1: License-API
nx serve license-api

# Terminal 2: Website
nx serve website
```

Test flow:
1. Visit http://localhost:4201/pricing
2. Click "Get Started" on paid tier
3. Should redirect to `/checkout?tier=...&priceId=...`
4. Enter test email
5. Should show "Continue to Payment" button

**Note:** Full Stripe redirect requires real Stripe keys in `.env.local`

### Manual Frontend Test

```bash
# Terminal 1: License-API
nx serve license-api

# Terminal 2: Frontend
nx serve frontend
```

Test flow:
1. Visit http://localhost:4200
2. Go to Settings → License tab
3. Verify commercial tiers load
4. Click "Subscribe" → Should open email dialog

## 🔧 Step 2: Environment Setup

### License-API Environment Variables

Create `apps/license-api/.env.local`:

```bash
# Database (required)
LICENSE_DATABASE_URL="postgresql://postgres:postgres@localhost:5432/bitbonsai_licenses"

# Stripe (required for checkout)
STRIPE_SECRET_KEY="sk_test_..."  # Get from Stripe dashboard
STRIPE_WEBHOOK_SECRET="whsec_..."  # Created when you add webhook

# Encryption (required)
ENCRYPTION_KEY="0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"  # 64 hex chars

# Email (optional for testing)
RESEND_API_KEY="re_..."  # Get from resend.com

# Port
LICENSE_API_PORT=3200
```

### Get Stripe Keys

1. Go to https://dashboard.stripe.com/test/apikeys
2. Copy "Secret key" (starts with `sk_test_`)
3. Add to `.env.local` as `STRIPE_SECRET_KEY`

### Setup Pricing Tiers (One-Time)

You need to create pricing tiers via admin API:

```bash
# Example: Create FREE tier
curl -X POST http://localhost:3200/api/admin/pricing \
  -H "Content-Type: application/json" \
  -H "x-api-key: YOUR_ADMIN_KEY" \
  -d '{
    "name": "FREE",
    "displayName": "Free",
    "maxNodes": 1,
    "maxConcurrentJobs": 2,
    "priceMonthly": 0,
    "isActive": true
  }'

# Example: Create SUPPORTER tier ($5/mo)
curl -X POST http://localhost:3200/api/admin/pricing \
  -H "Content-Type: application/json" \
  -H "x-api-key: YOUR_ADMIN_KEY" \
  -d '{
    "name": "SUPPORTER",
    "displayName": "Supporter",
    "maxNodes": 2,
    "maxConcurrentJobs": 3,
    "priceMonthly": 500,
    "isActive": true
  }'

# Then publish to Stripe (creates price IDs)
curl -X POST http://localhost:3200/api/admin/pricing/{tier_id}/publish \
  -H "x-api-key: YOUR_ADMIN_KEY"
```

## 🚀 Step 3: Unraid Deployment

### Deploy License-API

```bash
cd ~/git/bitbonsai

# Build for production
nx build license-api --configuration=production

# Deploy to Unraid (adjust paths)
./deploy-license-api-unraid.sh
```

**Note:** You may need to create this deploy script similar to `deploy-unraid.sh`

### Environment Variables on Unraid

SSH to Unraid and add to license-api container:

```bash
ssh root@unraid

# Edit docker-compose or container env
STRIPE_SECRET_KEY="sk_live_..."  # PRODUCTION key
STRIPE_WEBHOOK_SECRET="whsec_..."  # From production webhook
LICENSE_DATABASE_URL="postgresql://..."
ENCRYPTION_KEY="..."
```

### Configure Stripe Production Webhook

1. Go to https://dashboard.stripe.com/webhooks
2. Click "Add endpoint"
3. URL: `https://api.bitbonsai.io/webhooks/stripe`
4. Select events:
   - `checkout.session.completed`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `charge.refunded`
5. Copy webhook signing secret → Add to Unraid env as `STRIPE_WEBHOOK_SECRET`

### Test Production Webhook

```bash
# Install Stripe CLI locally
brew install stripe/stripe-cli/stripe

# Login
stripe login

# Forward to your production server
stripe listen --forward-to https://api.bitbonsai.io/webhooks/stripe

# Trigger test event
stripe trigger checkout.session.completed
```

## 📦 Step 4: Deploy Website & Frontend

### Website (Static Site)

```bash
cd ~/git/bitbonsai

# Build for production
nx build website --configuration=production

# Output: dist/apps/website/browser/

# Deploy to your hosting provider (Netlify/Vercel/S3)
# Example for Netlify:
npx netlify-cli deploy --prod --dir=dist/apps/website/browser
```

### Frontend (Desktop App)

```bash
# Build for production
nx build frontend --configuration=production

# Deploy to Unraid (or bundle as desktop app)
./deploy-unraid.sh
```

## 🔍 Step 5: Production Verification

### Test Website Checkout

1. Visit https://bitbonsai.io/pricing
2. Click "Get Started" on paid tier
3. Enter email on checkout page
4. Redirected to Stripe checkout
5. Complete payment with test card: `4242 4242 4242 4242`
6. Redirected to success page
7. Check email for license key

### Test Desktop App

1. Open https://app.bitbonsai.io
2. Settings → License tab
3. Click "Subscribe" on commercial tier
4. Enter email
5. Redirected to Stripe
6. Complete payment
7. License activates

### Monitor Webhooks

Check license-api logs:

```bash
ssh root@unraid
docker logs -f bitbonsai-license-api
```

Look for:
```
Stripe webhook: checkout.session.completed
Created license {id} for {email} via STRIPE
```

## ⚠️ Rollback Plan

If issues in production:

1. Re-enable backend Stripe webhook in Stripe dashboard
2. Revert frontend to use backend:
   ```typescript
   // apps/frontend/src/environments/environment.prod.ts
   licenseApiUrl: environment.apiUrl // Use backend instead
   ```
3. Rebuild and redeploy frontend
4. Remove license-api webhook from Stripe

## 📊 Post-Deployment Monitoring

Watch for 24-48 hours:
- ✅ No duplicate licenses created
- ✅ All webhooks processed successfully
- ✅ License emails sent
- ✅ Website checkout conversions
- ✅ Desktop app checkout still works

Check Stripe Dashboard:
- Payments → See successful charges
- Webhooks → Check delivery status
- Customers → Verify subscriptions created

## 🎉 Success Criteria

After 7 days:
- [ ] Website checkout working (>0 conversions)
- [ ] Desktop app checkout working
- [ ] No duplicate licenses
- [ ] No webhook errors
- [ ] All refunds processed correctly

**Then:** Remove backend Stripe module (see `DEPRECATED.md`)

## 🆘 Troubleshooting

### "Invalid price ID" error

Check pricing tiers have `stripePriceIdMonthly`:

```bash
curl http://localhost:3200/api/pricing | jq
```

If missing, publish tiers to Stripe:

```bash
curl -X POST http://localhost:3200/api/admin/pricing/{tier_id}/publish \
  -H "x-api-key: YOUR_ADMIN_KEY"
```

### CORS errors in browser

Check license-api CORS config includes your domain:

```typescript
// apps/license-api/src/main.ts
const allowedOrigins = [
  'https://bitbonsai.io',
  'https://www.bitbonsai.io',
  'https://app.bitbonsai.io',
];
```

### Webhook signature verification failed

Verify `STRIPE_WEBHOOK_SECRET` matches Stripe dashboard:
1. Go to Webhooks → Your endpoint
2. Click "Reveal" on signing secret
3. Must match env var exactly

### Database connection failed

Check `LICENSE_DATABASE_URL` is correct and database is running:

```bash
psql "$LICENSE_DATABASE_URL" -c "SELECT 1;"
```

Run migrations if needed:

```bash
cd apps/license-api
npx prisma migrate deploy
```

## 📝 Notes

- Keep backend Stripe module for 30 days (rollback safety)
- Monitor Stripe webhook delivery dashboard
- Test refund flow manually in Stripe dashboard
- Document any production issues for future reference
