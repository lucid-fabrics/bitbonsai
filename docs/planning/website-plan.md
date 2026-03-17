# BitBonsai Website & License Management - v7 FINAL PLAN

**E-Commerce Grade SaaS Platform**

Timeline: 20.5 days | Tech Stack: Angular 21+, NestJS, Prisma, PostgreSQL, Docker Compose

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    bitbonsai.io (Remote)                    │
│  ┌─────────────────┐  ┌──────────────────────────────────┐ │
│  │  Angular 21+    │  │       NestJS API                 │ │
│  │  Marketing Site │  │  - License Management            │ │
│  │  Admin Dashboard│──│  - Webhook Handlers (Stripe/Patreon)│
│  │                 │  │  - Analytics & Reporting         │ │
│  │  Golden Dark    │  │  - Email Templates               │ │
│  │  Theme (#f9be03)│  │  - Config Management (Encrypted) │ │
│  └─────────────────┘  └──────────────────────────────────┘ │
│           │                         │                       │
│           │                         ▼                       │
│           │            ┌────────────────────────┐           │
│           │            │ PostgreSQL (License DB)│           │
│           │            │ - licenses             │           │
│           │            │ - pricing_tiers        │           │
│           │            │ - promo_codes          │           │
│           │            │ - donations (Ko-fi)    │           │
│           │            │ - app_config (encrypted)│          │
│           │            │ - audit_log            │           │
│           │            └────────────────────────┘           │
└───────────┼─────────────────────────────────────────────────┘
            │ HTTPS API (24h cache)
            │
┌───────────▼─────────────────────────────────────────────────┐
│              BitBonsai Backend (Local User Install)         │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  NestJS Backend (Consumer Only)                      │   │
│  │  - License verification API client                   │   │
│  │  - Node limit enforcement                            │   │
│  │  - Job limit enforcement                             │   │
│  │  - License stored in local DB (not .env)             │   │
│  │  - 24h verification cron job                         │   │
│  └──────────────────────────────────────────────────────┘   │
│              ▼                                               │
│  ┌────────────────────────┐                                 │
│  │ PostgreSQL/SQLite      │                                 │
│  │ (Local Encoding Data)  │                                 │
│  │ - settings table (license key)                           │
│  └────────────────────────┘                                 │
└─────────────────────────────────────────────────────────────┘
```

### Two Separate Databases (By Design)
- **Remote License DB**: Manages subscriptions, licenses, payments, analytics
- **Local BitBonsai DB**: Stores encoding jobs, nodes, configuration

---

## Phase 0: Shared UI Library (1 day)

**Goal:** Extract reusable components from BitBonsai frontend for admin dashboard

### Create `libs/shared-ui`

```
libs/shared-ui/
├── src/
│   ├── lib/
│   │   ├── components/
│   │   │   ├── button/               # Golden accent buttons
│   │   │   ├── card/                 # Dark theme cards
│   │   │   ├── table/                # Data tables
│   │   │   ├── form-field/           # Input fields
│   │   │   ├── badge/                # Status badges
│   │   │   ├── loading-spinner/      # Spinners
│   │   │   ├── stat-card/            # Metrics display
│   │   │   └── page-header/          # Page titles
│   │   ├── styles/
│   │   │   ├── _variables.scss       # Color palette
│   │   │   ├── _mixins.scss          # Reusable mixins
│   │   │   └── _theme.scss           # Dark theme
│   │   └── index.ts                  # Public API
```

### Color Variables (Exact Match)
```scss
// apps/frontend/src/styles/_variables.scss → libs/shared-ui/src/lib/styles/_variables.scss
$accent-primary: #f9be03;              // Golden yellow
$accent-primary-hover: #fcd34d;

$bg-primary: #1a1a1a;                  // Darkest
$bg-secondary: #252525;                // Cards
$bg-tertiary: #2a2a2a;                 // Hover states

$border-primary: #2d2d2d;
$border-secondary: #3d3d3d;

$text-primary: #e0e0e0;                // Main text
$text-secondary: #888;                 // Labels
$text-tertiary: #666;                  // Disabled

$success: #4ade80;
$warning: #fbbf24;
$danger: #ff6b6b;
$info: #38bdf8;
```

### Key Components to Extract

| Component | Source | Purpose |
|-----------|--------|---------|
| `bb-button` | apps/frontend | Styled buttons with golden accent |
| `bb-card` | apps/frontend | Dark theme cards with borders |
| `bb-table` | apps/frontend | Data tables with sorting |
| `bb-form-field` | apps/frontend | Input fields with validation |
| `bb-stat-card` | apps/frontend | Metrics display (for analytics) |
| `bb-badge` | apps/frontend | Status indicators |

### Usage in Admin Dashboard
```typescript
// apps/website-admin/src/app/dashboard/dashboard.component.ts
import { BbButtonComponent, BbStatCardComponent } from '@bitbonsai/shared-ui';

@Component({
  standalone: true,
  imports: [BbButtonComponent, BbStatCardComponent],
  // Uses golden dark theme automatically
})
```

---

## Phase 1: Core License API Enhancements (4 days)

### 1.1 Database-Driven Pricing Management (1.5 days)

**New Prisma Schema (apps/license-api/prisma/schema.prisma):**

```prisma
model PricingTier {
  id                String   @id @default(cuid())
  name              String   @unique              // "COMMERCIAL_STARTER"
  displayName       String                        // "Commercial Starter"
  description       String
  maxNodes          Int
  maxConcurrentJobs Int
  priceMonthly      Int                           // Cents (e.g., 2900 = $29)
  priceYearly       Int?                          // Cents (e.g., 29000 = $290)
  stripePriceIdMonthly String?                    // Auto-created on publish
  stripePriceIdYearly  String?
  patreonTierId     String?                       // Manual mapping
  isActive          Boolean  @default(false)      // Published?
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt
  createdBy         String                        // Admin user ID
  publishedBy       String?
  publishedAt       DateTime?

  @@index([isActive])
}

model PromoCode {
  id            String   @id @default(cuid())
  code          String   @unique
  description   String
  discountType  String                            // "PERCENTAGE" | "FIXED"
  discountValue Int                               // 20 (for 20%) or 500 (for $5)
  validFrom     DateTime
  validUntil    DateTime
  maxUses       Int?                              // null = unlimited
  currentUses   Int      @default(0)
  isActive      Boolean  @default(true)
  createdAt     DateTime @default(now())
  createdBy     String

  @@index([code, isActive])
  @@index([validUntil])
}

model Donation {
  id              String   @id @default(cuid())
  email           String
  amount          Int                             // Cents
  provider        String                          // "KOFI"
  providerEventId String   @unique
  status          String                          // "PENDING" | "CONVERTED" | "REFUNDED"
  convertedToLicenseId String?
  processedBy     String?
  processedAt     DateTime?
  rawPayload      Json
  createdAt       DateTime @default(now())

  @@index([email, status])
}

model AppConfig {
  id          String   @id @default(cuid())
  key         String   @unique
  value       String                              // Encrypted
  displayName String
  description String?
  isSecret    Boolean  @default(false)
  updatedAt   DateTime @updatedAt
  updatedBy   String

  @@index([key])
}

model AuditLog {
  id         String   @id @default(cuid())
  action     String                               // "CREATE_LICENSE" | "REFUND" | etc.
  entityType String                               // "LICENSE" | "PROMO_CODE" | etc.
  entityId   String
  userId     String                               // Admin who performed action
  changes    Json?                                // Before/after diff
  ipAddress  String?
  userAgent  String?
  createdAt  DateTime @default(now())

  @@index([entityType, entityId])
  @@index([userId])
  @@index([createdAt])
}

model EmailTemplate {
  id          String   @id @default(cuid())
  key         String   @unique                    // "LICENSE_CREATED" | "LICENSE_EXPIRING"
  subject     String
  htmlBody    String   @db.Text
  textBody    String   @db.Text
  variables   Json                                // ["{{email}}", "{{key}}"]
  isActive    Boolean  @default(true)
  updatedAt   DateTime @updatedAt
  updatedBy   String

  @@index([key])
}
```

**Admin API Endpoints:**

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/admin/pricing` | GET | List all tiers (draft + published) |
| `/admin/pricing` | POST | Create new tier (draft) |
| `/admin/pricing/:id` | PATCH | Update tier (unpublished only) |
| `/admin/pricing/:id/publish` | POST | Publish tier → creates Stripe prices |
| `/admin/pricing/:id/deactivate` | POST | Mark tier inactive (soft delete) |
| `/admin/patreon/tiers` | GET | List Patreon tiers (via API) |
| `/admin/pricing/:id/map-patreon` | POST | Map Patreon tier ID to pricing tier |

**Publishing Flow (apps/license-api/src/pricing/pricing.service.ts):**

```typescript
async publishTier(tierId: string, adminUserId: string): Promise<void> {
  return this.prisma.$transaction(async (tx) => {
    const tier = await tx.pricingTier.findUnique({ where: { id: tierId } });

    // Create Stripe monthly price
    const monthlyPrice = await this.stripe.prices.create({
      unit_amount: tier.priceMonthly,
      currency: 'usd',
      recurring: { interval: 'month' },
      product: process.env.STRIPE_PRODUCT_ID,
      metadata: { tierName: tier.name },
    });

    // Create Stripe yearly price (if defined)
    let yearlyPrice = null;
    if (tier.priceYearly) {
      yearlyPrice = await this.stripe.prices.create({
        unit_amount: tier.priceYearly,
        currency: 'usd',
        recurring: { interval: 'year' },
        product: process.env.STRIPE_PRODUCT_ID,
        metadata: { tierName: tier.name },
      });
    }

    // Save Stripe price IDs + mark published
    await tx.pricingTier.update({
      where: { id: tierId },
      data: {
        stripePriceIdMonthly: monthlyPrice.id,
        stripePriceIdYearly: yearlyPrice?.id,
        isActive: true,
        publishedBy: adminUserId,
        publishedAt: new Date(),
      },
    });

    // Audit log
    await tx.auditLog.create({
      data: {
        action: 'PUBLISH_PRICING_TIER',
        entityType: 'PRICING_TIER',
        entityId: tierId,
        userId: adminUserId,
        changes: { stripePriceIdMonthly: monthlyPrice.id },
      },
    });
  });
}
```

**Stripe Webhook Update (apps/license-api/src/webhook/stripe.controller.ts):**

```typescript
// BEFORE (hardcoded):
const STRIPE_PRICE_TO_TIER: Record<string, LicenseTier> = {
  price_starter_monthly: LicenseTier.COMMERCIAL_STARTER,
};

// AFTER (database lookup):
private async determineTier(priceId: string): Promise<LicenseTier> {
  const tier = await this.prisma.pricingTier.findFirst({
    where: {
      OR: [
        { stripePriceIdMonthly: priceId },
        { stripePriceIdYearly: priceId },
      ],
    },
  });

  if (!tier) {
    this.logger.error(`Unknown Stripe price ID: ${priceId}`);
    return LicenseTier.COMMERCIAL_STARTER; // Fallback
  }

  return tier.name as LicenseTier;
}
```

### 1.2 Promo Code System (0.5 days)

**Admin API:**

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/admin/promo-codes` | GET | List all promo codes |
| `/admin/promo-codes` | POST | Create new code |
| `/admin/promo-codes/:id` | PATCH | Update code (if unused) |
| `/admin/promo-codes/:id/deactivate` | POST | Mark inactive |
| `/promo-codes/validate` | POST | Public: Validate code before checkout |

**Validation Logic (apps/license-api/src/promo/promo.service.ts):**

```typescript
async validatePromoCode(code: string): Promise<{ valid: boolean; discount?: number }> {
  const promo = await this.prisma.promoCode.findUnique({
    where: { code: code.toUpperCase() },
  });

  if (!promo || !promo.isActive) {
    return { valid: false };
  }

  const now = new Date();
  if (now < promo.validFrom || now > promo.validUntil) {
    return { valid: false };
  }

  if (promo.maxUses && promo.currentUses >= promo.maxUses) {
    return { valid: false };
  }

  return { valid: true, discount: promo.discountValue };
}
```

**Checkout Flow with Promo:**

1. User enters promo code on website
2. Website calls `/promo-codes/validate`
3. If valid, display discount: "20% off - $29 → $23.20"
4. On checkout, Stripe creates custom one-time price with discount
5. Increment `currentUses` on success

### 1.3 Ko-fi Donation Handling (0.5 days)

**Webhook Controller (apps/license-api/src/webhook/kofi.controller.ts):**

```typescript
@Post()
async handleWebhook(@Body() payload: KofiWebhookPayload): Promise<{ received: boolean }> {
  // Ko-fi doesn't provide signature verification (limitation of their API)

  await this.prisma.donation.create({
    data: {
      email: payload.email,
      amount: Math.round(payload.amount * 100), // Convert to cents
      provider: 'KOFI',
      providerEventId: payload.kofi_transaction_id,
      status: 'PENDING',
      rawPayload: payload as unknown as Record<string, unknown>,
    },
  });

  // Send thank-you email (no license created)
  await this.emailService.sendFromTemplate('KOFI_THANK_YOU', {
    to: payload.email,
    variables: { amount: payload.amount },
  });

  return { received: true };
}
```

**Admin Review UI:**
- Admin dashboard shows pending donations
- Admin can:
  - **Convert to License**: Manually create license for donor
  - **Refund**: Process refund (Ko-fi doesn't have API - manual process)
  - **Mark as Processed**: Just acknowledge

### 1.4 Config UI with Encryption (1 day)

**Bootstrap Problem Solved:**
- Encryption key stored in `.env` (ENCRYPTION_KEY)
- All other configs stored in `app_config` table (encrypted)

**Admin API:**

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/admin/config` | GET | List all configs (masked if secret) |
| `/admin/config/:key` | GET | Get single config (full value if authorized) |
| `/admin/config/:key` | PUT | Update config value |

**Encryption Service (apps/license-api/src/crypto/config-crypto.service.ts):**

```typescript
import * as crypto from 'crypto';

export class ConfigCryptoService {
  private readonly algorithm = 'aes-256-gcm';
  private readonly key: Buffer;

  constructor(private readonly configService: ConfigService) {
    const keyHex = this.configService.getOrThrow<string>('ENCRYPTION_KEY');
    this.key = Buffer.from(keyHex, 'hex');
  }

  encrypt(plaintext: string): string {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(this.algorithm, this.key, iv);

    let encrypted = cipher.update(plaintext, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    const authTag = cipher.getAuthTag();

    // Format: iv:authTag:ciphertext
    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
  }

  decrypt(ciphertext: string): string {
    const [ivHex, authTagHex, encrypted] = ciphertext.split(':');

    const decipher = crypto.createDecipheriv(
      this.algorithm,
      this.key,
      Buffer.from(ivHex, 'hex')
    );
    decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));

    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  }
}
```

**Display Masking (apps/license-api/src/config/config.service.ts):**

```typescript
async getConfigForDisplay(key: string): Promise<{ key: string; value: string; isSecret: boolean }> {
  const config = await this.prisma.appConfig.findUnique({ where: { key } });

  if (!config) {
    throw new NotFoundException();
  }

  let displayValue = this.cryptoService.decrypt(config.value);

  if (config.isSecret) {
    // Mask: "sk_live_****...abc123" (show last 6 chars)
    const length = displayValue.length;
    if (length > 10) {
      displayValue = `${displayValue.substring(0, 8)}****...${displayValue.substring(length - 6)}`;
    }
  }

  return {
    key: config.key,
    value: displayValue,
    isSecret: config.isSecret,
  };
}
```

**Config Keys:**

| Key | Secret | Description |
|-----|--------|-------------|
| STRIPE_SECRET_KEY | Yes | Stripe API secret |
| STRIPE_WEBHOOK_SECRET | Yes | Stripe webhook signing |
| PATREON_CLIENT_ID | No | Patreon OAuth client |
| PATREON_CLIENT_SECRET | Yes | Patreon OAuth secret |
| PATREON_WEBHOOK_SECRET | Yes | Patreon webhook signing |
| RESEND_API_KEY | Yes | Email service |
| DATABASE_URL | Yes | PostgreSQL connection |

### 1.5 Audit Logging (0.5 days)

**Decorator for Auto-Logging (apps/license-api/src/audit/audit.decorator.ts):**

```typescript
export function Audited(entityType: string) {
  return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    const originalMethod = descriptor.value;

    descriptor.value = async function (...args: any[]) {
      const result = await originalMethod.apply(this, args);

      // Extract user from request context
      const req = args.find((arg) => arg.user);
      const userId = req?.user?.id || 'system';

      // Log the action
      await this.auditService.log({
        action: propertyKey.toUpperCase(),
        entityType,
        entityId: result.id,
        userId,
        ipAddress: req?.ip,
        userAgent: req?.headers['user-agent'],
      });

      return result;
    };

    return descriptor;
  };
}
```

**Usage:**

```typescript
@Audited('LICENSE')
async createLicense(dto: CreateLicenseDto, req: Request): Promise<License> {
  // Implementation
}
```

---

## Phase 2: BitBonsai Backend Integration (2 days)

### 2.1 License Storage in Database (0.5 days)

**New Table (apps/backend/prisma/schema.prisma):**

```prisma
model Setting {
  key   String @id
  value String
}
```

**Settings Service (apps/backend/src/settings/settings.service.ts):**

```typescript
export class SettingsService {
  async getLicenseKey(): Promise<string | null> {
    const setting = await this.prisma.setting.findUnique({
      where: { key: 'LICENSE_KEY' },
    });
    return setting?.value || null;
  }

  async setLicenseKey(key: string): Promise<void> {
    await this.prisma.setting.upsert({
      where: { key: 'LICENSE_KEY' },
      create: { key: 'LICENSE_KEY', value: key },
      update: { value: key },
    });
  }
}
```

### 2.2 License Verification Client (1 day)

**License Client (apps/backend/src/license/license-client.service.ts):**

```typescript
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

export class LicenseClientService {
  private readonly apiUrl: string;
  private cachedLicense: License | null = null;
  private lastVerification: Date | null = null;

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
    private readonly settingsService: SettingsService,
  ) {
    this.apiUrl = this.configService.get('LICENSE_API_URL') || 'https://api.bitbonsai.io';
  }

  async verifyLicense(): Promise<License> {
    const now = new Date();

    // Return cache if verified within 24h
    if (this.cachedLicense && this.lastVerification) {
      const hoursSinceVerification = (now.getTime() - this.lastVerification.getTime()) / (1000 * 60 * 60);
      if (hoursSinceVerification < 24) {
        return this.cachedLicense;
      }
    }

    const licenseKey = await this.settingsService.getLicenseKey();

    if (!licenseKey) {
      throw new UnauthorizedException('No license key configured');
    }

    try {
      const response = await firstValueFrom(
        this.httpService.post(`${this.apiUrl}/licenses/verify`, {
          key: licenseKey,
          machineId: this.getMachineId(),
          machineName: os.hostname(),
        })
      );

      this.cachedLicense = response.data;
      this.lastVerification = now;

      return this.cachedLicense;
    } catch (error) {
      // Graceful degradation: use cached license if API unreachable
      if (this.cachedLicense) {
        this.logger.warn('License API unreachable, using cached license');
        return this.cachedLicense;
      }
      throw new UnauthorizedException('License verification failed');
    }
  }

  async getCurrentLimits(): Promise<{ maxNodes: number; maxConcurrentJobs: number }> {
    const license = await this.verifyLicense();
    return {
      maxNodes: license.maxNodes,
      maxConcurrentJobs: license.maxConcurrentJobs,
    };
  }

  private getMachineId(): string {
    // Generate stable machine ID from MAC address + hostname
    const networkInterfaces = os.networkInterfaces();
    const macs = Object.values(networkInterfaces)
      .flat()
      .filter((iface) => iface && !iface.internal && iface.mac !== '00:00:00:00:00:00')
      .map((iface) => iface.mac);

    const uniqueString = `${macs.join('-')}-${os.hostname()}`;
    return crypto.createHash('sha256').update(uniqueString).digest('hex');
  }
}
```

### 2.3 Enforcement Guards (0.5 days)

**Node Limit Guard (apps/backend/src/license/guards/node-limit.guard.ts):**

```typescript
@Injectable()
export class NodeLimitGuard implements CanActivate {
  constructor(
    private readonly licenseClient: LicenseClientService,
    private readonly nodeService: NodeService,
  ) {}

  async canActivate(): Promise<boolean> {
    const { maxNodes } = await this.licenseClient.getCurrentLimits();
    const currentNodeCount = await this.nodeService.getActiveNodeCount();

    if (currentNodeCount >= maxNodes) {
      throw new ForbiddenException(
        `Node limit reached (${currentNodeCount}/${maxNodes}). Upgrade license to add more nodes.`
      );
    }

    return true;
  }
}
```

**Usage:**

```typescript
@Post('nodes')
@UseGuards(NodeLimitGuard)
async createNode(@Body() dto: CreateNodeDto): Promise<Node> {
  // Only executes if node limit not exceeded
}
```

---

## Phase 3: E-Commerce Admin Dashboard (7 days)

### 3.1 Analytics Engine (2 days)

**Metrics Service (apps/license-api/src/analytics/metrics.service.ts):**

```typescript
export interface RevenueMetrics {
  mrr: number;                          // Monthly Recurring Revenue
  arr: number;                          // Annual Recurring Revenue
  churnRate: number;                    // % of cancelled subscriptions
  clv: number;                          // Customer Lifetime Value
  activeSubscriptions: number;
  newSubscriptionsThisMonth: number;
  revenueByTier: Record<string, number>;
  subscriptionHealth: {
    healthy: number;                    // Active, no issues
    expiringSoon: number;               // < 7 days to expiry
    overdue: number;                    // Past expiry, not cancelled
  };
}

export class MetricsService {
  async getRevenueMetrics(): Promise<RevenueMetrics> {
    const activeSubscriptions = await this.prisma.license.findMany({
      where: { status: 'ACTIVE' },
      include: { tier: true },
    });

    // MRR calculation
    const mrr = activeSubscriptions.reduce((sum, license) => {
      const tier = license.tier;
      const monthlyRevenue = tier.priceYearly
        ? tier.priceYearly / 12
        : tier.priceMonthly;
      return sum + monthlyRevenue;
    }, 0) / 100; // Convert from cents

    // ARR = MRR × 12
    const arr = mrr * 12;

    // Churn rate (last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const cancelledCount = await this.prisma.license.count({
      where: {
        status: 'CANCELLED',
        updatedAt: { gte: thirtyDaysAgo },
      },
    });

    const totalAtStart = activeSubscriptions.length + cancelledCount;
    const churnRate = totalAtStart > 0 ? (cancelledCount / totalAtStart) * 100 : 0;

    // CLV = Average monthly revenue / churn rate
    const avgMonthlyRevenue = activeSubscriptions.length > 0 ? mrr / activeSubscriptions.length : 0;
    const clv = churnRate > 0 ? avgMonthlyRevenue / (churnRate / 100) : avgMonthlyRevenue * 12;

    // Revenue by tier
    const revenueByTier: Record<string, number> = {};
    activeSubscriptions.forEach((license) => {
      const tier = license.tier;
      const monthlyRevenue = tier.priceYearly ? tier.priceYearly / 12 : tier.priceMonthly;
      revenueByTier[tier.displayName] = (revenueByTier[tier.displayName] || 0) + monthlyRevenue / 100;
    });

    // Subscription health
    const now = new Date();
    const sevenDaysFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    const subscriptionHealth = {
      healthy: activeSubscriptions.filter((l) => !l.expiresAt || l.expiresAt > sevenDaysFromNow).length,
      expiringSoon: activeSubscriptions.filter((l) => l.expiresAt && l.expiresAt <= sevenDaysFromNow && l.expiresAt > now).length,
      overdue: activeSubscriptions.filter((l) => l.expiresAt && l.expiresAt <= now).length,
    };

    return {
      mrr,
      arr,
      churnRate,
      clv,
      activeSubscriptions: activeSubscriptions.length,
      newSubscriptionsThisMonth: await this.getNewSubscriptionsCount(),
      revenueByTier,
      subscriptionHealth,
    };
  }

  private async getNewSubscriptionsCount(): Promise<number> {
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    return this.prisma.license.count({
      where: {
        createdAt: { gte: startOfMonth },
      },
    });
  }
}
```

**Admin API:**

| Endpoint | Purpose |
|----------|---------|
| `/admin/analytics/revenue` | Get RevenueMetrics |
| `/admin/analytics/revenue-chart?period=30d` | Daily revenue data |
| `/admin/analytics/tier-distribution` | Subscriber count per tier |
| `/admin/analytics/churn-chart?period=12m` | Monthly churn rates |

### 3.2 Admin Dashboard UI (3 days)

**Tech Stack:**
- Angular 21+ standalone components
- NgRx for state management
- Chart.js for visualizations
- Shared UI components from `@bitbonsai/shared-ui`

**Routes:**

```typescript
// apps/website-admin/src/app/app.routes.ts
export const routes: Routes = [
  {
    path: 'dashboard',
    loadComponent: () => import('./dashboard/dashboard.component'),
  },
  {
    path: 'licenses',
    loadComponent: () => import('./licenses/license-list.component'),
  },
  {
    path: 'licenses/:id',
    loadComponent: () => import('./licenses/license-detail.component'),
  },
  {
    path: 'pricing',
    loadComponent: () => import('./pricing/pricing-management.component'),
  },
  {
    path: 'promo-codes',
    loadComponent: () => import('./promo/promo-list.component'),
  },
  {
    path: 'donations',
    loadComponent: () => import('./donations/donation-list.component'),
  },
  {
    path: 'email-templates',
    loadComponent: () => import('./email/template-editor.component'),
  },
  {
    path: 'webhooks',
    loadComponent: () => import('./webhooks/webhook-log.component'),
  },
  {
    path: 'config',
    loadComponent: () => import('./config/config-management.component'),
  },
  {
    path: 'analytics',
    loadComponent: () => import('./analytics/analytics.component'),
  },
  {
    path: 'audit-log',
    loadComponent: () => import('./audit/audit-log.component'),
  },
];
```

**Dashboard Component (apps/website-admin/src/app/dashboard/dashboard.component.ts):**

```typescript
import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { BbStatCardComponent, BbCardComponent } from '@bitbonsai/shared-ui';
import { Chart, registerables } from 'chart.js';
import { RevenueMetrics } from '../models/revenue-metrics';
import { AnalyticsApiService } from '../services/analytics-api.service';

Chart.register(...registerables);

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, BbStatCardComponent, BbCardComponent],
  template: `
    <div class="dashboard">
      <h1 class="page-title">Revenue Dashboard</h1>

      <div class="metrics-grid">
        <bb-stat-card
          label="MRR"
          [value]="metrics?.mrr || 0"
          format="currency"
          icon="dollar-sign"
          [trend]="mrrTrend"
        />
        <bb-stat-card
          label="ARR"
          [value]="metrics?.arr || 0"
          format="currency"
          icon="trending-up"
        />
        <bb-stat-card
          label="Active Subscriptions"
          [value]="metrics?.activeSubscriptions || 0"
          icon="users"
        />
        <bb-stat-card
          label="Churn Rate"
          [value]="metrics?.churnRate || 0"
          format="percentage"
          icon="activity"
          [trend]="churnTrend"
        />
      </div>

      <div class="charts-grid">
        <bb-card title="Revenue (Last 30 Days)">
          <canvas #revenueChart></canvas>
        </bb-card>

        <bb-card title="Tier Distribution">
          <canvas #tierChart></canvas>
        </bb-card>
      </div>

      <div class="health-section">
        <bb-card title="Subscription Health">
          <div class="health-stats">
            <div class="health-stat healthy">
              <span class="count">{{ metrics?.subscriptionHealth.healthy }}</span>
              <span class="label">Healthy</span>
            </div>
            <div class="health-stat warning">
              <span class="count">{{ metrics?.subscriptionHealth.expiringSoon }}</span>
              <span class="label">Expiring Soon</span>
            </div>
            <div class="health-stat danger">
              <span class="count">{{ metrics?.subscriptionHealth.overdue }}</span>
              <span class="label">Overdue</span>
            </div>
          </div>
        </bb-card>
      </div>
    </div>
  `,
  styleUrls: ['./dashboard.component.scss'],
})
export class DashboardComponent implements OnInit {
  metrics?: RevenueMetrics;
  mrrTrend = { value: 12.5, direction: 'up' as const };
  churnTrend = { value: -2.1, direction: 'down' as const };

  constructor(private analyticsApi: AnalyticsApiService) {}

  async ngOnInit(): Promise<void> {
    this.metrics = await this.analyticsApi.getRevenueMetrics();
    this.renderCharts();
  }

  private renderCharts(): void {
    // Revenue chart implementation
    // Tier distribution chart implementation
  }
}
```

**Styling (apps/website-admin/src/app/dashboard/dashboard.component.scss):**

```scss
@use '@bitbonsai/shared-ui/styles/variables' as *;

.dashboard {
  padding: 2rem;
  background: $bg-primary;
  min-height: 100vh;
}

.page-title {
  color: $text-primary;
  font-size: 2rem;
  margin-bottom: 2rem;
}

.metrics-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
  gap: 1.5rem;
  margin-bottom: 2rem;
}

.charts-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(400px, 1fr));
  gap: 1.5rem;
  margin-bottom: 2rem;
}

.health-section {
  margin-top: 2rem;
}

.health-stats {
  display: flex;
  gap: 2rem;
  padding: 1rem;
}

.health-stat {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 1.5rem;
  border-radius: 8px;
  border: 1px solid $border-primary;
  background: $bg-tertiary;
  flex: 1;

  .count {
    font-size: 2rem;
    font-weight: bold;
    margin-bottom: 0.5rem;
  }

  .label {
    color: $text-secondary;
    font-size: 0.9rem;
  }

  &.healthy .count {
    color: $success;
  }

  &.warning .count {
    color: $warning;
  }

  &.danger .count {
    color: $danger;
  }
}
```

### 3.3 License Management UI (1 day)

**Features:**
- List all licenses (with filters: active, cancelled, expired)
- View license details + activation history
- Manual license creation (for giveaways, influencers)
- Deactivate/reactivate licenses
- Send license emails manually

**License List Component (apps/website-admin/src/app/licenses/license-list.component.ts):**

```typescript
@Component({
  selector: 'app-license-list',
  standalone: true,
  imports: [CommonModule, BbTableComponent, BbButtonComponent, BbBadgeComponent],
  template: `
    <div class="license-list">
      <div class="header">
        <h1>Licenses</h1>
        <bb-button (click)="createManualLicense()">
          Create Manual License
        </bb-button>
      </div>

      <bb-table
        [columns]="columns"
        [data]="licenses"
        [loading]="loading"
        (rowClick)="viewLicense($event)"
      >
        <ng-template #statusCell let-row>
          <bb-badge [variant]="getBadgeVariant(row.status)">
            {{ row.status }}
          </bb-badge>
        </ng-template>
      </bb-table>
    </div>
  `,
})
export class LicenseListComponent implements OnInit {
  columns = [
    { key: 'email', label: 'Email' },
    { key: 'tier', label: 'Tier' },
    { key: 'status', label: 'Status', template: 'statusCell' },
    { key: 'createdAt', label: 'Created', pipe: 'date' },
    { key: 'expiresAt', label: 'Expires', pipe: 'date' },
  ];

  licenses: License[] = [];
  loading = true;

  constructor(
    private licenseApi: LicenseApiService,
    private dialog: MatDialog,
  ) {}

  async ngOnInit(): Promise<void> {
    this.licenses = await this.licenseApi.getAll();
    this.loading = false;
  }

  getBadgeVariant(status: string): 'success' | 'warning' | 'danger' {
    if (status === 'ACTIVE') return 'success';
    if (status === 'EXPIRED') return 'warning';
    return 'danger';
  }

  createManualLicense(): void {
    this.dialog.open(CreateLicenseDialogComponent, {
      width: '500px',
    });
  }

  viewLicense(license: License): void {
    // Navigate to detail page
  }
}
```

### 3.4 Email Template Editor (1 day)

**Features:**
- WYSIWYG editor for HTML emails
- Variable insertion: `{{email}}`, `{{licenseKey}}`, `{{expiresAt}}`
- Preview mode
- Test send

**Template Editor (apps/website-admin/src/app/email/template-editor.component.ts):**

```typescript
import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { BbButtonComponent, BbFormFieldComponent } from '@bitbonsai/shared-ui';
import { QuillModule } from 'ngx-quill';

@Component({
  selector: 'app-template-editor',
  standalone: true,
  imports: [CommonModule, FormsModule, QuillModule, BbButtonComponent, BbFormFieldComponent],
  template: `
    <div class="template-editor">
      <h1>Email Templates</h1>

      <div class="template-selector">
        <bb-form-field label="Template">
          <select [(ngModel)]="selectedTemplateKey" (change)="loadTemplate()">
            <option value="LICENSE_CREATED">License Created</option>
            <option value="LICENSE_EXPIRING">License Expiring Soon</option>
            <option value="KOFI_THANK_YOU">Ko-fi Thank You</option>
          </select>
        </bb-form-field>
      </div>

      <div class="editor-container">
        <bb-form-field label="Subject">
          <input [(ngModel)]="template.subject" />
        </bb-form-field>

        <label>HTML Body</label>
        <quill-editor
          [(ngModel)]="template.htmlBody"
          [modules]="quillModules"
          [styles]="{ height: '400px' }"
        />

        <div class="variables-help">
          <strong>Available Variables:</strong>
          <code>{{email}}</code> <code>{{licenseKey}}</code> <code>{{expiresAt}}</code>
        </div>
      </div>

      <div class="actions">
        <bb-button (click)="preview()">Preview</bb-button>
        <bb-button (click)="sendTest()">Send Test</bb-button>
        <bb-button variant="primary" (click)="save()">Save Template</bb-button>
      </div>
    </div>
  `,
  styleUrls: ['./template-editor.component.scss'],
})
export class TemplateEditorComponent implements OnInit {
  selectedTemplateKey = 'LICENSE_CREATED';
  template = {
    subject: '',
    htmlBody: '',
  };

  quillModules = {
    toolbar: [
      ['bold', 'italic', 'underline'],
      [{ 'list': 'ordered'}, { 'list': 'bullet' }],
      ['link'],
    ],
  };

  constructor(private emailApi: EmailApiService) {}

  async ngOnInit(): Promise<void> {
    await this.loadTemplate();
  }

  async loadTemplate(): Promise<void> {
    this.template = await this.emailApi.getTemplate(this.selectedTemplateKey);
  }

  async save(): Promise<void> {
    await this.emailApi.updateTemplate(this.selectedTemplateKey, this.template);
  }

  preview(): void {
    // Show preview dialog with sample data
  }

  sendTest(): void {
    // Open dialog to enter test email address
  }
}
```

### 3.5 Refund Management (0.5 days)

**Refund Service (apps/license-api/src/refunds/refund.service.ts):**

```typescript
export class RefundService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stripe: Stripe,
    private readonly patreonService: PatreonService,
    private readonly auditService: AuditService,
  ) {}

  async processRefund(licenseId: string, reason: string, adminUserId: string): Promise<void> {
    return this.prisma.$transaction(async (tx) => {
      const license = await tx.license.findUnique({ where: { id: licenseId } });

      if (!license) {
        throw new NotFoundException('License not found');
      }

      // Call provider API
      if (license.provider === 'STRIPE') {
        await this.refundStripeSubscription(license.providerCustomerId!);
      } else if (license.provider === 'PATREON') {
        // Patreon doesn't have refund API - admin must process manually on patreon.com
        this.logger.warn('Patreon refund must be processed manually');
      }

      // Mark license as cancelled
      await tx.license.update({
        where: { id: licenseId },
        data: { status: 'CANCELLED' },
      });

      // Audit log
      await tx.auditLog.create({
        data: {
          action: 'REFUND_LICENSE',
          entityType: 'LICENSE',
          entityId: licenseId,
          userId: adminUserId,
          changes: { reason },
        },
      });
    });
  }

  private async refundStripeSubscription(customerId: string): Promise<void> {
    const subscriptions = await this.stripe.subscriptions.list({ customer: customerId });

    if (subscriptions.data.length > 0) {
      const subscription = subscriptions.data[0];
      await this.stripe.subscriptions.cancel(subscription.id);

      // Refund latest invoice
      const invoices = await this.stripe.invoices.list({ customer: customerId, limit: 1 });
      if (invoices.data.length > 0 && invoices.data[0].payment_intent) {
        await this.stripe.refunds.create({
          payment_intent: invoices.data[0].payment_intent as string,
        });
      }
    }
  }
}
```

**Admin UI:**
- "Refund" button on license detail page
- Confirmation dialog with reason field
- Displays refund status (success, pending manual action for Patreon)

### 3.6 Webhook Event Replay (0.5 days)

**Replay Service (apps/license-api/src/webhooks/replay.service.ts):**

```typescript
export class WebhookReplayService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stripeController: StripeController,
    private readonly patreonController: PatreonController,
  ) {}

  async replayEvent(eventId: string, adminUserId: string): Promise<void> {
    const event = await this.prisma.webhookEvent.findUnique({ where: { id: eventId } });

    if (!event) {
      throw new NotFoundException('Webhook event not found');
    }

    // Re-process the webhook
    if (event.provider === 'STRIPE') {
      // Reconstruct Stripe event object
      const stripeEvent: Stripe.Event = {
        id: event.providerEventId,
        type: event.eventType,
        data: event.rawPayload as any,
      } as Stripe.Event;

      await this.stripeController.handleWebhook(
        'REPLAY', // Dummy signature (bypass verification for replay)
        { rawBody: Buffer.from(JSON.stringify(stripeEvent)) } as any,
      );
    } else if (event.provider === 'PATREON') {
      await this.patreonController.handleWebhook(
        'REPLAY',
        event.eventType,
        event.rawPayload as any,
        {} as any,
      );
    }

    // Mark as replayed in audit log
    await this.prisma.auditLog.create({
      data: {
        action: 'REPLAY_WEBHOOK',
        entityType: 'WEBHOOK_EVENT',
        entityId: eventId,
        userId: adminUserId,
      },
    });
  }
}
```

**Admin UI:**
- Webhook log page shows all events (with status: success, failed, pending)
- "Replay" button for failed events
- Shows event payload (JSON viewer)

---

## Phase 4: Marketing Website (4 days)

### 4.1 Website App Setup (0.5 days)

**Create Website App:**

```bash
npx nx g @nx/angular:app website --routing --style=scss --standalone
```

**Structure:**

```
apps/website/
├── src/
│   ├── app/
│   │   ├── pages/
│   │   │   ├── home/
│   │   │   ├── features/
│   │   │   ├── pricing/
│   │   │   ├── download/
│   │   │   └── docs/
│   │   ├── shared/
│   │   │   ├── header/
│   │   │   ├── footer/
│   │   │   └── cta-section/
│   │   ├── app.routes.ts
│   │   └── app.component.ts
│   ├── styles/
│   │   ├── _variables.scss    # Import from shared-ui
│   │   └── styles.scss
```

### 4.2 Home Page (1 day)

**Hero Section:**

```html
<section class="hero">
  <div class="container">
    <h1 class="hero-title">
      Transform Your Video Library to <span class="accent">HEVC/AV1</span>
    </h1>
    <p class="hero-subtitle">
      Multi-node transcoding platform that saves 40-60% storage with zero quality loss
    </p>
    <div class="hero-actions">
      <a routerLink="/download" class="btn btn-primary">Download Free</a>
      <a routerLink="/pricing" class="btn btn-outline">View Pricing</a>
    </div>
  </div>
</section>
```

**Features Section:**

| Feature | Description |
|---------|-------------|
| Multi-Node Scaling | Add worker nodes via NFS for horizontal scaling |
| Auto-Healing | Recovers from failures without manual intervention |
| Smart Encoding | Preserves quality while reducing file size 40-60% |
| Zero Configuration | Works out-of-the-box with intelligent defaults |

**Stats Section:**

```html
<section class="stats">
  <div class="stat">
    <span class="stat-value">40-60%</span>
    <span class="stat-label">Storage Savings</span>
  </div>
  <div class="stat">
    <span class="stat-value">100%</span>
    <span class="stat-label">Quality Preserved</span>
  </div>
  <div class="stat">
    <span class="stat-value">0</span>
    <span class="stat-label">Config Required</span>
  </div>
</section>
```

### 4.3 Pricing Page (1.5 days)

**Dynamic Pricing from Database:**

```typescript
@Component({
  selector: 'app-pricing',
  standalone: true,
  imports: [CommonModule, BbCardComponent, BbButtonComponent],
  template: `
    <div class="pricing-page">
      <h1>Choose Your Plan</h1>
      <p class="subtitle">Start free, upgrade when you need more power</p>

      <div class="pricing-grid">
        <div *ngFor="let tier of tiers" class="pricing-card">
          <bb-card>
            <h3>{{ tier.displayName }}</h3>
            <p class="description">{{ tier.description }}</p>

            <div class="price">
              <span class="amount">\${{ tier.priceMonthly / 100 }}</span>
              <span class="period">/month</span>
            </div>

            <ul class="features">
              <li>{{ tier.maxNodes }} nodes</li>
              <li>{{ tier.maxConcurrentJobs }} concurrent jobs</li>
              <li>Auto-healing</li>
              <li>Email support</li>
            </ul>

            <bb-button (click)="selectPlan(tier)" [variant]="tier.name === 'FREE' ? 'outline' : 'primary'">
              {{ tier.name === 'FREE' ? 'Download' : 'Subscribe' }}
            </bb-button>
          </bb-card>
        </div>
      </div>

      <div class="promo-section">
        <input [(ngModel)]="promoCode" placeholder="Promo code" />
        <bb-button (click)="applyPromo()">Apply</bb-button>
        <span *ngIf="discount" class="discount-applied">
          {{ discount.discountValue }}% off applied!
        </span>
      </div>
    </div>
  `,
})
export class PricingComponent implements OnInit {
  tiers: PricingTier[] = [];
  promoCode = '';
  discount: PromoCode | null = null;

  constructor(
    private pricingApi: PricingApiService,
    private promoApi: PromoApiService,
  ) {}

  async ngOnInit(): Promise<void> {
    this.tiers = await this.pricingApi.getActiveTiers();
  }

  async applyPromo(): Promise<void> {
    const result = await this.promoApi.validate(this.promoCode);
    if (result.valid) {
      this.discount = result.promo;
    }
  }

  selectPlan(tier: PricingTier): void {
    if (tier.name === 'FREE') {
      // Redirect to download page
    } else {
      // Redirect to Stripe checkout with tier + promo
      this.checkoutService.createSession(tier, this.discount);
    }
  }
}
```

**Stripe Checkout Integration:**

```typescript
export class CheckoutService {
  async createSession(tier: PricingTier, promo?: PromoCode): Promise<void> {
    const response = await this.http.post('/checkout/create-session', {
      priceId: tier.stripePriceIdMonthly,
      promoCode: promo?.code,
    }).toPromise();

    // Redirect to Stripe
    window.location.href = response.url;
  }
}
```

### 4.4 Download Page (0.5 days)

**Features:**
- Download links for Windows, macOS, Linux (Docker Compose)
- Installation instructions
- Quickstart guide
- License key input (after purchase)

**Download Component:**

```typescript
@Component({
  selector: 'app-download',
  template: `
    <div class="download-page">
      <h1>Download BitBonsai</h1>

      <div class="download-options">
        <bb-card>
          <h3>Docker Compose (Recommended)</h3>
          <p>Works on any Linux server with Docker</p>
          <bb-button (click)="downloadDocker()">Download</bb-button>
        </bb-card>

        <bb-card>
          <h3>Windows</h3>
          <p>Standalone installer for Windows 10+</p>
          <bb-button disabled>Coming Soon</bb-button>
        </bb-card>

        <bb-card>
          <h3>macOS</h3>
          <p>DMG installer for macOS 12+</p>
          <bb-button disabled>Coming Soon</bb-button>
        </bb-card>
      </div>

      <div class="quickstart">
        <h2>Quickstart</h2>
        <pre><code>
# 1. Extract and configure
tar -xzf bitbonsai-latest.tar.gz
cd bitbonsai
cp .env.example .env

# 2. Start services
docker-compose up -d

# 3. Open browser
http://localhost:4210
        </code></pre>
      </div>

      <div class="license-section">
        <h2>Activate License</h2>
        <p>After purchasing, enter your license key in the UI: Settings → License</p>
      </div>
    </div>
  `,
})
export class DownloadComponent {
  downloadDocker(): void {
    window.location.href = 'https://github.com/bitbonsai/bitbonsai/releases/latest';
  }
}
```

### 4.5 Documentation (0.5 days)

**Docs Structure:**

```
apps/website/src/app/pages/docs/
├── getting-started/
├── multi-node-setup/
├── encoding-settings/
├── troubleshooting/
└── api-reference/
```

**Markdown Rendering:**

```typescript
import { MarkdownModule } from 'ngx-markdown';

@Component({
  selector: 'app-docs',
  standalone: true,
  imports: [CommonModule, MarkdownModule],
  template: `
    <div class="docs-layout">
      <aside class="sidebar">
        <nav>
          <a routerLink="/docs/getting-started">Getting Started</a>
          <a routerLink="/docs/multi-node">Multi-Node Setup</a>
          <a routerLink="/docs/settings">Encoding Settings</a>
        </nav>
      </aside>

      <main class="content">
        <markdown [src]="currentDoc"></markdown>
      </main>
    </div>
  `,
})
export class DocsComponent {
  currentDoc = 'assets/docs/getting-started.md';
}
```

---

## Phase 5: Docker Deployment (2 days)

### 5.1 Docker Compose Configuration (1 day)

**File: `apps/license-api/docker-compose.yml`**

```yaml
version: '3.8'

services:
  license-api:
    image: bitbonsai/license-api:${VERSION:-latest}
    build:
      context: .
      dockerfile: Dockerfile
    ports:
      - "3100:3100"
    environment:
      NODE_ENV: production
      DATABASE_URL: postgresql://postgres:${DB_PASSWORD}@postgres:5432/bitbonsai_licenses
      ENCRYPTION_KEY: ${ENCRYPTION_KEY}
      # Stripe
      STRIPE_SECRET_KEY: ${STRIPE_SECRET_KEY}
      STRIPE_WEBHOOK_SECRET: ${STRIPE_WEBHOOK_SECRET}
      STRIPE_PRODUCT_ID: ${STRIPE_PRODUCT_ID}
      # Patreon
      PATREON_CLIENT_ID: ${PATREON_CLIENT_ID}
      PATREON_CLIENT_SECRET: ${PATREON_CLIENT_SECRET}
      PATREON_WEBHOOK_SECRET: ${PATREON_WEBHOOK_SECRET}
      # Email
      RESEND_API_KEY: ${RESEND_API_KEY}
      # Admin
      ADMIN_API_KEY: ${ADMIN_API_KEY}
    depends_on:
      postgres:
        condition: service_healthy
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3100/health"]
      interval: 30s
      timeout: 10s
      retries: 3

  website:
    image: bitbonsai/website:${VERSION:-latest}
    build:
      context: .
      dockerfile: apps/website/Dockerfile
    ports:
      - "4210:80"
    restart: unless-stopped

  website-admin:
    image: bitbonsai/website-admin:${VERSION:-latest}
    build:
      context: .
      dockerfile: apps/website-admin/Dockerfile
    ports:
      - "4220:80"
    environment:
      API_URL: http://license-api:3100
    restart: unless-stopped

  postgres:
    image: postgres:15-alpine
    environment:
      POSTGRES_DB: bitbonsai_licenses
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: ${DB_PASSWORD}
    volumes:
      - postgres_data:/var/lib/postgresql/data
    ports:
      - "5433:5432"
    restart: unless-stopped
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 10s
      timeout: 5s
      retries: 5

volumes:
  postgres_data:
```

**Dockerfile for License API:**

```dockerfile
FROM node:20-alpine AS builder

WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production

COPY . .
RUN npx nx build license-api --prod

FROM node:20-alpine

WORKDIR /app
COPY --from=builder /app/dist/apps/license-api ./
COPY --from=builder /app/node_modules ./node_modules
COPY apps/license-api/prisma ./prisma

RUN npx prisma generate

EXPOSE 3100

CMD ["sh", "-c", "npx prisma migrate deploy && node main.js"]
```

**Dockerfile for Website (Angular SSR):**

```dockerfile
FROM node:20-alpine AS builder

WORKDIR /app
COPY package*.json ./
RUN npm ci

COPY . .
RUN npx nx build website --prod --output-path=dist/website

FROM nginx:alpine

COPY --from=builder /app/dist/website /usr/share/nginx/html
COPY apps/website/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
```

### 5.2 Environment Variables & Secrets (0.5 days)

**File: `.env.example`**

```bash
# Database
DB_PASSWORD=changeme_secure_password

# Encryption (generate with: openssl rand -hex 32)
ENCRYPTION_KEY=changeme_64_char_hex_key

# Stripe
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRODUCT_ID=prod_...

# Patreon
PATREON_CLIENT_ID=...
PATREON_CLIENT_SECRET=...
PATREON_WEBHOOK_SECRET=...

# Email
RESEND_API_KEY=re_...

# Admin
ADMIN_API_KEY=changeme_secure_key

# Versioning
VERSION=1.0.0
```

**Secrets Management:**
- Use `.env.local` for local development (gitignored)
- Production: Use Docker secrets or environment variables from hosting provider

### 5.3 Deployment Scripts (0.5 days)

**File: `scripts/deploy.sh`**

```bash
#!/bin/bash

set -e

VERSION=${1:-latest}

echo "Building Docker images for version $VERSION..."

docker-compose build \
  --build-arg VERSION=$VERSION

echo "Tagging images..."
docker tag bitbonsai/license-api:latest bitbonsai/license-api:$VERSION
docker tag bitbonsai/website:latest bitbonsai/website:$VERSION
docker tag bitbonsai/website-admin:latest bitbonsai/website-admin:$VERSION

echo "Pushing to registry..."
docker push bitbonsai/license-api:$VERSION
docker push bitbonsai/website:$VERSION
docker push bitbonsai/website-admin:$VERSION

echo "Deployment complete!"
echo "Update docker-compose.yml VERSION=$VERSION and run: docker-compose up -d"
```

**Usage:**

```bash
# Build and tag version 1.0.0
./scripts/deploy.sh 1.0.0

# Deploy on production server
VERSION=1.0.0 docker-compose up -d
```

---

## Phase 5.5: Monitoring Setup (0.5 days)

### PM2 Process Management

**File: `apps/license-api/ecosystem.config.js`**

```javascript
module.exports = {
  apps: [
    {
      name: 'license-api',
      script: 'dist/apps/license-api/main.js',
      instances: 2,
      exec_mode: 'cluster',
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production',
        PORT: 3100,
      },
      error_file: 'logs/err.log',
      out_file: 'logs/out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
    },
  ],
};
```

**PM2 Commands:**

```bash
# Start
pm2 start ecosystem.config.js

# Monitor
pm2 monit

# Logs
pm2 logs license-api --lines 100

# Restart
pm2 restart license-api

# View status
pm2 status
```

### Uptime Robot Configuration

**Monitors to Create:**

| Monitor | Type | URL | Alert Threshold |
|---------|------|-----|-----------------|
| License API Health | HTTP(s) | https://api.bitbonsai.io/health | 5 minutes downtime |
| Website | HTTP(s) | https://bitbonsai.io | 5 minutes downtime |
| Admin Dashboard | HTTP(s) | https://admin.bitbonsai.io | 5 minutes downtime |
| Stripe Webhooks | Keyword | https://api.bitbonsai.io/webhooks/stripe | (monitor 200 response) |

**Alert Channels:**
- Email notifications
- Slack webhook (optional)

**File: `MONITORING.md`**

```markdown
# Monitoring Setup Guide

## PM2 Setup

1. Install PM2 globally:
   \`\`\`bash
   npm install -g pm2
   \`\`\`

2. Start license-api:
   \`\`\`bash
   cd apps/license-api
   pm2 start ecosystem.config.js
   \`\`\`

3. Enable startup script:
   \`\`\`bash
   pm2 startup
   pm2 save
   \`\`\`

## Uptime Robot Setup

1. Create account at https://uptimerobot.com
2. Add monitors:
   - **License API Health**: https://api.bitbonsai.io/health
   - **Website**: https://bitbonsai.io
   - **Admin**: https://admin.bitbonsai.io
3. Set alert contacts (email/Slack)
4. Configure 5-minute check intervals

## Logs

PM2 logs location: `apps/license-api/logs/`

View logs:
\`\`\`bash
pm2 logs license-api --lines 100
\`\`\`

Rotate logs (prevent disk fill):
\`\`\`bash
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 7
\`\`\`
```

---

## Testing Strategy

### Unit Tests (100% Coverage)

**License Service Tests:**

```typescript
// apps/license-api/src/license/license.service.spec.ts
describe('LicenseService', () => {
  it('should create license with correct tier limits', async () => {
    const license = await service.createLicense({
      email: 'test@example.com',
      tier: LicenseTier.COMMERCIAL_PRO,
    });

    expect(license.maxNodes).toBe(50);
    expect(license.maxConcurrentJobs).toBe(100);
  });

  it('should prevent duplicate activations on same machine', async () => {
    const license = await createTestLicense();
    await service.activateLicense(license.key, 'machine-123');

    await expect(
      service.activateLicense(license.key, 'machine-123')
    ).rejects.toThrow('Already activated');
  });
});
```

**Pricing Service Tests:**

```typescript
describe('PricingService', () => {
  it('should create Stripe prices on publish', async () => {
    const tier = await createTestTier();

    const stripeMock = jest.spyOn(stripe.prices, 'create').mockResolvedValue({
      id: 'price_123',
    } as any);

    await service.publishTier(tier.id, 'admin-user');

    expect(stripeMock).toHaveBeenCalledWith({
      unit_amount: tier.priceMonthly,
      currency: 'usd',
      recurring: { interval: 'month' },
      product: expect.any(String),
    });
  });
});
```

### E2E Tests

**Webhook Processing:**

```typescript
// apps/license-api/test/webhooks.e2e-spec.ts
describe('Stripe Webhooks (E2E)', () => {
  it('should create license on checkout.session.completed', async () => {
    const payload = createStripeCheckoutEvent({
      customer_email: 'test@example.com',
      subscription: 'sub_123',
    });

    const signature = signStripePayload(payload);

    await request(app.getHttpServer())
      .post('/webhooks/stripe')
      .set('stripe-signature', signature)
      .send(payload)
      .expect(200);

    const license = await prisma.license.findUnique({
      where: { email: 'test@example.com' },
    });

    expect(license).toBeDefined();
    expect(license.status).toBe('ACTIVE');
  });
});
```

---

## Security Checklist

| Security Measure | Status |
|------------------|--------|
| Webhook signature verification (Stripe) | ✅ Implemented |
| Webhook signature verification (Patreon) | ✅ Implemented (MD5) |
| Rate limiting (30 req/min on webhooks) | ✅ Implemented |
| CORS configuration | ✅ Implemented |
| Helmet security headers | ✅ Implemented |
| HSTS enforcement | ✅ Implemented |
| Encrypted config storage | ✅ Implemented (AES-256-GCM) |
| Admin API key authentication | ✅ Implemented |
| Audit logging | ✅ Implemented |
| SQL injection prevention (Prisma) | ✅ ORM-based queries |
| XSS prevention (Angular) | ✅ Built-in sanitization |
| Database transactions (prevent race conditions) | ✅ Implemented |

---

## Future Enhancements (v8)

| Feature | Complexity | Value |
|---------|-----------|-------|
| Patreon API automation (tier detection) | Medium | High |
| BullMQ webhook retry queue | Medium | Medium |
| Subscription analytics dashboard (churn prediction) | High | Medium |
| Multi-language support (i18n for website) | Medium | Low |
| License transfer system (change machine) | Low | Medium |
| API rate limiting per license tier | Low | Low |

---

## Timeline Summary

| Phase | Duration | Tasks |
|-------|----------|-------|
| Phase 0: Shared UI Library | 1 day | Extract components from BitBonsai frontend |
| Phase 1: License API Enhancements | 4 days | Pricing, promos, donations, config, audit |
| Phase 2: BitBonsai Integration | 2 days | License storage in DB, verification client, guards |
| Phase 3: Admin Dashboard | 7 days | Analytics, UI, license mgmt, emails, refunds, webhooks |
| Phase 4: Marketing Website | 4 days | Home, pricing, download, docs |
| Phase 5: Docker Deployment | 2 days | Docker Compose, Dockerfiles, scripts |
| Phase 5.5: Monitoring | 0.5 days | PM2, Uptime Robot, MONITORING.md |
| **TOTAL** | **20.5 days** | |

---

## Developer Handoff

### Repository Structure

```
bitbonsai/
├── apps/
│   ├── license-api/              # Remote license provider (NestJS)
│   ├── website/                  # Marketing site (Angular)
│   ├── website-admin/            # Admin dashboard (Angular)
│   └── backend/                  # Local BitBonsai consumer (NestJS)
├── libs/
│   └── shared-ui/                # Reusable UI components
├── docker-compose.yml            # Production deployment
├── .env.example                  # Environment template
└── MONITORING.md                 # PM2 + Uptime Robot guide
```

### Environment Setup

```bash
# 1. Install dependencies
npm install

# 2. Setup databases
cd apps/license-api
npx prisma migrate dev

cd ../backend
npx prisma migrate dev

# 3. Start development servers
nx serve license-api          # http://localhost:3100
nx serve website              # http://localhost:4210
nx serve website-admin        # http://localhost:4220
```

### Code Conventions

Follow conventions from `~/git/code-conventions`:
- **NgRx** for state management
- **Standalone components** (no modules except root)
- **Signals** for local reactive state
- **BOs (Business Objects)** for business logic
- **100% test coverage** requirement
- **i18n** support (not in v7, prepare for v8)

### Color Scheme (Golden Dark Theme)

```scss
$accent-primary: #f9be03;         // Golden yellow
$bg-primary: #1a1a1a;             // Darkest background
$bg-secondary: #252525;           // Cards
$success: #4ade80;
$danger: #ff6b6b;
```

### Deployment

```bash
# Build version 1.0.0
./scripts/deploy.sh 1.0.0

# Deploy on production
VERSION=1.0.0 docker-compose up -d
```

---

**End of v7 FINAL Plan**
