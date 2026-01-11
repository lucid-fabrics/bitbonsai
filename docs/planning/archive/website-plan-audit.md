# Website + Admin Dashboard Plan - AUDIT REPORT

**Audited:** website-project-plan.md
**Date:** 2025-12-23

---

## 🚨 CRITICAL ISSUES

### 1. **DUPLICATE LICENSE SYSTEMS** ❌

**Problem:**
- Plan references `license-api` (separate PostgreSQL database)
- Backend already has Patreon integration (`apps/backend/src/integrations/patreon/`)
- Backend has `License` table in main Prisma schema
- **TWO SEPARATE LICENSE DATABASES** will cause conflicts

**Evidence:**
```
apps/license-api/prisma/schema.prisma  → LICENSE_DATABASE_URL (PostgreSQL)
prisma/schema.prisma                   → DATABASE_URL (PostgreSQL, has License table)
apps/backend/src/integrations/patreon/ → Uses main Prisma (apps/backend)
```

**Impact:**
- Patreon webhooks hit backend → creates license in main DB
- Admin dashboard uses license-api → reads from separate DB
- **DATA OUT OF SYNC** - users get licenses they can't use

**Fix Required:**
- **Option A**: Delete `license-api`, use backend API for admin
- **Option B**: Migrate Patreon integration to `license-api`, backend just verifies
- **Option C**: Unify databases (both use same PostgreSQL instance)

**Recommendation:** Option A (use backend API, delete license-api)

---

### 2. **API CLIENT SECURITY FLAW** 🔒

**Problem:**
```typescript
// From plan:
const apiClient = axios.create({
  headers: {
    'x-api-key': process.env.LICENSE_ADMIN_API_KEY, // Server-side only
  },
});
```

**Issue:**
- API key embedded in client-side bundle (Next.js public)
- Comment says "server-side only" but this runs client-side
- Exposed in `/_next/static/` build artifacts

**Fix Required:**
- Use Next.js API routes as proxy
- Never expose API key to browser
- Pattern:
  ```typescript
  // Client → Next.js API route → license-api (with API key)
  // NOT: Client → license-api directly
  ```

---

### 3. **MISSING CORS CONFIGURATION** 🌐

**Problem:**
- Plan assumes `license-api` accepts requests from website domain
- No CORS config mentioned in deployment section
- Admin dashboard will fail with CORS errors

**Fix Required:**
- Add to license-api (NestJS):
  ```typescript
  app.enableCors({
    origin: ['https://bitbonsai.io', 'http://localhost:3000'],
    credentials: true,
  });
  ```

---

### 4. **LICENSE KEY GENERATION MISMATCH** 🔑

**Problem:**
- `license-api` uses crypto-signed keys (from `CryptoService`)
- Backend Patreon service generates simple keys: `PREFIX-random`
- **Different key formats = verification fails**

**Evidence:**
```typescript
// license-api/src/crypto/crypto.service.ts
generateLicenseKey(payload: LicensePayload): string {
  // Uses JWT-style signed tokens
}

// apps/backend/src/integrations/patreon/patreon.service.ts:420
generateLicenseKey(tier: LicenseTier): string {
  const prefix = tier.substring(0, 3).toUpperCase();
  const random = Math.random().toString(36).substring(2, 12);
  return `${prefix}-${random}`; // NO SIGNATURE
}
```

**Impact:**
- Keys from Patreon webhooks won't verify in license-api
- Backend can't verify keys created by license-api

**Fix Required:**
- Unify key generation (use crypto-signed everywhere)
- OR: Migrate to license-api exclusively

---

### 5. **TIER LIMIT CONFLICTS** ⚠️

**Problem:**
Two different tier configurations:

**license-api (`apps/license-api/src/license/_services/license.service.ts:7`):**
```typescript
PATREON_SUPPORTER: { maxNodes: 2, maxConcurrentJobs: 3 }
```

**backend (`apps/backend/src/integrations/patreon/patreon.service.ts:344`):**
```typescript
PATREON_SUPPORTER: { maxNodes: 2, maxConcurrentJobs: 3, features: {...} }
```

**Also:**
- Backend has `features` object (multiNode, api, webhooks, etc.)
- license-api has no `features` field
- Schema mismatch will cause issues

**Fix Required:**
- Single source of truth for tier configs
- Shared library (`libs/shared-types`) with tier definitions
- Both APIs import from shared lib

---

## ⚠️ HIGH PRIORITY ISSUES

### 6. **MISSING LICENSE VERIFICATION FLOW** 🔍

**Problem:**
- Plan shows admin creating/revoking licenses
- No flow for **BitBonsai backend verifying licenses**
- Backend needs to call license-api on startup and periodically

**Missing:**
```typescript
// In backend startup/cron:
const verification = await licenseApiClient.post('/licenses/verify', {
  licenseKey: userLicenseKey
});

if (!verification.valid) {
  // Downgrade to FREE tier, disable nodes
}
```

**Fix Required:**
- Add license verification service in backend
- Call license-api `/licenses/verify` endpoint
- Cache results (5-min TTL)
- Re-verify on node add, job start

---

### 7. **NO PATREON OAUTH FLOW IN PLAN** 🔐

**Problem:**
- Backend has Patreon OAuth implementation (`getAuthorizationUrl`, `exchangeCodeForToken`)
- Plan doesn't show how users connect Patreon
- Missing UX flow: Settings → Connect Patreon → OAuth → Activate License

**Missing Component:**
- Frontend button: "Connect Patreon"
- Callback page: `/settings/patreon/callback`
- Success/error states

**Fix Required:**
- Add Settings page to marketing website (user-facing, not admin)
- Patreon connect button
- OAuth flow implementation
- Display activated license info

---

### 8. **STRIPE INTEGRATION INCOMPLETE** 💳

**Problem:**
- Plan mentions "Stripe - Coming Soon"
- `license-api` already has Stripe webhook controller
- Missing Stripe checkout flow in website

**Missing:**
- Stripe checkout button on pricing page
- Success/cancel redirect pages
- Customer portal (manage subscription)

**Fix Required:**
- Add Stripe Elements to pricing page
- Redirect to Stripe Checkout for commercial tiers
- Webhook already implemented (good)

---

### 9. **NO ACTIVATION TRACKING** 📊

**Problem:**
- `license-api` schema has `LicenseActivation` table
- Plan doesn't show activation flow
- Backend needs to "activate" license on first use

**Missing:**
```typescript
// When backend starts with license:
POST /licenses/:id/activate
{
  machineId: "server-uuid",
  machineName: "unraid-bitbonsai",
  ipAddress: "192.168.1.100"
}
```

**Fix Required:**
- Add activation endpoint to license-api
- Backend calls on startup
- Admin dashboard shows activations (already planned)
- Implement max activations per tier (not defined yet)

---

### 10. **PATREON TIER AMOUNTS WRONG** 💰

**Problem:**
- Backend maps cents to tiers: `300 → SUPPORTER` ($3)
- Plan says Supporter is $3/mo
- But Patreon amounts are in **cents**: 300 cents = $3.00 ✅
- **However:** Map uses 300, 500, 1000, 2000
- Should be: 300, 500, 1000, 2000 (correct)

**Actually Correct** - False alarm. Amounts match.

---

## 📋 MEDIUM PRIORITY ISSUES

### 11. **SHARED TYPES NOT IN PLAN CORRECTLY** 📦

**Problem:**
- Plan says create `libs/shared-types` with License interfaces
- Says "Import in license-api (replace Prisma types)"
- **Cannot replace Prisma types** - they're generated from schema

**Fix Required:**
- `shared-types` should contain:
  - DTO interfaces (create, update, response)
  - NOT database models (Prisma owns those)
- Both APIs use Prisma for DB
- Shared lib for API contracts only

---

### 12. **MISSING WEBHOOK RETRY LOGIC** 🔄

**Problem:**
- Plan shows "Retry Failed" button in admin
- `license-api` has no retry endpoint implemented
- WebhookEvent table tracks status but no retry mechanism

**Fix Required:**
- Add `POST /webhooks/:id/retry` endpoint
- Re-process webhook payload
- Update status to PROCESSED or FAILED

---

### 13. **NO RATE LIMITING** 🚦

**Problem:**
- Admin endpoints protected by API key only
- No rate limiting on license verification endpoint (public)
- Could be abused for DoS or brute force

**Fix Required:**
- Add rate limiting middleware (e.g., `@nestjs/throttler`)
- Public endpoints: 10 req/min per IP
- Admin endpoints: 100 req/min per API key

---

### 14. **MISSING EMAIL NOTIFICATIONS** 📧

**Problem:**
- `license-api` has `EmailService` and `EmailModule`
- Never used in plan
- Users should get emails when:
  - License activated
  - License upgraded
  - License expires soon (7 days)
  - License revoked

**Fix Required:**
- Add email triggers in webhook handlers
- Template for each email type
- SMTP config in env vars

---

### 15. **NO LICENSE EXPIRATION CRON** ⏰

**Problem:**
- Licenses have `expiresAt` field
- No cron job to mark expired licenses as EXPIRED
- Users keep access after expiration

**Fix Required:**
```typescript
@Cron('0 0 * * *') // Daily at midnight
async expireLicenses() {
  await this.prisma.license.updateMany({
    where: {
      expiresAt: { lt: new Date() },
      status: LicenseStatus.ACTIVE,
    },
    data: { status: LicenseStatus.EXPIRED },
  });
}
```

---

### 16. **ANALYTICS ENDPOINTS NOT PLANNED** 📊

**Problem:**
- Admin dashboard shows "Analytics" with metrics
- No endpoints defined for:
  - `GET /analytics/stats` (total licenses, revenue, etc.)
  - `GET /analytics/growth` (chart data)
  - `GET /analytics/churn` (cancellation rate)

**Fix Required:**
- Add analytics controller to license-api
- Aggregate queries on License/WebhookEvent tables
- Cache results (1-hour TTL)

---

## 🔧 TECHNICAL IMPROVEMENTS

### 17. **NEXT.JS API ROUTES PATTERN UNCLEAR** 🛣️

**Problem:**
- Plan shows admin dashboard calling license-api directly
- Better pattern: Use Next.js API routes as BFF (Backend for Frontend)

**Recommended Pattern:**
```
Browser → Next.js API Route (/api/admin/licenses)
         → license-api (/licenses) with API key
         → Response

NOT: Browser → license-api directly (CORS + security issues)
```

**Benefits:**
- API key stays server-side
- Session validation in Next.js
- Response transformation/caching
- Simpler CORS (same-origin)

---

### 18. **MISSING DOCKER COMPOSE FOR DEV** 🐳

**Problem:**
- Plan mentions Docker deployment
- No docker-compose.yml for local dev (website + license-api + postgres)

**Fix Required:**
```yaml
# docker-compose.dev.yml
services:
  postgres:
    image: postgres:15
    environment:
      POSTGRES_DB: bitbonsai_licenses

  license-api:
    build: ./apps/license-api
    depends_on: [postgres]

  website:
    build: ./apps/website
    environment:
      NEXT_PUBLIC_LICENSE_API_URL: http://license-api:3000
```

---

### 19. **NO MIGRATION STRATEGY** 🔄

**Problem:**
- Backend already has licenses in main DB
- license-api uses separate DB
- How to migrate existing licenses?

**Fix Required:**
- Write migration script:
  ```typescript
  // Reads from main DB (backend Prisma)
  // Writes to license-api DB
  // Matches Patreon IDs, emails
  ```

---

### 20. **FONTAWESOME IMPORT METHOD NOT SPECIFIED** 🎨

**Problem:**
- Plan says "Font Awesome (Free)"
- Doesn't specify import method:
  - CDN (simple, larger bundle)
  - NPM package (tree-shaking, smaller)
  - React icons (best for Next.js)

**Recommended:**
```bash
npm install @fortawesome/fontawesome-svg-core \
            @fortawesome/free-solid-svg-icons \
            @fortawesome/react-fontawesome
```

**Usage:**
```tsx
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faCheckCircle } from '@fortawesome/free-solid-svg-icons';

<FontAwesomeIcon icon={faCheckCircle} />
```

---

## 💡 MISSING FEATURES

### 21. **NO USER-FACING LICENSE DASHBOARD** 👤

**Problem:**
- Plan only has **admin** dashboard
- Regular users need to:
  - View their license status
  - See activated nodes
  - Connect/disconnect Patreon
  - Download license key

**Fix Required:**
- Add `/account` or `/license` page (public, requires login)
- Show license tier, expiration, nodes
- "Connect Patreon" button
- "Download License" button

---

### 22. **NO DOWNLOAD LINK FOR ACTUAL APP** ⬇️

**Problem:**
- Download page shows Docker/Unraid install instructions
- Doesn't link to:
  - Docker image registry (Docker Hub?)
  - GitHub releases
  - Unraid Community Apps template

**Fix Required:**
- Publish Docker image: `bitbonsai/bitbonsai:latest`
- Link to `docker.io/bitbonsai/bitbonsai`
- Link to GitHub releases for changelogs

---

### 23. **NO LICENSE KEY INPUT IN BACKEND** 🔑

**Problem:**
- Users get license from Patreon/Stripe
- Backend needs UI to **input license key**
- Currently no Settings → License page in backend frontend

**Fix Required:**
- Add to `apps/frontend/src/app/settings/license/`
- Input field: "Enter License Key"
- Verify button → calls backend API → backend calls license-api
- Shows tier, max nodes, expiration

---

### 24. **MISSING LOGO/BRANDING ASSETS** 🎨

**Problem:**
- Plan mentions "logos, icons" in `public/images/`
- No reference to actual logo design
- Need for:
  - Favicon (16x16, 32x32, 192x192)
  - Logo (SVG for header)
  - Open Graph image (1200x630)
  - App icons (PWA)

**Fix Required:**
- Design logo (or generate with AI)
- Export multiple sizes
- Add to website public folder

---

### 25. **NO CHANGELOG/RELEASE NOTES** 📝

**Problem:**
- Marketing website should show version history
- Users want to know what's new
- Plan mentions "Blog/changelog (MDX)" but only in Phase 6 (future)

**Fix Required:**
- Add `/changelog` page earlier (Phase 2)
- MDX files for each version
- Auto-fetch from GitHub releases?

---

## ✅ WHAT'S GOOD IN THE PLAN

1. **Next.js 14 + App Router** - Modern, SEO-friendly ✅
2. **shadcn/ui** - Great component library ✅
3. **Tailwind CSS** - Fast styling ✅
4. **FontAwesome** - Rich icons (as requested) ✅
5. **Phased approach** - Realistic timeline ✅
6. **Admin dashboard included** - Good UX for management ✅
7. **Webhook monitoring** - Excellent for debugging ✅
8. **Mobile responsive planned** - Essential ✅

---

## 🎯 RECOMMENDED FIXES (Priority Order)

### **CRITICAL (Fix Before Starting)**

1. **Resolve duplicate license systems** (backend vs license-api)
2. **Fix API client security** (no exposed API keys)
3. **Unify license key generation** (crypto-signed everywhere)
4. **Add CORS configuration** (license-api)
5. **Clarify tier config source of truth** (shared-types)

### **HIGH (Fix in Phase 1-2)**

6. Add license verification flow (backend → license-api)
7. Implement Patreon OAuth in website (user-facing)
8. Add Stripe checkout flow
9. Implement license activation tracking
10. Create user-facing license dashboard

### **MEDIUM (Fix in Phase 3-4)**

11. Add webhook retry endpoint
12. Implement rate limiting
13. Add email notifications
14. Create expiration cron job
15. Build analytics endpoints

### **LOW (Fix in Phase 5-6)**

16. Add docker-compose.dev.yml
17. Write license migration script
18. Design logo/branding
19. Add changelog page

---

## 📋 DECISION NEEDED

**Question:** Which license system to keep?

| Option | Pros | Cons |
|--------|------|------|
| **A: Keep backend integration** | Already working, Patreon OAuth implemented | No separation of concerns, harder to scale |
| **B: Migrate to license-api** | Clean separation, dedicated service | Need to rewrite Patreon integration, more complexity |
| **C: Hybrid (both use same DB)** | Keep both, share data | Still duplicate code, confusing |

**Recommendation:** **Option B** (migrate to license-api)
- Move Patreon integration to license-api
- Backend becomes pure consumer (verify licenses only)
- Admin dashboard has single source of truth
- Easier to add Stripe, Ko-fi, etc.

---

## 📊 AUDIT SUMMARY

| Severity | Count | Examples |
|----------|-------|----------|
| **Critical** | 5 | Duplicate DBs, API key exposure, key generation mismatch |
| **High** | 5 | Missing verification flow, OAuth UX, activations |
| **Medium** | 6 | Shared types, webhooks retry, rate limiting, emails |
| **Low** | 9 | Docker compose, migration, FontAwesome import, logo |

**Total Issues Found:** 25

**Blocking Issues:** 5 (must fix before Phase 1)

---

**Next Step:** Review audit, decide on license system architecture, update plan accordingly.
