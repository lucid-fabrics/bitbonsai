# License API

BitBonsai license management and payment processing API.

## Overview

The License API handles:
- **License key generation and validation** (Ed25519 cryptographic signatures)
- **Payment provider webhooks** (Stripe, Patreon, Ko-fi)
- **License tier management** (FREE, PATREON_*, COMMERCIAL_*)
- **Email notifications** (license delivery via Resend)

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

## Development

```bash
# Install dependencies
npm install

# Run migrations
npx prisma migrate dev

# Start dev server
npm run dev

# Run tests
npm test
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

## Support

For issues or questions:
- **GitHub Issues:** https://github.com/bitbonsai/bitbonsai/issues
- **Email:** support@bitbonsai.io
