# CLAUDE.md - BitBonsai

## Code Conventions

**IMPORTANT:** This project follows standardized conventions from `~/git/code-conventions/`

Key guidelines:
- **[Git Commit Instructions](~/git/code-conventions/git-commit-instructions.md)** - Conventional commits, NO AI attribution
- **[TypeScript Guidelines](~/git/code-conventions/typescript-guidelines.md)** - Strict typing, zero dead code
- **[Angular Guidelines](~/git/code-conventions/angular-guidelines.md)** - Modern Angular patterns
- **[NestJS Guidelines](~/git/code-conventions/nestjs-guidelines.md)** - Backend architecture
- **[Testing Guidelines](~/git/code-conventions/testing-guidelines.md)** - 100% coverage on new code
- **[Security Guidelines](~/git/code-conventions/security-guidelines.md)** - OWASP protection

📖 **Full list:** See `~/git/code-conventions/README.md`

---

## Project Overview

BitBonsai is a multi-node video transcoding platform that automatically converts video libraries to HEVC/AV1 codecs. Built with NestJS (backend) + Angular (frontend).

**Architecture:**
- Main Node (Unraid): 192.168.1.100 - PostgreSQL database, primary API
- Child Nodes (LXC): 192.168.1.170 - Worker nodes via NFS shared storage

## Core UX Philosophy

**CRITICAL - READ THIS FIRST:**

The app's purpose is simple: **encode videos with zero friction**. Users should have almost NOTHING to do other than selecting what to encode.

### Design Principles

| Principle | What It Means |
|-----------|---------------|
| **Zero Configuration** | Smart defaults that work for 99% of users. No tuning required. |
| **Self-Healing** | System automatically recovers from failures without user intervention |
| **Invisible Complexity** | Load balancing, node management, health checks - all happen silently |
| **No Debug UI for Users** | Technical metrics hidden unless explicitly enabled by power users |
| **Warnings, Not Blockers** | Prefer graceful degradation over hard failures |

### Anti-Patterns to AVOID

- Adding configuration options to "fix" problems (make it smart instead)
- Showing technical errors to users (log them, handle them silently)
- Requiring manual intervention for recovery (auto-retry, auto-heal)
- Exposing system metrics in main UI (load, CPU, memory, thresholds)
- Asking users to restart services or clear caches

### When Implementing Features

**Ask yourself:**
1. Can this work automatically without user input? → Do that
2. Does the user NEED to see this? → Probably not, hide it
3. Is this a config option? → Make it a smart default instead
4. Does this require manual recovery? → Add auto-retry/auto-heal

### Examples

| Bad | Good |
|-----|------|
| "Set loadThresholdMultiplier to 5.0" | System auto-tunes based on actual performance |
| "61 jobs marked CORRUPTED" | System auto-retries health checks hourly |
| "Worker throttled, load 30 > 24" | Higher smart defaults, silent load management |
| "Run SQL to reset health status" | Automatic periodic re-validation |
| Debug tab showing system load | Hidden in settings → advanced → diagnostics |

## Application Stack

BitBonsai consists of **three applications**:

| App | Type | Purpose | Port |
|-----|------|---------|------|
| **backend** | NestJS | Video transcoding backend | 3100 (prod), 3000 (dev) |
| **frontend** | Angular (Ionic) | Desktop app UI | 4210 (prod), 4200 (dev) |
| **website** | Angular | Marketing site | 4201 (dev) |

### API Integration: Website ↔ Licensing Service

**Architecture:**
- Website (`bitbonsai.app`) is a static Angular marketing site
- **Licensing Service** (`api.bitbonsai.app`) provides pricing/license data
- **Extracted to separate repo:** `~/git/licensing-service` (multi-project platform)
- Deployed on **different domains** (CORS enabled)

**Key Integration Points:**

| Component | Location | Purpose |
|-----------|----------|---------|
| Service | `apps/website/src/app/services/pricing-api.service.ts` | HTTP client for license-api |
| Component | `apps/website/src/app/pages/pricing/pricing.component.ts` | Displays live pricing data |
| Environment | `apps/website/src/environments/environment*.ts` | API URLs (dev/prod) |

**API Contract:**
```typescript
// Endpoint: GET /api/pricing (public, no auth)
// Response: PricingTier[]
interface PricingTier {
  id: string;
  name: string;              // e.g., "FREE", "SUPPORTER"
  displayName: string;       // e.g., "Free", "Supporter"
  description?: string;
  maxNodes: number;
  maxConcurrentJobs: number;
  priceMonthly: number;      // cents (e.g., 500 = $5.00)
  priceYearly?: number;
  stripePriceIdMonthly?: string;
  stripePriceIdYearly?: string;
  patreonTierId?: string;
  isActive: boolean;
}
```

**Environment URLs:**
```typescript
// Dev:  http://localhost:3200/api
// Prod: https://api.bitbonsai.app/api
```

**Data Flow:**
1. Website calls `pricingApi.getActiveTiers()`
2. Service fetches from `/api/pricing`
3. Component transforms API data (cents → dollars)
4. UI displays with loading/error states

**Error Handling:**
- Loading spinner while fetching
- User-friendly error messages (connection, rate limit, server error)
- Graceful degradation (no fallback data, just error message)

**CORS Setup:**
- License-API configured for: `bitbonsai.app`, `app.bitbonsai.app`
- Rate limiting: 100 requests/60s per IP

## Technical Reference

### Common Commands

```bash
# Deploy to main node
./deploy-unraid.sh

# Deploy to child node
./deploy-lxc-child.sh

# Build backend
nx build backend

# Build website
nx build website --configuration=production

# Serve license-api (requires PostgreSQL + .env)
nx serve license-api

# Check logs
ssh root@unraid 'docker logs -f bitbonsai-backend'
ssh pve-labg5 'pct exec 300 -- journalctl -u bitbonsai-backend -f'
```

### Key Files

**Backend (Transcoding):**
| Component | Path |
|-----------|------|
| Encoding Processor | `apps/backend/src/encoding/encoding-processor.service.ts` |
| Queue Service | `apps/backend/src/queue/queue.service.ts` |
| Health Check | `apps/backend/src/queue/health-check.worker.ts` |
| Distribution v2 | `apps/backend/src/distribution/` |
| FFmpeg Service | `apps/backend/src/encoding/ffmpeg.service.ts` |

**Website (Marketing):**
| Component | Path |
|-----------|------|
| Pricing API Service | `apps/website/src/app/services/pricing-api.service.ts` |
| Pricing Page | `apps/website/src/app/pages/pricing/pricing.component.ts` |
| Environments | `apps/website/src/environments/` |
| Favicon Assets | `apps/website/public/favicon.*` |

### Multi-Node Architecture

- **MAIN node**: Owns database, can update any job
- **LINKED nodes**: Workers only, proxy API calls to MAIN
- **Job ownership**: Validated on PATCH to prevent cross-node pollution
- **Shared storage**: NFS mounts for zero-copy file access

### Auto-Healing Systems

1. **Orphaned Job Recovery**: On startup, resets stuck ENCODING jobs to QUEUED
2. **Temp File Detection**: 10 retries × 2s for NFS mount recovery
3. **Health Check Retry**: 5 retries × 2s before marking CORRUPTED
4. **CORRUPTED Auto-Requeue**: Hourly re-validation of CORRUPTED jobs
5. **Stuck Job Watchdog**: Detects and recovers jobs with no progress

## Licensing Service (Extracted)

**License-API and admin-dashboard have been extracted to a separate repository:**
- **Repository:** `~/git/licensing-service`
- **Purpose:** Multi-project licensing platform (serves BitBonsai + future projects)
- **Documentation:** See `~/git/licensing-service/README.md`

**BitBonsai Integration:**
- Website (`apps/website`) fetches pricing data from licensing service API
- API URL configured in `apps/website/src/environments/environment*.ts`
- Dev: `http://localhost:3200/api`
- Prod: `https://api.bitbonsai.app`

## Git Workflow

- Main branch: `main`
- Feature branches: `feature/description`
- Commits: Conventional commits (`feat:`, `fix:`, `chore:`)
