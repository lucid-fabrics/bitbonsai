# Webhook Testing Guide

## Overview

BitBonsai supports Ko-fi and Patreon webhooks for automated license activation. This guide covers testing both integrations.

## Prerequisites

### Environment Variables Required

#### Patreon Integration
```bash
PATREON_CLIENT_ID=your_patreon_client_id
PATREON_CLIENT_SECRET=your_patreon_client_secret
PATREON_WEBHOOK_SECRET=your_patreon_webhook_secret
PATREON_REDIRECT_URI=http://192.168.1.100:3100/api/v1/patreon/callback
```

#### Ko-fi Integration
```bash
KOFI_VERIFICATION_TOKEN=your_kofi_verification_token
```

**Note:** These environment variables must be set in the backend container's environment configuration.

## Testing Patreon Integration

### 1. Check Integration Status

```bash
curl http://192.168.1.100:3100/api/v1/patreon/status
```

**Expected Response:**
```json
{
  "configured": true,
  "connected": false,
  "authUrl": "https://www.patreon.com/oauth2/authorize?..."
}
```

### 2. Test OAuth Flow (Manual)

1. Navigate to: `http://192.168.1.100:3100/api/v1/patreon/auth`
2. You'll be redirected to Patreon login
3. Authorize BitBonsai
4. You'll be redirected back with success/error query params

### 3. Test Webhook (Requires Secret)

**Important:** Webhook testing requires `PATREON_WEBHOOK_SECRET` to be configured. Patreon webhooks use MD5 HMAC signature verification.

```bash
# Generate signature
PAYLOAD='{"data":{"id":"member_123","attributes":{"email":"test@example.com","patron_status":"active_patron","currently_entitled_amount_cents":1500}}}'
SECRET="your_patreon_webhook_secret"
SIGNATURE=$(echo -n "$PAYLOAD" | openssl dgst -md5 -hmac "$SECRET" | awk '{print $2}')

# Send webhook
curl -X POST http://192.168.1.100:3100/api/v1/patreon/webhook \
  -H "Content-Type: application/json" \
  -H "x-patreon-signature: $SIGNATURE" \
  -H "x-patreon-event: members:pledge:create" \
  -d "$PAYLOAD"
```

**Expected Response:**
```json
{
  "success": true
}
```

### 4. Webhook Events Supported

| Event | Description | Action |
|-------|-------------|--------|
| `members:pledge:create` | New patron pledge | Creates license |
| `members:pledge:update` | Patron tier change | Updates license tier |
| `members:pledge:delete` | Patron cancellation | Revokes license |

### 5. Tier Mapping

| Pledge Amount | License Tier |
|--------------|--------------|
| $5/month | PATREON_SUPPORTER |
| $10/month | PATREON_PLUS |
| $15/month | PATREON_PRO |
| $25/month | PATREON_ULTIMATE |

## Testing Ko-fi Integration

### 1. Test Webhook (Requires Verification Token)

**Important:** Ko-fi webhooks require `KOFI_VERIFICATION_TOKEN` to be configured.

```bash
# Send Ko-fi webhook
curl -X POST http://192.168.1.100:3100/api/v1/webhook/kofi \
  -H "Content-Type: application/json" \
  -d '{
    "verification_token": "your_kofi_verification_token",
    "type": "Donation",
    "from_name": "Test User",
    "email": "test@example.com",
    "amount": "10.00",
    "currency": "USD",
    "message": "Thanks for BitBonsai!",
    "timestamp": "2025-12-25T12:00:00Z",
    "transaction_id": "txn_123456"
  }'
```

**Expected Response:**
```json
{
  "received": true
}
```

**Note:** Ko-fi donations currently create FREE tier licenses (donations are one-time, not subscriptions).

## Production Webhook URLs

Configure these URLs in your Patreon/Ko-fi dashboards:

- **Patreon:** `https://yourdomain.com/api/v1/patreon/webhook`
- **Ko-fi:** `https://yourdomain.com/api/v1/webhook/kofi`

## Monitoring Webhooks

### Check Backend Logs

```bash
# Watch webhook logs
ssh root@unraid 'docker logs -f bitbonsai-backend | grep -iE "(webhook|patreon|kofi)"'
```

### Verify Database Records

Webhook events are logged in the `webhookEvent` table (license-api database) for idempotency and debugging.

## Troubleshooting

### Patreon OAuth "not configured"

**Cause:** Missing `PATREON_CLIENT_ID` or `PATREON_CLIENT_SECRET`

**Fix:** Add environment variables to `docker-compose.unraid.yml` and restart backend

### Webhook "Invalid signature"

**Cause:** Incorrect secret or payload corruption

**Fix:** Verify `PATREON_WEBHOOK_SECRET` or `KOFI_VERIFICATION_TOKEN` matches your provider dashboard

### Webhook processed but no license created

**Cause:** Tier mapping issue or database error

**Fix:** Check backend logs for specific error messages

## Security Notes

1. **Always use HTTPS in production** - Webhook signatures prevent tampering but not eavesdropping
2. **Rotate secrets periodically** - Update webhook secrets every 90 days
3. **Monitor failed webhooks** - Set up alerts for repeated webhook failures
4. **Idempotency is automatic** - Duplicate webhooks are safely ignored via `provider_providerEventId` uniqueness

## Automated Tests

Comprehensive test suites exist for both integrations:

- `apps/license-api/src/webhook/__tests__/patreon.controller.spec.ts` (15 tests)
- `apps/license-api/src/webhook/__tests__/kofi.controller.spec.ts` (10 tests)

Run tests:
```bash
nx test license-api
```
