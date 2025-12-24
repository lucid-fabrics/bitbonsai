# Patreon Integration Setup

## Overview

BitBonsai now supports Patreon OAuth integration to automatically unlock node and concurrent job limits based on supporter tiers.

| Tier | Price | Nodes | Concurrent Jobs |
|------|-------|-------|-----------------|
| Free | $0 | 1 | 2 |
| Supporter | $3/mo | 2 | 3 |
| Plus | $5/mo | 3 | 5 |
| Pro | $10/mo | 5 | 10 |
| Ultimate | $20/mo | 10 | 20 |

## Setup Steps

### 1. Create Patreon OAuth App

1. Go to https://www.patreon.com/portal/registration/register-clients
2. Click "Create Client"
3. Fill in:
   - **App Name**: BitBonsai
   - **Description**: Automated video transcoding platform
   - **App Category**: Software / Technology
   - **Author Name**: Your name
   - **Privacy Policy URL**: https://github.com/lucid-fabrics/bitbonsai/blob/main/PRIVACY.md
   - **Terms of Service URL**: https://github.com/lucid-fabrics/bitbonsai/blob/main/TERMS.md
   - **Redirect URIs**:
     - Production: `https://your-domain.com/api/v1/patreon/callback`
     - Local dev: `http://localhost:3100/api/v1/patreon/callback`
4. Click "Create Client"
5. Note your **Client ID** and **Client Secret**

### 2. Create Patreon Webhook

1. In your OAuth client settings, scroll to "Webhooks"
2. Click "Add webhook"
3. Set webhook URL:
   - Production: `https://your-domain.com/api/v1/patreon/webhook`
   - Local dev: Use ngrok: `https://your-ngrok-id.ngrok.io/api/v1/patreon/webhook`
4. Select events:
   - `members:pledge:create`
   - `members:pledge:update`
   - `members:pledge:delete`
5. Note your **Webhook Secret**

### 3. Get Campaign ID

1. Go to https://www.patreon.com/portal/settings/creators
2. Your Campaign ID is in the URL: `https://www.patreon.com/portal/registration/register-clients?campaignId=YOUR_CAMPAIGN_ID`
3. Or use API: `curl -H "Authorization: Bearer YOUR_ACCESS_TOKEN" https://www.patreon.com/api/oauth2/v2/campaigns`

### 4. Configure BitBonsai

Add to `.env`:

```bash
# Patreon OAuth Integration
PATREON_CLIENT_ID=your_client_id_here
PATREON_CLIENT_SECRET=your_client_secret_here
PATREON_REDIRECT_URI=http://localhost:3100/api/v1/patreon/callback
PATREON_WEBHOOK_SECRET=your_webhook_secret_here
PATREON_CAMPAIGN_ID=your_campaign_id_here
```

**Production (Unraid):**
```bash
PATREON_CLIENT_ID=your_client_id_here
PATREON_CLIENT_SECRET=your_client_secret_here
PATREON_REDIRECT_URI=https://bitbonsai.yourdomain.com/api/v1/patreon/callback
PATREON_WEBHOOK_SECRET=your_webhook_secret_here
PATREON_CAMPAIGN_ID=your_campaign_id_here
```

### 5. Apply Database Migration

**Development:**
```bash
npx prisma migrate dev
```

**Production (Unraid):**
```bash
ssh root@unraid 'docker exec bitbonsai-backend npx prisma migrate deploy'
```

Or run deploy script (auto-applies migrations):
```bash
./deploy-unraid.sh
```

### 6. Restart Backend

**Development:**
```bash
nx serve backend
```

**Production:**
```bash
ssh root@unraid 'docker restart bitbonsai-backend'
```

## User Flow

1. User goes to Settings → License tab
2. Clicks "Connect Patreon" button
3. Redirects to Patreon OAuth authorization page
4. User authorizes BitBonsai
5. Patreon redirects back with authorization code
6. Backend exchanges code for access token
7. Backend fetches user's membership tier
8. Backend creates/updates License record with tier
9. License guard service enforces new limits
10. User sees updated node/job limits in UI

## Webhook Events

### `members:pledge:create`
New pledge created → Activate license

### `members:pledge:update`
Tier upgraded/downgraded → Update license

### `members:pledge:delete`
Pledge cancelled → Downgrade to FREE tier

## Security

- OAuth tokens are **NOT** encrypted in database (TODO: Add encryption)
- Webhook signatures verified using HMAC-MD5
- Rate limiting: 1000 req/min per IP
- JWT authentication required for all endpoints

## Tier ID Mapping

**IMPORTANT:** Replace placeholder tier IDs in `patreon.service.ts`:

```typescript
private readonly tierMapping = new Map<string, LicenseTier>([
  ['YOUR_SUPPORTER_TIER_ID', LicenseTier.PATREON_SUPPORTER],
  ['YOUR_PLUS_TIER_ID', LicenseTier.PATREON_PLUS],
  ['YOUR_PRO_TIER_ID', LicenseTier.PATREON_PRO],
  ['YOUR_ULTIMATE_TIER_ID', LicenseTier.PATREON_ULTIMATE],
]);
```

Get tier IDs from Patreon API:
```bash
curl -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  "https://www.patreon.com/api/oauth2/v2/campaigns/YOUR_CAMPAIGN_ID/tiers"
```

## Testing

### Test OAuth Flow (Local)

1. Start backend: `nx serve backend`
2. Start frontend: `nx serve frontend`
3. Open http://localhost:4200/settings?tab=license
4. Click "Connect Patreon"
5. Authorize on Patreon
6. Should redirect back with success message

### Test Webhook (Local with ngrok)

1. Install ngrok: `brew install ngrok`
2. Start tunnel: `ngrok http 3100`
3. Update webhook URL in Patreon settings to ngrok URL
4. Trigger event (create/update/delete pledge)
5. Check backend logs for webhook processing

## Troubleshooting

### "Patreon integration is not configured"
- Check `.env` has all required variables
- Restart backend

### "Failed to authenticate with Patreon"
- Verify Client ID/Secret are correct
- Check redirect URI matches exactly

### "No Patreon membership found"
- User is not a patron
- User cancelled pledge
- User's payment declined

### Webhook not firing
- Verify webhook URL is publicly accessible
- Check webhook secret matches
- Review Patreon webhook logs in dashboard

## Frontend Components

**UI Location:** Settings → License tab

**Components:**
- `license-tab.component.ts` - Main license UI with "Connect Patreon" button
- `license.service.ts` - API client for Patreon endpoints
- `license-guard.service.ts` - Enforces tier limits

**API Endpoints:**
- `GET /api/v1/patreon/auth` - Start OAuth flow
- `GET /api/v1/patreon/callback` - OAuth callback
- `POST /api/v1/patreon/webhook` - Webhook handler
- `GET /api/v1/patreon/status` - Check Patreon connection

## Database Schema

**User model additions:**
```prisma
patreonId           String?   @unique
patreonAccessToken  String?   // TODO: Encrypt
patreonRefreshToken String?   // TODO: Encrypt
patreonTokenExpiry  DateTime?
patreonEmail        String?
patreonFullName     String?
patreonTier         LicenseTier?
patreonLastSync     DateTime?
```

**Migration:** `prisma/migrations/20251223000000_add_patreon_user_fields/migration.sql`

## Next Steps

1. Create Patreon page: https://www.patreon.com/lucidfabrics
2. Set up tiers ($3, $5, $10, $20)
3. Get tier IDs and update `tierMapping` in `patreon.service.ts`
4. Add OAuth app credentials to `.env`
5. Set up webhook endpoint
6. Test OAuth flow end-to-end
7. Deploy to production

## Production Checklist

- [ ] Patreon OAuth app created
- [ ] Tiers configured on Patreon
- [ ] Tier IDs mapped in code
- [ ] Webhook configured
- [ ] `.env` variables set
- [ ] Database migration applied
- [ ] OAuth flow tested
- [ ] Webhook tested
- [ ] Token encryption implemented (optional)
- [ ] SSL/HTTPS enabled
- [ ] Redirect URIs use HTTPS
- [ ] Webhook URL uses HTTPS

## References

- [Patreon OAuth Documentation](https://docs.patreon.com/#oauth)
- [Patreon API v2](https://docs.patreon.com/#apiv2-oauth)
- [Patreon Webhook Events](https://docs.patreon.com/#webhooks)
