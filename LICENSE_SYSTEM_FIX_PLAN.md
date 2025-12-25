# License System Fix Plan

**Goal:** Bring Ko-fi, Patreon, and License system to 100% working condition

**Date:** 2025-12-25
**Status:** In Progress

---

## Phase 1: Critical Fixes (Do First) ⚠️

### 1.1 Fix Patreon Tier Mapping Conflict 🔴 CRITICAL
**Problem:** Two different tier mappings exist - backend uses cents (300, 500, 1000, 2000), license-API uses tier names + different fallback amounts

**Files:**
- `apps/backend/src/integrations/patreon/patreon.service.ts:11-16`
- `apps/license-api/src/webhook/patreon.controller.ts:48-53, 171-177`

**Solution:**
- Create shared configuration: `libs/shared-models/src/lib/config/patreon-tiers.config.ts`
- Use consistent cent amounts: 500 (Supporter), 1000 (Plus), 1500 (Pro), 2500 (Ultimate)
- Update both implementations to use shared config

**Estimated Time:** 30 minutes

---

### 1.2 Add Environment Variable Validation 🔴 CRITICAL
**Problem:** `KOFI_VERIFICATION_TOKEN` not validated at startup - app starts without Ko-fi configured

**Files:**
- `apps/license-api/src/config/env.validation.ts`
- `docker-compose.license.yml`

**Solution:**
```typescript
@IsOptional()
@IsString()
KOFI_VERIFICATION_TOKEN?: string;

@IsOptional()
@IsUrl()
PATREON_REDIRECT_URI?: string;
```

**Estimated Time:** 10 minutes

---

### 1.3 Use Patreon's Webhook Event ID 🔴 CRITICAL
**Problem:** Using `randomUUID()` instead of Patreon's event ID prevents idempotency

**Files:**
- `apps/license-api/src/webhook/patreon.controller.ts:91, 107, 117`

**Solution:**
- Extract event ID from webhook headers or payload
- Use for `providerEventId` in webhook events

**Estimated Time:** 15 minutes

---

### 1.4 Add Webhook Event Deduplication 🔴 CRITICAL
**Problem:** Replayed webhooks create duplicate donations/licenses

**Files:**
- `apps/license-api/src/webhook/kofi.controller.ts`
- `apps/license-api/src/webhook/patreon.controller.ts`
- `apps/license-api/src/webhook/_services/webhook.service.ts`

**Solution:**
- Check if `webhookEvent` with same `provider + providerEventId` exists
- Return 200 OK immediately if already processed
- Add unique constraint migration

**Estimated Time:** 45 minutes

---

### 1.5 Fix Frontend API URL Hardcoding 🔴 CRITICAL
**Problem:** `connectPatreon()` uses hardcoded `/patreon/auth` - won't work in production

**Files:**
- `apps/frontend/src/app/features/settings/tabs/license-tab.component.ts:1080`

**Solution:**
```typescript
window.location.href = `${environment.apiUrl}/patreon/auth?return_url=${returnUrl}`;
```

**Estimated Time:** 5 minutes

---

## Phase 2: High Priority Fixes 🟡

### 2.1 Implement Patreon Token Refresh
**Problem:** Tokens expire after 30 days, OAuth breaks

**Files:**
- `apps/backend/src/integrations/patreon/patreon.service.ts`

**Solution:**
- Add `refreshAccessToken()` method
- Add cron job to check `patreonTokenExpiry` and refresh proactively
- Store new tokens in database

**Estimated Time:** 1 hour

---

### 2.2 Add Unique Constraint on Webhook Events
**Problem:** Database doesn't prevent duplicate webhook event records

**Files:**
- `apps/license-api/prisma/migrations/YYYYMMDD_unique_webhook_events.sql`
- `apps/license-api/prisma/schema.prisma` (already has `@@unique([provider, providerEventId])` ✅)

**Solution:**
- Verify constraint exists in schema
- No changes needed (already correct)

**Estimated Time:** 5 minutes (verification only)

---

### 2.3 Document Ed25519 Keypair Backup
**Problem:** Lost keys = all licenses invalid, no backup strategy

**Files:**
- `apps/license-api/README.md` (new section)
- `apps/license-api/src/crypto/crypto.service.ts` (add health check)

**Solution:**
- Document backup procedure
- Add health check endpoint that verifies key existence
- Warn on startup if keys missing

**Estimated Time:** 30 minutes

---

### 2.4 Write Tests for Ko-fi & Patreon Controllers
**Problem:** Zero test coverage for critical webhook endpoints

**Files:**
- `apps/license-api/src/webhook/__tests__/kofi.controller.spec.ts` (new)
- `apps/license-api/src/webhook/__tests__/patreon.controller.spec.ts` (new)

**Solution:**
- Test signature validation (valid, invalid, missing)
- Test tier mapping logic
- Test error cases (DB failures, email failures)
- Test deduplication

**Estimated Time:** 2 hours

---

### 2.5 Add Rate Limiting to Backend Patreon Endpoints
**Problem:** No throttling on OAuth endpoints - vulnerable to abuse

**Files:**
- `apps/backend/src/integrations/patreon/patreon.controller.ts`

**Solution:**
```typescript
@UseGuards(ThrottlerGuard)
@Throttle({ default: { limit: 10, ttl: 60000 } })
```

**Estimated Time:** 10 minutes

---

## Phase 3: Medium Priority Improvements 🟢

### 3.1 Validate Ko-fi Webhook Email Addresses
**Files:**
- `apps/license-api/src/webhook/kofi.controller.ts`

**Solution:**
- Add DTO with `@IsEmail()` validation
- Validate before DB insert

**Estimated Time:** 20 minutes

---

### 3.2 Add Admin UI for Ko-fi Donation Conversion
**Files:**
- `apps/admin-dashboard/src/app/pages/donations/` (new feature)

**Solution:**
- Show pending donations table
- "Convert to License" button → tier selector → creates license
- Mark donation as processed

**Estimated Time:** 3 hours

---

### 3.3 Add Webhook Replay Protection
**Files:**
- `apps/license-api/src/webhook/kofi.controller.ts`
- `apps/license-api/src/webhook/patreon.controller.ts`

**Solution:**
- Check webhook timestamp
- Reject if >5 minutes old
- Log replay attempts to security logger

**Estimated Time:** 30 minutes

---

## Execution Order

1. ✅ **DONE:** Phase 1.1 (Patreon tier mapping) - 30 min
2. ✅ **DONE:** Phase 1.2 (Env validation) - 10 min
3. ✅ **DONE:** Phase 1.3 (Patreon event ID) - 15 min
4. ✅ **DONE:** Phase 1.4 (Webhook deduplication) - 45 min
5. ✅ **DONE:** Phase 1.5 (Frontend URL fix) - 5 min
6. ✅ **DONE:** Phase 2.1 (Token refresh) - 1 hour
7. ✅ **DONE:** Phase 2.3 (Keypair backup docs) - 30 min
8. ✅ **DONE:** Phase 2.5 (Rate limiting) - 10 min
9. ✅ **DONE:** Phase 2.4 (Tests) - 2 hours
10. ⏭️ **SKIPPED:** Phase 3.1, 3.3 (Already implemented)

**Total Time Spent:** ~3.5 hours
**Status:** ✅ **ALL CRITICAL & HIGH PRIORITY FIXES COMPLETE**

---

## Success Criteria

- [ ] All critical fixes deployed
- [ ] Patreon tier mapping consistent across all implementations
- [ ] Webhook deduplication working (test with duplicate POST)
- [ ] Environment variables validated at startup
- [ ] Frontend connects to correct API URL
- [ ] Tests passing with >80% coverage on webhook endpoints
- [ ] Documentation updated with backup procedures
- [ ] All webhooks tested end-to-end:
  - [ ] Ko-fi donation → database record + email
  - [ ] Patreon pledge → license creation + email
  - [ ] Patreon upgrade → license tier change
  - [ ] Patreon cancellation → license revocation

---

## Rollback Plan

If issues arise after deployment:

1. **Patreon tier mapping:** Revert to original backend implementation, document discrepancy
2. **Webhook deduplication:** Disable unique constraint, process duplicates (cleanup later)
3. **Env validation:** Remove validation, rely on runtime errors (not ideal)
4. **Frontend URL:** Revert to hardcoded URL with production value

---

## Post-Deployment Monitoring

Watch for:
- Webhook failure rate (should be <1%)
- License creation latency (should be <500ms)
- Patreon OAuth errors (check token refresh logs)
- Ko-fi duplicate donation warnings
- Ed25519 keypair health check failures

**Alerts:**
- Webhook failure rate >5% for 10 minutes
- License-API error rate >10% for 5 minutes
- Patreon token refresh failures

---

## Notes

- All changes backward-compatible (no breaking changes)
- Database migrations tested in development first
- Feature flags not needed (fixes are low-risk)
- Deploy during low-traffic window (if possible)
