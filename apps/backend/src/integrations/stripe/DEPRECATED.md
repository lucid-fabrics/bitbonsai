# DEPRECATED: Backend Stripe Module

**Status:** Deprecated as of 2026-01-09
**Replacement:** License-API (`apps/license-api/src/stripe/`)

## Why Deprecated

This Stripe integration has been consolidated into the License-API to:
- Eliminate duplicate webhook processing (race conditions)
- Centralize payment logic in one service
- Support dynamic pricing from database
- Enable website checkout flow

## Migration Path

### For Desktop App (Frontend)

Frontend now calls License-API directly:
```typescript
// OLD: apps/frontend/src/app/features/settings/services/license.service.ts
private readonly stripeUrl = `${environment.apiUrl}/stripe`; // Backend

// NEW:
private readonly stripeUrl = `${environment.licenseApiUrl}/stripe`; // License-API
```

### For Existing Licenses

- No migration needed - existing licenses remain valid
- Backend still validates license keys (no breaking changes)
- Users continue to activate via license key from email

### Webhook Configuration

**Remove backend webhook:**
- Old: `https://backend.bitbonsai.io/stripe/webhook`

**Use license-api webhook:**
- New: `https://api.bitbonsai.io/webhooks/stripe`

Configure in Stripe Dashboard:
- `checkout.session.completed`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `charge.refunded`

## Files to Remove (Future Cleanup)

Once fully migrated:
- `stripe.controller.ts`
- `stripe.service.ts`
- `stripe.module.ts`

Remove from `apps/backend/src/app/app.module.ts`:
```typescript
// DELETE:
import { StripeModule } from '../integrations/stripe/stripe.module';
// ...
imports: [
  // ...
  StripeModule, // ← Remove this
]
```

Remove environment variables from backend:
```bash
# DELETE from .env:
STRIPE_SECRET_KEY
STRIPE_WEBHOOK_SECRET
STRIPE_PRICE_STARTER
STRIPE_PRICE_PRO
STRIPE_PRICE_ENTERPRISE
```

## Testing

Verify checkout still works:
1. Open desktop app → Settings → License
2. Click "Subscribe" on commercial tier
3. Should redirect to Stripe (via license-api)
4. Complete payment → License activates

## Rollback Plan

If issues arise:
1. Re-enable StripeModule in app.module.ts
2. Add Stripe env vars back to backend
3. Configure both webhook URLs in Stripe
4. Revert frontend to use backend `/stripe` endpoint
