# BitBonsai License API

> **License management, pricing, and subscription backend for BitBonsai**

NestJS backend providing licensing, pricing data, and subscription management via Stripe/Patreon/Ko-fi integration.

---

## Overview

| Property | Value |
|----------|-------|
| **Type** | NestJS REST API |
| **Framework** | NestJS 11 |
| **Database** | PostgreSQL 15+ |
| **Domain** | api.bitbonsai.io |
| **Port** | 3200 (dev/prod) |

The License API handles:
- **License key generation and validation** (Ed25519 cryptographic signatures)
- **Payment provider webhooks** (Stripe, Patreon, Ko-fi)
- **License tier management** (FREE, PATREON_*, COMMERCIAL_*)
- **Pricing API** (public endpoint for website integration)
- **Email notifications** (license delivery via Resend)

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                  License API                        │
│                                                     │
│  ┌──────────────┐    ┌──────────────┐            │
│  │  Ko-fi       │    │  Patreon     │            │
│  │  Webhook     │    │  Webhook     │            │
│  └──────────────┘    └──────────────┘            │
│         │                    │                     │
│         ▼                    ▼                     │
│  ┌────────────────────────────────┐               │
│  │     Webhook Service            │               │
│  │  (Deduplication + Processing)  │               │
│  └────────────────────────────────┘               │
│                   │                                 │
│                   ▼                                 │
│  ┌────────────────────────────────┐               │
│  │     License Service            │               │
│  │  (CRUD + Tier Logic)           │               │
│  └────────────────────────────────┘               │
│                   │                                 │
│                   ▼                                 │
│  ┌────────────────────────────────┐               │
│  │     Crypto Service             │               │
│  │  (Ed25519 Key Generation)      │               │
│  └────────────────────────────────┘               │
└─────────────────────────────────────────────────────┘
```

---

## API Endpoints

### Public Endpoints

#### GET /api/pricing

**Description:** Fetch active pricing tiers (public, no auth)

**Rate Limit:** 100 requests/60s per IP

**Response:**
```typescript
PricingTier[] = [
  {
    id: "cm3abc123",
    name: "FREE",
    displayName: "Free",
    description: "Perfect for hobbyists",
    maxNodes: 1,
    maxConcurrentJobs: 2,
    priceMonthly: 0,
    priceYearly: null,
    stripePriceIdMonthly: null,
    stripePriceIdYearly: null,
    patreonTierId: null,
    isActive: true
  }
  // ... more tiers
]
```

**CORS:** Enabled for `bitbonsai.io`, `app.bitbonsai.io`

**Usage:**
```bash
curl https://api.bitbonsai.io/api/pricing
```

### Admin Endpoints (Protected)

**Authentication:** API Key in `X-API-KEY` header

#### POST /api/admin/licenses

**Description:** Generate new license

**Headers:**
```
X-API-KEY: your-admin-api-key
Content-Type: application/json
```

**Request:**
```json
{
  "email": "user@example.com",
  "tierId": "cm3def456",
  "expiresAt": "2026-12-31T23:59:59Z"  // optional
}
```

**Response:**
```json
{
  "id": "cm4xyz789",
  "licenseKey": "BITBONSAI-PAT-...",
  "email": "user@example.com",
  "tier": {
    "name": "PATREON_PRO",
    "displayName": "Patreon Pro"
  },
  "status": "ACTIVE"
}
```

---

## Ed25519 Keypair Management

### ⚠️ CRITICAL: Keypair Backup

The License API uses **Ed25519 cryptographic signatures** to generate and validate license keys. If the keypair is lost, **all existing licenses become invalid**.

#### Keypair Location

Keys are stored in: `./keys/` (relative to app root)

```
./keys/
├── private.pem  (🔒 NEVER COMMIT)
├── public.pem   (✅ Safe to share)
```

#### Automatic Keypair Generation

On first startup, the API automatically generates a new Ed25519 keypair if none exists:

```typescript
// apps/license-api/src/crypto/crypto.service.ts:33-60
async loadOrGenerateKeys() {
  if (!fs.existsSync(privateKeyPath)) {
    this.logger.log('Generating new Ed25519 keypair');
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
    // Saves to ./keys/private.pem and ./keys/public.pem
  }
}
```

### Backup Procedures

#### Development

1. **Backup keys directory:**
   ```bash
   cp -r ./keys ./keys.backup
   ```

2. **Store in secure location** (NOT in git):
   ```bash
   # DO NOT run this:
   git add ./keys  # ❌ NEVER DO THIS

   # Instead, copy to secure backup:
   cp -r ./keys ~/secure-backups/bitbonsai-license-keys-$(date +%F)
   ```

#### Production

**CRITICAL:** Use a secret management service:

| Platform | Recommended Service |
|----------|---------------------|
| **AWS** | AWS Secrets Manager + S3 (versioned bucket) |
| **Azure** | Azure Key Vault |
| **Google Cloud** | Google Secret Manager |
| **Self-Hosted** | HashiCorp Vault |

**Production Backup Script:**

```bash
#!/bin/bash
# backup-license-keys.sh

DATE=$(date +%Y-%m-%d-%H%M%S)
BACKUP_DIR="/secure/backups/license-keys"
KEYS_DIR="./keys"

# Create backup directory
mkdir -p "$BACKUP_DIR"

# Backup keys with timestamp
tar -czf "$BACKUP_DIR/license-keys-$DATE.tar.gz" -C "$KEYS_DIR" .

# Upload to S3 (example)
aws s3 cp "$BACKUP_DIR/license-keys-$DATE.tar.gz" \
  s3://bitbonsai-secrets/license-keys/ \
  --server-side-encryption AES256

echo "✅ Keys backed up to: $BACKUP_DIR/license-keys-$DATE.tar.gz"
```

**Add to cron (daily backup):**
```cron
0 3 * * * /path/to/backup-license-keys.sh
```

### Key Rotation

If keys are compromised, you **CANNOT** rotate them without invalidating all existing licenses.

**Instead:**
1. Generate NEW keypair
2. Store OLD keypair for validation (read-only)
3. Use NEW keypair for new licenses
4. Implement dual-key validation logic

### Health Check

The License API provides a health check endpoint that verifies keypair existence:

```bash
curl http://localhost:3000/health
```

Response:
```json
{
  "status": "ok",
  "crypto": {
    "keysLoaded": true,
    "algorithm": "ed25519"
  }
}
```

### Recovery Procedure

If keys are lost:

1. **Stop the API immediately**
2. **Restore from backup:**
   ```bash
   # Extract backup
   tar -xzf license-keys-YYYY-MM-DD.tar.gz -C ./keys

   # Verify permissions
   chmod 600 ./keys/private.pem
   chmod 644 ./keys/public.pem
   ```
3. **Restart API**
4. **Verify health check**

If no backup exists:
- **All licenses must be re-issued** (regenerate from database)
- **Users must re-activate** with new keys
- ⚠️ This is a catastrophic failure - avoid at all costs

## Environment Variables

Required variables (see `.env.example`):

```bash
# Database
LICENSE_DATABASE_URL=postgresql://user:pass@localhost:5432/license_api

# Encryption
ENCRYPTION_KEY=<openssl rand -hex 32>
ADMIN_API_KEY=<openssl rand -hex 32>

# Payment Providers
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
PATREON_CLIENT_ID=...
PATREON_CLIENT_SECRET=...
PATREON_WEBHOOK_SECRET=...
KOFI_VERIFICATION_TOKEN=...

# Email
RESEND_API_KEY=re_...
```

---

## Development Setup

### Prerequisites

- PostgreSQL 15+ running on `localhost:5432`
- Node.js 20.x LTS
- Stripe/Patreon/Ko-fi accounts (test mode keys)

### Database Setup

```bash
# 1. Start PostgreSQL (if not running)
docker run -d \
  --name bitbonsai-postgres \
  -p 5432:5432 \
  -e POSTGRES_DB=bitbonsai_licenses \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=postgres \
  postgres:15

# 2. Generate Prisma Client
cd apps/license-api
npx prisma generate

# 3. Run migrations
npx prisma migrate dev

# 4. (Optional) Seed pricing data
npx prisma db seed
```

### Development Environment

Create `apps/license-api/.env.local`:

```bash
# Database
LICENSE_DATABASE_URL="postgresql://postgres:postgres@localhost:5432/bitbonsai_licenses"

# Encryption (32 bytes hex = 64 characters)
ENCRYPTION_KEY="$(openssl rand -hex 32)"

# Admin API Key
ADMIN_API_KEY="$(openssl rand -base64 32)"

# Stripe (test mode)
STRIPE_SECRET_KEY="sk_test_51A2B3C..."
STRIPE_WEBHOOK_SECRET="whsec_abc123..."
STRIPE_PRODUCT_ID="prod_test123"

# Patreon (test mode)
PATREON_CLIENT_ID="test_client_id"
PATREON_CLIENT_SECRET="test_client_secret"
PATREON_WEBHOOK_SECRET="test_webhook_secret"

# Ko-fi
KOFI_VERIFICATION_TOKEN="test_token"

# Email (Resend API)
RESEND_API_KEY="re_dummy_for_dev"

# Server
LICENSE_API_PORT=3200
NODE_ENV=development
```

**Generate secrets:**
```bash
# Encryption key (64 hex chars)
openssl rand -hex 32

# API key (base64)
openssl rand -base64 32
```

### Start Dev Server

```bash
# Serve license-api (port 3200)
nx serve license-api

# Watch mode with live reload
nx serve license-api --watch
```

**Access:** http://localhost:3200/api/pricing

### Testing

```bash
# Unit tests
nx test license-api

# Watch mode
nx test license-api --watch

# Coverage
nx test license-api --coverage

# E2E tests (requires PostgreSQL)
nx e2e license-api-e2e
```

## Deployment

```bash
# Build
npm run build

# Run migrations (production)
npx prisma migrate deploy

# Start
node dist/main.js
```

### Docker Deployment

```bash
docker-compose -f docker-compose.license.yml up -d
```

**IMPORTANT:** Mount `./keys` as a volume to persist keypair:

```yaml
volumes:
  - ./keys:/app/keys:ro  # Read-only in production
```

## Security

- ✅ Webhook signature verification (timing-safe comparison)
- ✅ Webhook event deduplication (idempotency)
- ✅ Rate limiting (30 req/min on webhooks)
- ✅ Security audit logging
- ✅ Ed25519 signatures (quantum-resistant)

## License Key Format

```
BITBONSAI-{TIER}-{PAYLOAD}.{SIGNATURE}
```

Example:
```
BITBONSAI-PAT-eyJlbWFpbCI6InRlc3RAZXhhbXBsZS5jb20iLCJ0aWVyIjoiUEFUUkVPTl9QUk8iLCJtYXhOb2RlcyI6NSwibWF4Q29uY3VycmVudEpvYnMiOjEwLCJleHBpcmVzQXQiOm51bGwsImlzc3VlZEF0IjoiMjAyNS0xMi0yNVQxMjowMDowMFoifQ.abc123def456...
```

Payload (decoded):
```json
{
  "email": "test@example.com",
  "tier": "PATREON_PRO",
  "maxNodes": 5,
  "maxConcurrentJobs": 10,
  "expiresAt": null,
  "issuedAt": "2025-12-25T12:00:00Z"
}
```

---

## Troubleshooting

### Database Connection Errors

**Symptom:** `Can't reach database server`

**Fix:**
```bash
# Check PostgreSQL is running
docker ps | grep postgres

# Test connection
psql -h localhost -U postgres -d bitbonsai_licenses

# Verify DATABASE_URL in .env.local
cat apps/license-api/.env.local | grep DATABASE_URL
```

### Encryption Key Errors

**Symptom:** `ENCRYPTION_KEY must be 64 hex characters`

**Fix:**
```bash
# Generate valid key
openssl rand -hex 32

# Update .env.local
echo "ENCRYPTION_KEY=$(openssl rand -hex 32)" >> apps/license-api/.env.local
```

### Build Errors (Missing Prisma Client)

**Symptom:** `Cannot find module '@prisma/client'`

**Fix:**
```bash
cd apps/license-api
npx prisma generate
nx build license-api
```

### Webhook Signature Verification Failed

**Symptom:** `Webhook signature verification failed`

**Fix:**
1. Check webhook secret matches provider dashboard
2. Test locally with provider CLI:
   ```bash
   # Stripe
   stripe listen --forward-to localhost:3200/api/stripe/webhook
   ```
3. Use signing secret from CLI output

---

## Related Documentation

- [Website Integration](../website/README.md)
- [Main Backend](../backend/README.md)
- [Main Project README](../../README.md)
- [CLAUDE.md - License API Section](../../CLAUDE.md#license-api)

---

## Support

For issues or questions:
- **GitHub Issues:** https://github.com/lucidfabrics/bitbonsai/issues
- **Email:** support@bitbonsai.io

---

<div align="center">

**License & subscription management for BitBonsai**

[API Health](https://api.bitbonsai.io/health) • [Docs Home](../../docs/README.md) • [Main README](../../README.md)

</div>
