# Security Remediation Plan - BitBonsai License Stack

**Generated:** 2025-12-23
**Total Issues:** 30 (3 Critical, 8 High, 12 Medium, 7 Low)
**Estimated Timeline:** 5-7 days

---

## Phase 1: Critical Issues (Deploy Immediately) - 4 Hours

### 1.1 Fix Broken AdminGuard Import (CRITICAL)

**File:** `apps/license-api/src/analytics/analytics.controller.ts:1`

**Issue:** Imports non-existent `AdminGuard` - all analytics endpoints are EXPOSED.

**Fix:**
```typescript
// REMOVE:
import { AdminGuard } from '../auth/admin.guard';

// ADD:
import { AdminApiKeyGuard } from '../security/admin-api-key.guard';

// UPDATE all @UseGuards decorators:
@UseGuards(AdminApiKeyGuard)
```

**Files to Modify:**
1. `apps/license-api/src/analytics/analytics.controller.ts`
2. `apps/license-api/src/promo/promo.controller.ts` (check if same issue)
3. `apps/license-api/src/pricing/pricing.controller.ts` (check if same issue)

**Testing:**
```bash
# Should return 401 Unauthorized
curl http://localhost:3000/analytics/revenue-metrics

# Should return 200 OK
curl -H "x-admin-api-key: YOUR_ADMIN_API_KEY" http://localhost:3000/analytics/revenue-metrics
```

**Time:** 30 minutes

---

### 1.2 Add AdminGuard File (CRITICAL)

**File:** `apps/license-api/src/security/admin-api-key.guard.ts` (CREATE)

**Issue:** Guard file doesn't exist - need actual implementation.

**Fix:**
```typescript
import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class AdminApiKeyGuard implements CanActivate {
  constructor(private config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const apiKey = request.headers['x-admin-api-key'];
    const validKey = this.config.get('ADMIN_API_KEY');

    if (!validKey) {
      throw new Error('ADMIN_API_KEY not configured');
    }

    if (!apiKey || apiKey !== validKey) {
      throw new UnauthorizedException('Invalid admin API key');
    }

    return true;
  }
}
```

**Files to Create:**
1. `apps/license-api/src/security/admin-api-key.guard.ts`

**Files to Modify:**
1. `apps/license-api/src/security/security.module.ts` - Add to providers/exports

**Testing:**
```bash
# Test guard rejection
curl -X POST http://localhost:3000/pricing/tiers/test-tier-id/publish
# Expected: 401 Unauthorized

# Test guard acceptance
curl -X POST -H "x-admin-api-key: test-key" http://localhost:3000/pricing/tiers/test-tier-id/publish
# Expected: 200 OK (or business logic error, not auth error)
```

**Time:** 1 hour

---

### 1.3 Implement Admin Dashboard Authentication (CRITICAL)

**File:** `apps/admin-dashboard/src/app/` (multiple files)

**Issue:** No authentication - anyone can access admin dashboard.

**Fix:**

**Step 1:** Create auth service
```typescript
// apps/admin-dashboard/src/app/services/auth.service.ts
import { Injectable } from '@angular/core';
import { Router } from '@angular/router';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly API_KEY_STORAGE_KEY = 'admin_api_key';

  constructor(private router: Router) {}

  setApiKey(apiKey: string): void {
    localStorage.setItem(this.API_KEY_STORAGE_KEY, apiKey);
  }

  getApiKey(): string | null {
    return localStorage.getItem(this.API_KEY_STORAGE_KEY);
  }

  isAuthenticated(): boolean {
    return !!this.getApiKey();
  }

  logout(): void {
    localStorage.removeItem(this.API_KEY_STORAGE_KEY);
    this.router.navigate(['/login']);
  }
}
```

**Step 2:** Create auth guard
```typescript
// apps/admin-dashboard/src/app/guards/auth.guard.ts
import { Injectable } from '@angular/core';
import { Router, CanActivate } from '@angular/router';
import { AuthService } from '../services/auth.service';

@Injectable({ providedIn: 'root' })
export class AuthGuard implements CanActivate {
  constructor(
    private auth: AuthService,
    private router: Router
  ) {}

  canActivate(): boolean {
    if (this.auth.isAuthenticated()) {
      return true;
    }
    this.router.navigate(['/login']);
    return false;
  }
}
```

**Step 3:** Create login component
```typescript
// apps/admin-dashboard/src/app/pages/login/login.component.ts
import { Component } from '@angular/core';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { AuthService } from '../../services/auth.service';
import { ApiService } from '../../services/api.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="login-container">
      <div class="login-card">
        <h1>Admin Dashboard</h1>
        <p>Enter your admin API key to continue</p>

        <form (ngSubmit)="login()">
          <input
            type="password"
            [(ngModel)]="apiKey"
            name="apiKey"
            placeholder="Admin API Key"
            class="api-key-input"
            required
          />
          <button type="submit" [disabled]="!apiKey || loading">
            {{ loading ? 'Verifying...' : 'Login' }}
          </button>
        </form>

        <p class="error" *ngIf="error">{{ error }}</p>
      </div>
    </div>
  `,
  styles: [`
    .login-container {
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
      background: #1a1a1a;
    }
    .login-card {
      background: #2a2a2a;
      border: 1px solid #f9be03;
      border-radius: 8px;
      padding: 2rem;
      width: 400px;
      max-width: 90%;
    }
    h1 { color: #f9be03; margin-bottom: 0.5rem; }
    p { color: #ccc; margin-bottom: 1.5rem; }
    .api-key-input {
      width: 100%;
      padding: 0.75rem;
      border: 1px solid #444;
      border-radius: 4px;
      background: #1a1a1a;
      color: #fff;
      font-size: 1rem;
      margin-bottom: 1rem;
    }
    button {
      width: 100%;
      padding: 0.75rem;
      background: #f9be03;
      color: #1a1a1a;
      border: none;
      border-radius: 4px;
      font-weight: bold;
      cursor: pointer;
    }
    button:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    .error {
      color: #ff4444;
      margin-top: 1rem;
    }
  `]
})
export class LoginComponent {
  apiKey = '';
  loading = false;
  error = '';

  constructor(
    private auth: AuthService,
    private api: ApiService,
    private router: Router
  ) {}

  async login() {
    this.loading = true;
    this.error = '';

    try {
      // Test API key by making authenticated request
      await this.api.testAdminAuth(this.apiKey);
      this.auth.setApiKey(this.apiKey);
      this.router.navigate(['/dashboard']);
    } catch (err: any) {
      this.error = 'Invalid API key. Please try again.';
    } finally {
      this.loading = false;
    }
  }
}
```

**Step 4:** Update ApiService to include API key
```typescript
// apps/admin-dashboard/src/app/services/api.service.ts
import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { AuthService } from './auth.service';
import { firstValueFrom } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly baseUrl = 'http://localhost:3000';

  constructor(
    private http: HttpClient,
    private auth: AuthService
  ) {}

  private getHeaders(): HttpHeaders {
    const apiKey = this.auth.getApiKey();
    return new HttpHeaders({
      'Content-Type': 'application/json',
      ...(apiKey && { 'x-admin-api-key': apiKey })
    });
  }

  get<T>(endpoint: string) {
    return this.http.get<T>(`${this.baseUrl}${endpoint}`, {
      headers: this.getHeaders()
    });
  }

  post<T>(endpoint: string, body: any) {
    return this.http.post<T>(`${this.baseUrl}${endpoint}`, body, {
      headers: this.getHeaders()
    });
  }

  // Test if API key is valid
  async testAdminAuth(apiKey: string): Promise<void> {
    const headers = new HttpHeaders({
      'x-admin-api-key': apiKey
    });
    await firstValueFrom(
      this.http.get(`${this.baseUrl}/analytics/revenue-metrics`, { headers })
    );
  }
}
```

**Step 5:** Update routes
```typescript
// apps/admin-dashboard/src/app/app.routes.ts
import { Routes } from '@angular/router';
import { AuthGuard } from './guards/auth.guard';

export const appRoutes: Routes = [
  {
    path: 'login',
    loadComponent: () => import('./pages/login/login.component').then(m => m.LoginComponent)
  },
  {
    path: '',
    canActivate: [AuthGuard],
    children: [
      { path: '', redirectTo: 'dashboard', pathMatch: 'full' },
      { path: 'dashboard', loadComponent: () => import('./pages/dashboard/dashboard.component').then(m => m.DashboardComponent) },
      { path: 'licenses', loadComponent: () => import('./pages/licenses/licenses.component').then(m => m.LicensesComponent) },
      // ... other protected routes
    ]
  },
  { path: '**', redirectTo: 'login' }
];
```

**Files to Create:**
1. `apps/admin-dashboard/src/app/services/auth.service.ts`
2. `apps/admin-dashboard/src/app/guards/auth.guard.ts`
3. `apps/admin-dashboard/src/app/pages/login/login.component.ts`

**Files to Modify:**
1. `apps/admin-dashboard/src/app/services/api.service.ts`
2. `apps/admin-dashboard/src/app/app.routes.ts`
3. `apps/admin-dashboard/src/app/layout/layout.component.ts` - Add logout button

**Testing:**
1. Navigate to `http://localhost:4200/dashboard` → Should redirect to login
2. Enter invalid API key → Should show error
3. Enter valid API key → Should redirect to dashboard
4. Refresh page → Should stay logged in
5. Click logout → Should clear key and redirect to login

**Time:** 2 hours

---

### 1.4 Remove Hardcoded Admin User ID (HIGH - included in Phase 1)

**File:** `apps/license-api/src/promo/promo.service.ts:119`

**Issue:** Admin user ID hardcoded as `user-admin-1`.

**Fix:**
```typescript
// BEFORE:
async createPromoCode(dto: CreatePromoCodeDto): Promise<PromoCode> {
  return this.prisma.promoCode.create({
    data: {
      ...dto,
      createdBy: 'user-admin-1', // HARDCODED!
    },
  });
}

// AFTER:
async createPromoCode(dto: CreatePromoCodeDto, adminId: string): Promise<PromoCode> {
  return this.prisma.promoCode.create({
    data: {
      ...dto,
      createdBy: adminId,
    },
  });
}
```

**Update Controller:**
```typescript
// apps/license-api/src/promo/promo.controller.ts
@Post()
@UseGuards(AdminApiKeyGuard)
async createPromoCode(
  @Body() dto: CreatePromoCodeDto,
  @Headers('x-admin-api-key') adminKey: string, // Extract admin identity
) {
  // Use API key hash as admin ID (or implement proper admin user table)
  const adminId = `admin-${Buffer.from(adminKey).toString('base64').slice(0, 10)}`;
  return this.promoService.createPromoCode(dto, adminId);
}
```

**Better Solution (if time permits):**
Create proper `AdminUser` table:
```prisma
model AdminUser {
  id        String   @id @default(cuid())
  email     String   @unique
  apiKey    String   @unique // hashed
  createdAt DateTime @default(now())

  promoCodesCreated PromoCode[] @relation("CreatedPromos")
  @@map("admin_users")
}

model PromoCode {
  // ... existing fields
  createdBy   String
  createdByAdmin AdminUser @relation("CreatedPromos", fields: [createdBy], references: [id])
}
```

**Files to Modify:**
1. `apps/license-api/src/promo/promo.service.ts`
2. `apps/license-api/src/promo/promo.controller.ts`

**Testing:**
```bash
# Create promo code with API key header
curl -X POST http://localhost:3000/promo \
  -H "x-admin-api-key: test-key-123" \
  -H "Content-Type: application/json" \
  -d '{"code":"TEST50","discountPercent":50}'

# Verify createdBy is NOT 'user-admin-1'
```

**Time:** 30 minutes

---

## Phase 2: High Priority Issues (Pre-Production) - 12 Hours

### 2.1 Fix Default Database Password (HIGH)

**File:** `docker-compose.license.yml:13`, `.env.example:215`

**Issue:** Default password exposed in docker-compose fallback.

**Fix:**

**Step 1:** Remove fallback from docker-compose
```yaml
# BEFORE:
POSTGRES_PASSWORD: ${LICENSE_DB_PASSWORD:-change_me_in_production}

# AFTER:
POSTGRES_PASSWORD: ${LICENSE_DB_PASSWORD}
```

**Step 2:** Update deployment script validation
```bash
# deploy-license-stack.sh - Already validates required vars
# Ensure it FAILS if LICENSE_DB_PASSWORD is empty
```

**Step 3:** Update .env.example warning
```bash
# .env.example:215
LICENSE_DB_PASSWORD=  # REQUIRED: Generate with: openssl rand -base64 24
                      # NEVER use default passwords
                      # Production: Store in secret manager (Azure Key Vault, AWS Secrets)
```

**Files to Modify:**
1. `docker-compose.license.yml`
2. `.env.example`

**Testing:**
```bash
# Should FAIL with validation error
unset LICENSE_DB_PASSWORD
./deploy-license-stack.sh
# Expected: "❌ ERROR: Missing required environment variables: LICENSE_DB_PASSWORD"
```

**Time:** 15 minutes

---

### 2.2 Fix Promo Code Race Condition (HIGH)

**File:** `apps/license-api/src/promo/promo.service.ts:119-154`

**Issue:** Validation and increment are separate operations - allows over-redemption.

**Fix:**

**Step 1:** Update Prisma schema to add database constraint
```prisma
// apps/license-api/prisma/schema.prisma
model PromoCode {
  id              String   @id @default(cuid())
  code            String   @unique
  discountPercent Int
  maxUses         Int?
  currentUses     Int      @default(0)

  @@index([code, currentUses, maxUses]) // Optimize validation query
}
```

**Step 2:** Use atomic transaction
```typescript
// apps/license-api/src/promo/promo.service.ts
async validateAndIncrementPromoCode(code: string): Promise<PromoValidationResult> {
  try {
    // Atomic update with WHERE clause
    const promo = await this.prisma.promoCode.update({
      where: {
        code,
        // Only update if usage limit not exceeded
        OR: [
          { maxUses: null }, // No limit
          { currentUses: { lt: this.prisma.promoCode.fields.maxUses } } // Under limit
        ],
      },
      data: {
        currentUses: { increment: 1 },
        lastUsedAt: new Date(),
      },
    });

    return {
      valid: true,
      discountPercent: promo.discountPercent,
      promoId: promo.id,
    };
  } catch (error) {
    // Update failed = either not found or limit exceeded
    const promo = await this.prisma.promoCode.findUnique({ where: { code } });

    if (!promo) {
      return { valid: false, reason: 'Promo code not found' };
    }
    if (!promo.isActive) {
      return { valid: false, reason: 'Promo code is inactive' };
    }
    if (promo.expiresAt && promo.expiresAt < new Date()) {
      return { valid: false, reason: 'Promo code expired' };
    }
    if (promo.maxUses && promo.currentUses >= promo.maxUses) {
      return { valid: false, reason: 'Promo code usage limit reached' };
    }

    return { valid: false, reason: 'Failed to apply promo code' };
  }
}

// REMOVE separate validatePromoCode() and incrementUsage() methods
```

**Step 3:** Add rollback support for failed license creation
```typescript
async decrementPromoCode(code: string): Promise<void> {
  await this.prisma.promoCode.update({
    where: { code },
    data: { currentUses: { decrement: 1 } },
  });
}
```

**Files to Modify:**
1. `apps/license-api/src/promo/promo.service.ts`
2. `apps/license-api/src/licenses/licenses.service.ts` - Update to use atomic method
3. `apps/license-api/prisma/schema.prisma` - Add index

**Testing:**

Create race condition test:
```typescript
// apps/license-api/src/promo/promo.service.spec.ts
describe('PromoService - Race Condition', () => {
  it('should prevent over-redemption with concurrent requests', async () => {
    // Create promo with maxUses = 5
    await promoService.createPromoCode({
      code: 'RACE50',
      discountPercent: 50,
      maxUses: 5,
    }, 'admin-test');

    // Fire 10 concurrent validation requests
    const promises = Array.from({ length: 10 }, () =>
      promoService.validateAndIncrementPromoCode('RACE50')
    );

    const results = await Promise.all(promises);
    const successCount = results.filter(r => r.valid).length;

    // Exactly 5 should succeed (not 10)
    expect(successCount).toBe(5);

    const promo = await prisma.promoCode.findUnique({ where: { code: 'RACE50' } });
    expect(promo.currentUses).toBe(5);
  });
});
```

**Migration:**
```bash
# Generate migration for index
npx prisma migrate dev --name add_promo_code_atomic_index
```

**Time:** 2 hours

---

### 2.3 Fix N+1 Query Problem (HIGH)

**File:** `apps/license-api/src/analytics/analytics.service.ts:150-162`

**Issue:** Fetches licenses then loops to get tier pricing individually.

**Fix:**

```typescript
// BEFORE (N+1):
private async calculateMRR(): Promise<number> {
  const activeLicenses = await this.prisma.license.findMany({
    where: { status: 'ACTIVE' },
  });

  let totalMRR = 0;
  for (const license of activeLicenses) {
    const tier = await this.getTierLimits(license.tier); // N+1!
    totalMRR += tier.monthlyPrice;
  }
  return totalMRR / 100;
}

// AFTER (Single Query with JOIN):
private async calculateMRR(): Promise<number> {
  const result = await this.prisma.license.groupBy({
    by: ['tier'],
    where: { status: 'ACTIVE' },
    _count: true,
  });

  // Fetch all tiers in single query
  const tiers = await this.prisma.pricingTier.findMany({
    where: {
      id: { in: result.map(r => r.tier) },
    },
    select: { id: true, priceMonthly: true },
  });

  const tierMap = new Map(tiers.map(t => [t.id, t.priceMonthly]));

  const totalMRR = result.reduce((sum, group) => {
    const monthlyPrice = tierMap.get(group.tier) || 0;
    return sum + (monthlyPrice * group._count);
  }, 0);

  return totalMRR / 100;
}
```

**Alternative: Use Prisma relation includes**
```typescript
private async calculateMRR(): Promise<number> {
  const activeLicenses = await this.prisma.license.findMany({
    where: { status: 'ACTIVE' },
    include: {
      pricingTier: {
        select: { priceMonthly: true },
      },
    },
  });

  const totalMRR = activeLicenses.reduce((sum, license) => {
    return sum + (license.pricingTier?.priceMonthly || 0);
  }, 0);

  return totalMRR / 100;
}
```

**Update Schema to Enable Relations:**
```prisma
// apps/license-api/prisma/schema.prisma
model License {
  id        String   @id @default(cuid())
  tier      String
  status    LicenseStatus

  // ADD RELATION:
  pricingTier PricingTier @relation(fields: [tier], references: [id])

  @@index([tier]) // Optimize JOIN
  @@index([status]) // Already recommended
}

model PricingTier {
  id           String    @id @default(cuid())
  priceMonthly Int

  // ADD RELATION:
  licenses     License[]
}
```

**Files to Modify:**
1. `apps/license-api/src/analytics/analytics.service.ts`
2. `apps/license-api/prisma/schema.prisma`

**Testing:**

Performance test:
```typescript
// apps/license-api/src/analytics/analytics.service.spec.ts
describe('Analytics Performance', () => {
  it('should calculate MRR with <10 database queries', async () => {
    // Seed 1000 licenses
    await seedLicenses(1000);

    // Spy on Prisma queries
    const querySpy = jest.spyOn(prisma, '$queryRaw');

    await analyticsService.calculateMRR();

    // Should be 1-2 queries (not 1000+)
    expect(querySpy).toHaveBeenCalledTimes(toBeLessThan(10));
  });
});
```

**Migration:**
```bash
npx prisma migrate dev --name add_license_tier_relation
```

**Time:** 1.5 hours

---

### 2.4 Add Missing Database Indexes (HIGH)

**File:** `apps/license-api/prisma/schema.prisma`

**Issue:** Analytics queries slow without indexes on status, createdAt, tier.

**Fix:**

```prisma
model License {
  id            String        @id @default(cuid())
  licenseKey    String        @unique
  tier          String
  status        LicenseStatus @default(ACTIVE)
  email         String
  createdAt     DateTime      @default(now())
  updatedAt     DateTime      @updatedAt
  expiresAt     DateTime?

  // EXISTING INDEXES:
  @@index([licenseKey])

  // ADD NEW INDEXES:
  @@index([status])                          // For status-based queries
  @@index([createdAt])                       // For time-series analytics
  @@index([tier])                            // For tier grouping
  @@index([status, createdAt])               // Composite for active licenses over time
  @@index([email])                           // For email lookups
  @@index([expiresAt])                       // For expiration checks

  @@map("licenses")
}

model PromoCode {
  id              String   @id @default(cuid())
  code            String   @unique
  currentUses     Int      @default(0)
  maxUses         Int?
  isActive        Boolean  @default(true)
  expiresAt       DateTime?
  createdAt       DateTime @default(now())

  // ADD NEW INDEXES:
  @@index([code, isActive])                  // For active code lookups
  @@index([expiresAt])                       // For expiration queries
  @@index([currentUses, maxUses])            // For usage validation

  @@map("promo_codes")
}

model AuditLog {
  id        String   @id @default(cuid())
  action    String
  userId    String?
  createdAt DateTime @default(now())

  // ADD NEW INDEXES:
  @@index([userId, createdAt])               // For user activity queries
  @@index([action, createdAt])               // For action-based queries
  @@index([createdAt])                       // For time-based queries

  @@map("audit_logs")
}
```

**Files to Modify:**
1. `apps/license-api/prisma/schema.prisma`

**Testing:**

Performance benchmarks:
```typescript
// apps/license-api/src/analytics/analytics.service.spec.ts
describe('Index Performance', () => {
  beforeAll(async () => {
    // Seed 10,000 licenses
    await seedLicenses(10000);
  });

  it('should query active licenses in <100ms', async () => {
    const start = Date.now();
    await prisma.license.findMany({ where: { status: 'ACTIVE' } });
    const duration = Date.now() - start;
    expect(duration).toBeLessThan(100);
  });

  it('should group by tier in <200ms', async () => {
    const start = Date.now();
    await prisma.license.groupBy({ by: ['tier'], where: { status: 'ACTIVE' } });
    const duration = Date.now() - start;
    expect(duration).toBeLessThan(200);
  });
});
```

**Migration:**
```bash
npx prisma migrate dev --name add_analytics_indexes
```

**Verify indexes created:**
```sql
-- Connect to database
docker exec -it bitbonsai-license-db psql -U license_user -d license_api

-- Check indexes
\di licenses*
\di promo_codes*
\di audit_logs*
```

**Time:** 1 hour

---

### 2.5 Add CSRF Protection (HIGH)

**File:** `apps/license-api/src/main.ts`

**Issue:** No CSRF protection for state-changing admin endpoints.

**Fix:**

**Step 1:** Install CSRF package
```bash
npm install --save csurf cookie-parser
npm install --save-dev @types/csurf @types/cookie-parser
```

**Step 2:** Enable CSRF middleware
```typescript
// apps/license-api/src/main.ts
import * as cookieParser from 'cookie-parser';
import * as csurf from 'csurf';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Enable cookie parser (required for CSRF)
  app.use(cookieParser());

  // Enable CSRF protection for all routes except:
  // - Webhooks (Stripe, Patreon signatures used instead)
  // - Health checks
  // - License validation (stateless API)
  app.use(
    csurf({
      cookie: {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
      },
      ignoreMethods: ['GET', 'HEAD', 'OPTIONS'],
      // Exclude webhook routes
      value: (req) => {
        if (req.path.startsWith('/webhooks/')) {
          return 'skip-csrf'; // Webhook routes use signature validation
        }
        return req.headers['x-csrf-token'] || req.body._csrf;
      },
    })
  );

  // Add CSRF token endpoint
  app.use('/csrf-token', (req, res) => {
    res.json({ csrfToken: req.csrfToken() });
  });

  await app.listen(3000);
}
```

**Step 3:** Update admin dashboard to include CSRF token
```typescript
// apps/admin-dashboard/src/app/services/api.service.ts
import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class ApiService {
  private csrfToken: string | null = null;

  async init(): Promise<void> {
    // Fetch CSRF token on app initialization
    const response = await firstValueFrom(
      this.http.get<{ csrfToken: string }>(`${this.baseUrl}/csrf-token`)
    );
    this.csrfToken = response.csrfToken;
  }

  private getHeaders(): HttpHeaders {
    const apiKey = this.auth.getApiKey();
    return new HttpHeaders({
      'Content-Type': 'application/json',
      ...(apiKey && { 'x-admin-api-key': apiKey }),
      ...(this.csrfToken && { 'x-csrf-token': this.csrfToken }),
    });
  }

  post<T>(endpoint: string, body: any) {
    return this.http.post<T>(`${this.baseUrl}${endpoint}`, body, {
      headers: this.getHeaders(),
      withCredentials: true, // Required for CSRF cookies
    });
  }
}
```

**Step 4:** Initialize CSRF in app config
```typescript
// apps/admin-dashboard/src/app/app.config.ts
import { ApplicationConfig, APP_INITIALIZER } from '@angular/core';
import { ApiService } from './services/api.service';

export const appConfig: ApplicationConfig = {
  providers: [
    // Initialize CSRF token before app starts
    {
      provide: APP_INITIALIZER,
      useFactory: (api: ApiService) => () => api.init(),
      deps: [ApiService],
      multi: true,
    },
    provideHttpClient(withInterceptorsFromDi()),
  ],
};
```

**Files to Modify:**
1. `apps/license-api/src/main.ts`
2. `apps/license-api/package.json` - Add csurf, cookie-parser
3. `apps/admin-dashboard/src/app/services/api.service.ts`
4. `apps/admin-dashboard/src/app/app.config.ts`

**Testing:**

```bash
# Should fail without CSRF token
curl -X POST http://localhost:3000/promo \
  -H "x-admin-api-key: test-key" \
  -d '{"code":"TEST"}'
# Expected: 403 Forbidden

# Should succeed with CSRF token
TOKEN=$(curl -s http://localhost:3000/csrf-token | jq -r .csrfToken)
curl -X POST http://localhost:3000/promo \
  -H "x-admin-api-key: test-key" \
  -H "x-csrf-token: $TOKEN" \
  -d '{"code":"TEST"}'
# Expected: 201 Created
```

**Time:** 2 hours

---

### 2.6 Validate Query Parameters (HIGH)

**File:** `apps/license-api/src/licenses/licenses.controller.ts:45`

**Issue:** Query params not validated - potential injection.

**Fix:**

**Step 1:** Create DTOs for query parameters
```typescript
// apps/license-api/src/licenses/dto/list-licenses.dto.ts
import { IsOptional, IsString, IsInt, Min, Max, IsEnum } from 'class-validator';
import { Type } from 'class-transformer';
import { LicenseStatus } from '@prisma/client';

export class ListLicensesQueryDto {
  @IsOptional()
  @IsString()
  tier?: string;

  @IsOptional()
  @IsEnum(LicenseStatus)
  status?: LicenseStatus;

  @IsOptional()
  @IsString()
  email?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  skip?: number = 0;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  take?: number = 20;
}
```

**Step 2:** Apply DTO to controller
```typescript
// apps/license-api/src/licenses/licenses.controller.ts
import { Controller, Get, Query, ValidationPipe } from '@nestjs/common';
import { ListLicensesQueryDto } from './dto/list-licenses.dto';

@Controller('licenses')
export class LicensesController {
  @Get()
  @UseGuards(AdminApiKeyGuard)
  async listLicenses(@Query(new ValidationPipe({ transform: true })) query: ListLicensesQueryDto) {
    return this.licensesService.findAll(query);
  }
}
```

**Step 3:** Enable global validation pipe
```typescript
// apps/license-api/src/main.ts
import { ValidationPipe } from '@nestjs/common';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // Strip unknown properties
      forbidNonWhitelisted: true, // Throw error on unknown properties
      transform: true, // Auto-transform types
      transformOptions: {
        enableImplicitConversion: false, // Explicit type conversion only
      },
    })
  );

  await app.listen(3000);
}
```

**Files to Create:**
1. `apps/license-api/src/licenses/dto/list-licenses.dto.ts`

**Files to Modify:**
1. `apps/license-api/src/licenses/licenses.controller.ts`
2. `apps/license-api/src/main.ts`

**Testing:**

```bash
# Should reject invalid skip
curl "http://localhost:3000/licenses?skip=-5"
# Expected: 400 Bad Request - "skip must not be less than 0"

# Should reject invalid take
curl "http://localhost:3000/licenses?take=500"
# Expected: 400 Bad Request - "take must not be greater than 100"

# Should reject unknown params
curl "http://localhost:3000/licenses?malicious=<script>alert(1)</script>"
# Expected: 400 Bad Request - "property malicious should not exist"

# Should accept valid params
curl "http://localhost:3000/licenses?skip=0&take=20&tier=pro"
# Expected: 200 OK
```

**Time:** 1.5 hours

---

### 2.7 Improve Email Error Handling (HIGH)

**File:** `apps/license-api/src/email/email.service.ts:89-110`

**Issue:** Email failures don't block critical flows but aren't tracked.

**Fix:**

**Step 1:** Add email queue for retry
```typescript
// apps/license-api/src/email/email.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { Resend } from 'resend';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  constructor(
    private resend: Resend,
    private prisma: PrismaService
  ) {}

  async sendEmail(to: string, subject: string, html: string): Promise<void> {
    try {
      await this.resend.emails.send({
        from: 'BitBonsai <noreply@bitbonsai.io>',
        to,
        subject,
        html,
      });
      this.logger.log(`Email sent to ${to}: ${subject}`);
    } catch (error) {
      this.logger.error(`Failed to send email to ${to}: ${error.message}`, error.stack);

      // Queue for retry instead of failing silently
      await this.queueFailedEmail(to, subject, html, error.message);
    }
  }

  private async queueFailedEmail(
    to: string,
    subject: string,
    html: string,
    errorMessage: string
  ): Promise<void> {
    await this.prisma.emailQueue.create({
      data: {
        to,
        subject,
        html,
        errorMessage,
        retryCount: 0,
        nextRetryAt: new Date(Date.now() + 5 * 60 * 1000), // Retry in 5 minutes
      },
    });
  }

  // Cron job to retry failed emails
  async retryFailedEmails(): Promise<void> {
    const failed = await this.prisma.emailQueue.findMany({
      where: {
        sentAt: null,
        retryCount: { lt: 3 }, // Max 3 retries
        nextRetryAt: { lte: new Date() },
      },
      take: 10,
    });

    for (const email of failed) {
      try {
        await this.resend.emails.send({
          from: 'BitBonsai <noreply@bitbonsai.io>',
          to: email.to,
          subject: email.subject,
          html: email.html,
        });

        // Mark as sent
        await this.prisma.emailQueue.update({
          where: { id: email.id },
          data: { sentAt: new Date() },
        });

        this.logger.log(`Retry successful: ${email.to} - ${email.subject}`);
      } catch (error) {
        // Increment retry count with exponential backoff
        const nextRetry = new Date(Date.now() + Math.pow(2, email.retryCount + 1) * 5 * 60 * 1000);

        await this.prisma.emailQueue.update({
          where: { id: email.id },
          data: {
            retryCount: { increment: 1 },
            nextRetryAt: nextRetry,
            errorMessage: error.message,
          },
        });

        this.logger.warn(`Retry failed (${email.retryCount + 1}/3): ${email.to}`);
      }
    }
  }
}
```

**Step 2:** Add EmailQueue table
```prisma
// apps/license-api/prisma/schema.prisma
model EmailQueue {
  id           String    @id @default(cuid())
  to           String
  subject      String
  html         String    @db.Text
  retryCount   Int       @default(0)
  nextRetryAt  DateTime
  sentAt       DateTime?
  errorMessage String?
  createdAt    DateTime  @default(now())

  @@index([nextRetryAt, sentAt])
  @@map("email_queue")
}
```

**Step 3:** Add cron job
```typescript
// apps/license-api/src/email/email.cron.ts
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { EmailService } from './email.service';

@Injectable()
export class EmailCron {
  private readonly logger = new Logger(EmailCron.name);

  constructor(private emailService: EmailService) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async retryFailedEmails() {
    this.logger.log('Retrying failed emails...');
    await this.emailService.retryFailedEmails();
  }

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async cleanupOldEmails() {
    // Delete successfully sent emails older than 7 days
    const deleted = await this.emailService.cleanupSentEmails(7);
    this.logger.log(`Cleaned up ${deleted} old emails`);
  }
}
```

**Files to Create:**
1. `apps/license-api/src/email/email.cron.ts`

**Files to Modify:**
1. `apps/license-api/src/email/email.service.ts`
2. `apps/license-api/prisma/schema.prisma`
3. `apps/license-api/src/email/email.module.ts` - Register cron

**Testing:**

```typescript
// apps/license-api/src/email/email.service.spec.ts
describe('Email Retry Logic', () => {
  it('should queue failed emails for retry', async () => {
    // Mock Resend to fail
    jest.spyOn(resend.emails, 'send').mockRejectedValue(new Error('SMTP error'));

    await emailService.sendEmail('test@example.com', 'Test', '<p>Test</p>');

    // Check email was queued
    const queued = await prisma.emailQueue.findFirst({
      where: { to: 'test@example.com' },
    });
    expect(queued).toBeDefined();
    expect(queued.retryCount).toBe(0);
  });

  it('should retry failed emails with exponential backoff', async () => {
    // Create failed email
    await prisma.emailQueue.create({
      data: {
        to: 'test@example.com',
        subject: 'Test',
        html: '<p>Test</p>',
        retryCount: 1,
        nextRetryAt: new Date(),
      },
    });

    await emailService.retryFailedEmails();

    const email = await prisma.emailQueue.findFirst({
      where: { to: 'test@example.com' },
    });

    // Should increment retry count
    expect(email.retryCount).toBe(2);

    // Next retry should be ~10 minutes later (2^2 * 5 = 20 minutes, but using 2^retryCount * 5)
    const expectedDelay = Math.pow(2, 2) * 5 * 60 * 1000;
    expect(email.nextRetryAt.getTime()).toBeGreaterThan(Date.now() + expectedDelay - 1000);
  });
});
```

**Migration:**
```bash
npx prisma migrate dev --name add_email_queue
```

**Time:** 2 hours

---

### 2.8 Create Missing AdminGuard File (Already covered in 1.2)

**Time:** Included in Phase 1

---

## Phase 3: Medium Priority Issues (Post-Launch) - 8 Hours

### 3.1 Strengthen Machine ID Generation (MEDIUM)

**File:** `apps/license-api/src/licenses/licenses.service.ts:35`

**Issue:** Machine ID only uses hostname - easily spoofed.

**Fix:**

```typescript
// BEFORE:
import { hostname } from 'os';
const machineId = hostname();

// AFTER:
import { machineIdSync } from 'node-machine-id';

private generateMachineId(): string {
  try {
    // Use hardware-based unique ID
    return machineIdSync({ original: true });
  } catch (error) {
    this.logger.warn('Failed to get hardware machine ID, falling back to hostname');
    return require('os').hostname();
  }
}
```

**Install dependency:**
```bash
npm install --save node-machine-id
```

**Files to Modify:**
1. `apps/license-api/src/licenses/licenses.service.ts`
2. `package.json`

**Testing:**
```typescript
describe('Machine ID Generation', () => {
  it('should generate consistent machine ID', () => {
    const id1 = licensesService.generateMachineId();
    const id2 = licensesService.generateMachineId();
    expect(id1).toBe(id2);
  });

  it('should generate different IDs on different machines', () => {
    // This test would run in CI on different workers
    const id = licensesService.generateMachineId();
    expect(id).toBeTruthy();
    expect(id.length).toBeGreaterThan(10);
  });
});
```

**Time:** 30 minutes

---

### 3.2 Improve Stripe Tier Fallback Logic (MEDIUM)

**File:** `apps/license-api/src/webhooks/stripe-webhook.service.ts:98`

**Issue:** Falls back to BASIC tier if Stripe price not found - should alert admin.

**Fix:**

```typescript
// BEFORE:
const tier = await this.prisma.pricingTier.findFirst({
  where: { stripePriceId: priceId },
});
if (!tier) {
  this.logger.warn(`Unknown Stripe price: ${priceId}, defaulting to BASIC`);
  return 'tier-basic';
}

// AFTER:
const tier = await this.prisma.pricingTier.findFirst({
  where: { stripePriceId: priceId },
});

if (!tier) {
  this.logger.error(`CRITICAL: Unknown Stripe price: ${priceId} - No matching tier found`);

  // Create admin alert
  await this.prisma.adminAlert.create({
    data: {
      severity: 'HIGH',
      title: 'Unknown Stripe Price Received',
      message: `Stripe webhook received payment for unknown price: ${priceId}. License creation blocked.`,
      metadata: { priceId, event: 'checkout.session.completed' },
    },
  });

  // Send email to admin
  await this.emailService.sendAdminAlert(
    'Unknown Stripe Price',
    `A payment was received for Stripe price ${priceId} but no matching tier was found in the database. Please investigate.`
  );

  // Return null to block license creation
  throw new Error(`Unknown Stripe price: ${priceId}`);
}

return tier.id;
```

**Add AdminAlert table:**
```prisma
model AdminAlert {
  id        String   @id @default(cuid())
  severity  String   // LOW, MEDIUM, HIGH, CRITICAL
  title     String
  message   String   @db.Text
  metadata  Json?
  resolved  Boolean  @default(false)
  createdAt DateTime @default(now())
  resolvedAt DateTime?

  @@index([severity, resolved, createdAt])
  @@map("admin_alerts")
}
```

**Add alerts page in admin dashboard:**
```typescript
// apps/admin-dashboard/src/app/pages/alerts/alerts.component.ts
export class AlertsComponent implements OnInit {
  alerts: Alert[] = [];

  ngOnInit() {
    this.loadAlerts();
  }

  loadAlerts() {
    this.api.get<Alert[]>('/admin/alerts?resolved=false').subscribe({
      next: (alerts) => this.alerts = alerts,
    });
  }

  resolveAlert(alert: Alert) {
    this.api.post(`/admin/alerts/${alert.id}/resolve`, {}).subscribe({
      next: () => this.loadAlerts(),
    });
  }
}
```

**Files to Create:**
1. `apps/admin-dashboard/src/app/pages/alerts/alerts.component.ts`

**Files to Modify:**
1. `apps/license-api/src/webhooks/stripe-webhook.service.ts`
2. `apps/license-api/prisma/schema.prisma`
3. `apps/license-api/src/email/email.service.ts` - Add sendAdminAlert method

**Testing:**
```typescript
describe('Stripe Unknown Price', () => {
  it('should create admin alert for unknown price', async () => {
    await stripeWebhookService.handleCheckoutCompleted({
      priceId: 'price_unknown_12345',
      email: 'test@example.com',
    });

    const alert = await prisma.adminAlert.findFirst({
      where: { title: 'Unknown Stripe Price Received' },
    });

    expect(alert).toBeDefined();
    expect(alert.severity).toBe('HIGH');
  });
});
```

**Migration:**
```bash
npx prisma migrate dev --name add_admin_alerts
```

**Time:** 1.5 hours

---

### 3.3-3.12 Remaining Medium Priority Issues

Due to length constraints, here's a summary of remaining medium issues:

**3.3 Input Sanitization** (1 hour)
- Add `class-sanitizer` package
- Sanitize email, machineId, promoCode inputs
- Add XSS protection middleware

**3.4 Analytics Enum Mismatch** (30 minutes)
- Ensure all LicenseStatus values handled in analytics
- Add tests for new status types

**3.5 Rate Limiting** (1 hour)
- Add `@nestjs/throttler`
- Configure global rate limits
- Special limits for auth endpoints

**3.6 Webhook Replay Protection** (1.5 hours)
- Track processed webhook IDs in database
- Reject duplicate webhook events

**3.7 Ko-fi Duplicate Prevention** (1 hour)
- Add unique constraint on Ko-fi transaction ID
- Handle duplicate webhook deliveries

**3.8 Hardcoded Pricing Fallback** (30 minutes)
- Remove fallback pricing values
- Require database tiers

**3.9 Config Validation** (1 hour)
- Add `@nestjs/config` validation schema
- Fail fast on missing env vars

**3.10 Cache Expiry Handling** (30 minutes)
- Add cache invalidation logic
- Handle stale cache scenarios

**3.11 Email XSS Prevention** (30 minutes)
- Sanitize user-provided data in emails
- Use email template library

**3.12 PM2 Environment Loading** (15 minutes)
- Add `env_file: '.env'` to ecosystem.config.js

**Total Phase 3 Time:** 8 hours

---

## Phase 4: Low Priority Issues (Ongoing) - 6 Hours

### 4.1 Add Request/Response DTOs (LOW)

**Time:** 2 hours
- Create DTOs for all endpoints
- Add OpenAPI decorators
- Generate Swagger documentation

### 4.2 Remove Unused Imports (LOW)

**Time:** 30 minutes
- Run ESLint with `--fix`
- Remove unused dependencies

### 4.3 Improve Error Messages (LOW)

**Time:** 1 hour
- Use specific error codes
- Add user-friendly messages
- Document error responses

### 4.4 Add Audit Logging (LOW)

**Time:** 1 hour
- Log all admin actions
- Log license operations
- Add audit log viewer

### 4.5 Add API Versioning (LOW)

**Time:** 1 hour
- Add `/v1/` prefix
- Document version strategy

### 4.6 Increase Test Coverage (LOW)

**Time:** Ongoing
- Target 80% coverage
- Add integration tests
- Add E2E tests

### 4.7 Add Health Check Endpoints (LOW)

**Time:** 30 minutes
- Database health check
- External service health
- Readiness/liveness probes

**Total Phase 4 Time:** 6 hours

---

## Testing Strategy

### Unit Tests
- All service methods
- All guard logic
- All utility functions

### Integration Tests
- Controller endpoints
- Database operations
- Email sending

### E2E Tests
- Full license creation flow
- Webhook processing
- Admin dashboard CRUD

### Performance Tests
- N+1 query fixes
- Index effectiveness
- Large dataset queries

### Security Tests
- Authentication bypass attempts
- CSRF token validation
- Input injection attempts
- Rate limit enforcement

---

## Deployment Sequence

### 1. Pre-Deployment (30 minutes)
```bash
# Backup production database
docker exec bitbonsai-license-db pg_dump -U license_user license_api > backup-$(date +%Y%m%d).sql

# Run all tests
npm run test:all
npm run test:e2e
```

### 2. Database Migrations (15 minutes)
```bash
# Apply new indexes and tables
npx prisma migrate deploy

# Verify migrations
docker exec bitbonsai-license-db psql -U license_user -d license_api -c '\dt'
docker exec bitbonsai-license-db psql -U license_user -d license_api -c '\di'
```

### 3. Code Deployment (15 minutes)
```bash
# Deploy critical fixes (Phase 1)
./deploy-license-stack.sh

# Verify services started
docker-compose -f docker-compose.license.yml ps
```

### 4. Post-Deployment Verification (30 minutes)
```bash
# Health checks
curl http://localhost:3000/health
curl http://localhost:4200
curl http://localhost:4201

# Test authentication
curl -H "x-admin-api-key: ${ADMIN_API_KEY}" http://localhost:3000/analytics/revenue-metrics

# Check logs for errors
docker-compose -f docker-compose.license.yml logs -f --tail=100
```

### 5. Monitoring Setup (1 hour)
- Verify PM2 logs
- Check error rates
- Monitor database performance
- Set up alerts

---

## Rollback Plan

### If Critical Issues Found

**Step 1: Immediate Rollback**
```bash
# Stop services
docker-compose -f docker-compose.license.yml down

# Restore database
docker exec -i bitbonsai-license-db psql -U license_user license_api < backup-YYYYMMDD.sql

# Deploy previous version
git checkout <previous-commit>
./deploy-license-stack.sh
```

**Step 2: Investigation**
- Check logs: `docker-compose logs -f`
- Review error reports
- Identify root cause

**Step 3: Hotfix**
- Fix critical issue
- Deploy patch
- Verify fix

---

## Timeline Summary

| Phase | Issues | Time | Priority |
|-------|--------|------|----------|
| Phase 1 (Critical) | 4 | 4 hours | IMMEDIATE |
| Phase 2 (High) | 8 | 12 hours | Pre-Production |
| Phase 3 (Medium) | 12 | 8 hours | Post-Launch |
| Phase 4 (Low) | 7 | 6 hours | Ongoing |
| **TOTAL** | **31** | **30 hours** | **~5-7 days** |

---

## Success Criteria

### Phase 1 (Must Have Before Production)
- ✅ All admin endpoints require authentication
- ✅ AdminGuard file exists and works
- ✅ Admin dashboard requires login
- ✅ No hardcoded admin IDs

### Phase 2 (Must Have Before Launch)
- ✅ No default passwords
- ✅ Promo codes cannot be over-redeemed
- ✅ Analytics queries optimized (<200ms)
- ✅ Database indexes in place
- ✅ CSRF protection enabled
- ✅ Input validation on all endpoints
- ✅ Email retry mechanism working

### Phase 3 (Should Have Post-Launch)
- ✅ Machine ID uses hardware fingerprint
- ✅ Admin alerts for unknown Stripe prices
- ✅ All inputs sanitized
- ✅ Rate limiting active
- ✅ Webhook replay protection

### Phase 4 (Nice to Have)
- ✅ Full API documentation
- ✅ 80%+ test coverage
- ✅ Audit logging operational

---

## Next Steps

1. **Review this plan** - Confirm priorities and timeline
2. **Create implementation branch** - `git checkout -b security-remediation`
3. **Start with Phase 1** - Deploy critical fixes within 4 hours
4. **Test thoroughly** - Run test suite after each fix
5. **Deploy to staging** - Validate fixes in staging environment
6. **Production deployment** - After Phase 1 + Phase 2 complete

---

**End of Remediation Plan**
