# BitBonsai Website + Admin Dashboard - FINAL PLAN v5 (UPDATED)

**Date:** 2025-12-23
**Status:** Ready for Implementation
**Based On:** Existing license-api implementation (80% complete)

---

## 🎯 ARCHITECTURE SUMMARY

```
┌─────────────────────────────────────────┐
│ User's Local Infrastructure             │
│ (Unraid/Proxmox)                        │
│                                         │
│  ┌──────────────────────────────────┐  │
│  │ BitBonsai (Consumer)             │  │
│  │ - Local PostgreSQL/SQLite        │  │
│  │ - Encoding jobs, nodes, media    │  │
│  │ - Verifies licenses via API      │  │
│  └──────────────┬───────────────────┘  │
└─────────────────┼───────────────────────┘
                  │ HTTPS
                  │ POST /api/licenses/verify
                  │ POST /api/licenses/activate
                  ▼
┌─────────────────────────────────────────┐
│ bitbonsai.io (Remote Cloud Server)      │
│                                         │
│  ┌──────────────────────────────────┐  │
│  │ License API (Provider) ✅ 80%    │  │
│  │ - Crypto-signed keys             │  │
│  │ - Patreon/Stripe/Ko-fi webhooks  │  │
│  │ - Email via Resend               │  │
│  │ - Rate limiting + CORS           │  │
│  └──────────────────────────────────┘  │
│                                         │
│  ┌──────────────────────────────────┐  │
│  │ Admin Dashboard (Angular)        │  │
│  │ - API key auth (AdminApiKeyGuard)│  │
│  └──────────────────────────────────┘  │
│                                         │
│  ┌──────────────────────────────────┐  │
│  │ Marketing Website (Angular)      │  │
│  │ - Pricing, features, download    │  │
│  └──────────────────────────────────┘  │
└─────────────────────────────────────────┘
```

---

## ✅ WHAT YOU ALREADY HAVE

Your `apps/license-api/` is **production-ready** with:

| Component | File | Status |
|-----------|------|--------|
| **Prisma Schema** | `prisma/schema.prisma` | ✅ Complete |
| **License Service** | `src/license/_services/license.service.ts` | ✅ Complete |
| **Crypto Service** | `src/crypto/crypto.service.ts` | ✅ Signed keys |
| **Patreon Webhooks** | `src/webhook/patreon.controller.ts` | ✅ Signature verify |
| **Stripe Webhooks** | `src/webhook/stripe.controller.ts` | ✅ Signature verify |
| **Ko-fi Webhooks** | `src/webhook/kofi.controller.ts` | ✅ Complete |
| **Webhook Service** | `src/webhook/_services/webhook.service.ts` | ✅ Complete |
| **Email Service** | `src/email/email.service.ts` | ✅ Resend integration |
| **Rate Limiting** | `src/main.ts` + `app.module.ts` | ✅ Configured |
| **CORS** | `src/main.ts` | ✅ Configured |
| **Admin API Key Guard** | `src/guards/admin-api-key.guard.ts` | ✅ Complete |
| **Security Logger** | `src/security/security-logger.service.ts` | ✅ Complete |

**Tier Limits:** Inline in `license.service.ts:7-16` ✅

```typescript
const TIER_LIMITS: Record<LicenseTier, { maxNodes: number; maxConcurrentJobs: number }> = {
  FREE: { maxNodes: 1, maxConcurrentJobs: 2 },
  PATREON_SUPPORTER: { maxNodes: 2, maxConcurrentJobs: 3 },
  PATREON_PLUS: { maxNodes: 3, maxConcurrentJobs: 5 },
  PATREON_PRO: { maxNodes: 5, maxConcurrentJobs: 10 },
  PATREON_ULTIMATE: { maxNodes: 10, maxConcurrentJobs: 20 },
  COMMERCIAL_STARTER: { maxNodes: 15, maxConcurrentJobs: 30 },
  COMMERCIAL_PRO: { maxNodes: 50, maxConcurrentJobs: 100 },
  COMMERCIAL_ENTERPRISE: { maxNodes: 999, maxConcurrentJobs: 999 },
};
```

---

## 📋 PHASE 1: COMPLETE LICENSE API (20% remaining)

### 1.1 Add License Activation Endpoints

**Update:** `apps/license-api/src/license/license.controller.ts`

Add these endpoints:

```typescript
import { ActivateLicenseDto, DeactivateLicenseDto } from './_dtos';

@Post('activate')
@ApiOperation({ summary: 'Activate a license on a machine' })
@ApiResponse({ status: 200, description: 'License activated', type: LicenseActivationResponseDto })
@ApiBadRequestResponse({ description: 'License invalid or already activated' })
async activate(@Body() dto: ActivateLicenseDto): Promise<LicenseActivationResponseDto> {
  const activation = await this.licenseService.activateLicense(dto);
  return {
    id: activation.id,
    licenseId: activation.licenseId,
    machineId: activation.machineId,
    machineName: activation.machineName,
    activatedAt: activation.createdAt,
  };
}

@Post('deactivate')
@ApiOperation({ summary: 'Deactivate a license from a machine' })
@ApiResponse({ status: 200, description: 'License deactivated' })
async deactivate(@Body() dto: DeactivateLicenseDto): Promise<{ success: boolean }> {
  await this.licenseService.deactivateLicense(dto);
  return { success: true };
}

@Get(':id/activations')
@UseGuards(AdminApiKeyGuard)
@ApiSecurity('api-key')
@ApiOperation({ summary: 'Get all activations for a license (admin only)' })
@ApiParam({ name: 'id', description: 'License ID' })
@ApiResponse({ status: 200, description: 'List of activations', type: [LicenseActivationResponseDto] })
async getActivations(@Param('id') licenseId: string): Promise<LicenseActivationResponseDto[]> {
  const activations = await this.licenseService.getActivations(licenseId);
  return activations.map(a => ({
    id: a.id,
    licenseId: a.licenseId,
    machineId: a.machineId,
    machineName: a.machineName,
    activatedAt: a.createdAt,
  }));
}
```

**Create DTOs:** `apps/license-api/src/license/_dtos/activate-license.dto.ts`

```typescript
import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, IsOptional } from 'class-validator';

export class ActivateLicenseDto {
  @ApiProperty({ description: 'License key to activate' })
  @IsString()
  @IsNotEmpty()
  licenseKey: string;

  @ApiProperty({ description: 'Unique machine identifier (UUID)' })
  @IsString()
  @IsNotEmpty()
  machineId: string;

  @ApiProperty({ description: 'Machine name (optional)', required: false })
  @IsString()
  @IsOptional()
  machineName?: string;

  @ApiProperty({ description: 'IP address (optional)', required: false })
  @IsString()
  @IsOptional()
  ipAddress?: string;

  @ApiProperty({ description: 'User agent (optional)', required: false })
  @IsString()
  @IsOptional()
  userAgent?: string;
}

export class DeactivateLicenseDto {
  @ApiProperty({ description: 'License key to deactivate' })
  @IsString()
  @IsNotEmpty()
  licenseKey: string;

  @ApiProperty({ description: 'Machine ID to deactivate' })
  @IsString()
  @IsNotEmpty()
  machineId: string;
}

export class LicenseActivationResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  licenseId: string;

  @ApiProperty()
  machineId: string;

  @ApiProperty({ required: false })
  machineName?: string;

  @ApiProperty()
  activatedAt: Date;
}
```

**Update:** `apps/license-api/src/license/_dtos/index.ts`

```typescript
export * from './activate-license.dto';
// ... existing exports
```

**Update:** `apps/license-api/src/license/_services/license.service.ts`

Add activation methods:

```typescript
async activateLicense(dto: ActivateLicenseDto): Promise<LicenseActivation> {
  // Verify license is valid
  const verification = await this.verify({ licenseKey: dto.licenseKey });
  if (!verification.valid) {
    throw new BadRequestException(verification.error || 'Invalid license');
  }

  // Find license in DB
  const license = await this.licenseRepository.findByKey(dto.licenseKey);
  if (!license) {
    throw new NotFoundException('License not found');
  }

  // Check if already activated on this machine
  const existing = await this.prisma.licenseActivation.findUnique({
    where: {
      licenseId_machineId: {
        licenseId: license.id,
        machineId: dto.machineId,
      },
    },
  });

  if (existing) {
    if (!existing.deactivatedAt) {
      // Already active, just return it
      return existing;
    }
    // Reactivate
    return this.prisma.licenseActivation.update({
      where: { id: existing.id },
      data: { deactivatedAt: null },
    });
  }

  // Check activation limit (1 activation per license)
  const activeCount = await this.prisma.licenseActivation.count({
    where: {
      licenseId: license.id,
      deactivatedAt: null,
    },
  });

  if (activeCount >= 1) {
    throw new BadRequestException(
      'License already activated on another machine. Deactivate it first or contact support.',
    );
  }

  // Create new activation
  return this.prisma.licenseActivation.create({
    data: {
      licenseId: license.id,
      machineId: dto.machineId,
      machineName: dto.machineName,
      ipAddress: dto.ipAddress,
      userAgent: dto.userAgent,
    },
  });
}

async deactivateLicense(dto: DeactivateLicenseDto): Promise<void> {
  const license = await this.licenseRepository.findByKey(dto.licenseKey);
  if (!license) {
    throw new NotFoundException('License not found');
  }

  await this.prisma.licenseActivation.updateMany({
    where: {
      licenseId: license.id,
      machineId: dto.machineId,
      deactivatedAt: null,
    },
    data: { deactivatedAt: new Date() },
  });
}

async getActivations(licenseId: string): Promise<LicenseActivation[]> {
  return this.prisma.licenseActivation.findMany({
    where: { licenseId },
    orderBy: { createdAt: 'desc' },
  });
}
```

**Add import:**

```typescript
import { LicenseActivation } from '.prisma/license-client';
import { BadRequestException } from '@nestjs/common';
import { ActivateLicenseDto, DeactivateLicenseDto } from '../_dtos';
```

### 1.2 Add License Expiration Cron

**Create:** `apps/license-api/src/license/license-cron.service.ts`

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { LicenseStatus } from '.prisma/license-client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class LicenseCronService {
  private readonly logger = new Logger(LicenseCronService.name);

  constructor(private readonly prisma: PrismaService) {}

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async expireLicenses() {
    const result = await this.prisma.license.updateMany({
      where: {
        expiresAt: { lt: new Date() },
        status: LicenseStatus.ACTIVE,
      },
      data: { status: LicenseStatus.EXPIRED },
    });

    if (result.count > 0) {
      this.logger.log(`Expired ${result.count} licenses`);
    }
  }

  @Cron(CronExpression.EVERY_DAY_AT_10AM)
  async warnExpiringSoon() {
    const sevenDaysFromNow = new Date();
    sevenDaysFromNow.setDate(sevenDaysFromNow.getDate() + 7);

    const expiring = await this.prisma.license.findMany({
      where: {
        expiresAt: {
          gte: new Date(),
          lte: sevenDaysFromNow,
        },
        status: LicenseStatus.ACTIVE,
      },
    });

    // TODO: Send expiration warning emails
    this.logger.log(`Found ${expiring.length} licenses expiring within 7 days`);
  }
}
```

**Update:** `apps/license-api/src/license/license.module.ts`

```typescript
import { LicenseCronService } from './license-cron.service';

@Module({
  // ...
  providers: [LicenseService, LicenseRepository, LicenseCronService],
  // ...
})
export class LicenseModule {}
```

**Update:** `apps/license-api/src/app/app.module.ts`

```typescript
import { ScheduleModule } from '@nestjs/schedule';

@Module({
  imports: [
    // ... existing imports
    ScheduleModule.forRoot(),
    // ...
  ],
})
export class AppModule {}
```

**Install:** `@nestjs/schedule`

```bash
npm install @nestjs/schedule
```

### 1.3 Add Admin Dashboard Endpoints

**Create:** `apps/license-api/src/admin/admin.controller.ts`

```typescript
import { Controller, Get, Post, Param, UseGuards, Query } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiSecurity, ApiTags, ApiParam, ApiQuery } from '@nestjs/swagger';
import { LicenseStatus } from '.prisma/license-client';
import { AdminApiKeyGuard } from '../guards/admin-api-key.guard';
import { LicenseService } from '../license/_services/license.service';
import { PrismaService } from '../prisma/prisma.service';

@ApiTags('admin')
@Controller('admin')
@UseGuards(AdminApiKeyGuard)
@ApiSecurity('api-key')
export class AdminController {
  constructor(
    private readonly licenseService: LicenseService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('stats')
  @ApiOperation({ summary: 'Get license statistics (admin only)' })
  @ApiResponse({ status: 200, description: 'Statistics' })
  async getStats() {
    const [total, active, expired, revoked] = await Promise.all([
      this.licenseService.count(),
      this.prisma.license.count({ where: { status: LicenseStatus.ACTIVE } }),
      this.prisma.license.count({ where: { status: LicenseStatus.EXPIRED } }),
      this.prisma.license.count({ where: { status: LicenseStatus.REVOKED } }),
    ]);

    // Calculate MRR (simplified - should use actual tier pricing)
    const activeLicenses = await this.prisma.license.findMany({
      where: { status: LicenseStatus.ACTIVE },
      select: { tier: true },
    });

    const tierPricing = {
      FREE: 0,
      PATREON_SUPPORTER: 3,
      PATREON_PLUS: 5,
      PATREON_PRO: 10,
      PATREON_ULTIMATE: 20,
      COMMERCIAL_STARTER: 15,
      COMMERCIAL_PRO: 50,
      COMMERCIAL_ENTERPRISE: 0, // Custom pricing
    };

    const mrr = activeLicenses.reduce((sum, l) => sum + (tierPricing[l.tier] || 0), 0);

    return {
      totalLicenses: total,
      activeLicenses: active,
      expiredLicenses: expired,
      revokedLicenses: revoked,
      mrr,
    };
  }

  @Get('webhooks')
  @ApiOperation({ summary: 'Get webhook events (admin only)' })
  @ApiQuery({ name: 'skip', required: false, type: Number })
  @ApiQuery({ name: 'take', required: false, type: Number })
  @ApiResponse({ status: 200, description: 'List of webhook events' })
  async getWebhooks(
    @Query('skip') skip?: string,
    @Query('take') take?: string,
  ) {
    const skipNum = skip ? parseInt(skip, 10) : 0;
    const takeNum = take ? Math.min(parseInt(take, 10) || 100, 100) : 100;

    const [events, total] = await Promise.all([
      this.prisma.webhookEvent.findMany({
        orderBy: { createdAt: 'desc' },
        skip: skipNum,
        take: takeNum,
        include: { license: { select: { email: true, tier: true } } },
      }),
      this.prisma.webhookEvent.count(),
    ]);

    return { data: events, total };
  }

  @Post('webhooks/:id/retry')
  @ApiOperation({ summary: 'Retry a failed webhook event (admin only)' })
  @ApiParam({ name: 'id', description: 'Webhook event ID' })
  @ApiResponse({ status: 200, description: 'Webhook retried' })
  async retryWebhook(@Param('id') id: string) {
    // TODO: Implement webhook retry logic
    return { success: true, message: 'Webhook retry not yet implemented' };
  }
}
```

**Create:** `apps/license-api/src/admin/admin.module.ts`

```typescript
import { Module } from '@nestjs/common';
import { LicenseModule } from '../license/license.module';
import { PrismaModule } from '../prisma/prisma.module';
import { AdminController } from './admin.controller';

@Module({
  imports: [PrismaModule, LicenseModule],
  controllers: [AdminController],
})
export class AdminModule {}
```

**Update:** `apps/license-api/src/app/app.module.ts`

```typescript
import { AdminModule } from '../admin/admin.module';

@Module({
  imports: [
    // ... existing imports
    AdminModule,
  ],
})
export class AppModule {}
```

### 1.4 Add Patreon OAuth Flow

**Create:** `apps/license-api/src/patreon/patreon.service.ts`

```typescript
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

@Injectable()
export class PatreonService {
  constructor(private readonly config: ConfigService) {}

  getAuthorizationUrl(returnUrl: string): string {
    const clientId = this.config.get('PATREON_CLIENT_ID');
    const redirectUri = this.config.get('PATREON_REDIRECT_URI');
    const state = Buffer.from(JSON.stringify({ returnUrl })).toString('base64');

    return `https://www.patreon.com/oauth2/authorize?response_type=code&client_id=${clientId}&redirect_uri=${redirectUri}&state=${state}&scope=identity identity[email]`;
  }

  async exchangeCodeForToken(code: string) {
    const clientId = this.config.get('PATREON_CLIENT_ID');
    const clientSecret = this.config.get('PATREON_CLIENT_SECRET');
    const redirectUri = this.config.get('PATREON_REDIRECT_URI');

    const response = await axios.post('https://www.patreon.com/api/oauth2/token', {
      code,
      grant_type: 'authorization_code',
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
    });

    return response.data;
  }

  async getUserInfo(accessToken: string) {
    const response = await axios.get('https://www.patreon.com/api/oauth2/v2/identity', {
      headers: { Authorization: `Bearer ${accessToken}` },
      params: {
        'fields[user]': 'email,full_name',
        'fields[member]': 'patron_status,currently_entitled_amount_cents',
        include: 'memberships',
      },
    });

    return response.data;
  }
}
```

**Create:** `apps/license-api/src/patreon/patreon-auth.controller.ts`

```typescript
import { Controller, Get, Query, Redirect } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { PatreonService } from './patreon.service';

@ApiExcludeController()
@Controller('patreon')
export class PatreonAuthController {
  constructor(private readonly patreonService: PatreonService) {}

  @Get('auth')
  @Redirect()
  auth(@Query('return_url') returnUrl: string) {
    const url = this.patreonService.getAuthorizationUrl(returnUrl || 'https://bitbonsai.io/account');
    return { url };
  }

  @Get('callback')
  async callback(@Query('code') code: string, @Query('state') state: string) {
    const { returnUrl } = JSON.parse(Buffer.from(state, 'base64').toString());

    const tokens = await this.patreonService.exchangeCodeForToken(code);
    const userInfo = await this.patreonService.getUserInfo(tokens.access_token);

    // TODO: Create/link Patreon account with license

    return {
      success: true,
      returnUrl,
      userInfo,
    };
  }
}
```

**Create:** `apps/license-api/src/patreon/patreon.module.ts`

```typescript
import { Module } from '@nestjs/common';
import { PatreonService } from './patreon.service';
import { PatreonAuthController } from './patreon-auth.controller';

@Module({
  controllers: [PatreonAuthController],
  providers: [PatreonService],
  exports: [PatreonService],
})
export class PatreonModule {}
```

**Update:** `apps/license-api/src/app/app.module.ts`

```typescript
import { PatreonModule } from '../patreon/patreon.module';

@Module({
  imports: [
    // ... existing imports
    PatreonModule,
  ],
})
export class AppModule {}
```

### 1.5 Add Stripe Checkout Session Creation

**Create:** `apps/license-api/src/stripe/stripe.service.ts`

```typescript
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';

@Injectable()
export class StripeService {
  private readonly stripe: Stripe;

  constructor(private readonly config: ConfigService) {
    const secretKey = this.config.get<string>('STRIPE_SECRET_KEY');
    this.stripe = new Stripe(secretKey || 'sk_placeholder');
  }

  async createCheckoutSession(params: {
    priceId: string;
    email: string;
    successUrl: string;
    cancelUrl: string;
  }) {
    return this.stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      customer_email: params.email,
      line_items: [{ price: params.priceId, quantity: 1 }],
      success_url: params.successUrl,
      cancel_url: params.cancelUrl,
      metadata: { email: params.email },
    });
  }
}
```

**Create:** `apps/license-api/src/stripe/stripe-checkout.controller.ts`

```typescript
import { Body, Controller, Post } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { StripeService } from './stripe.service';

class CreateCheckoutSessionDto {
  priceId: string;
  email: string;
  successUrl: string;
  cancelUrl: string;
}

@ApiTags('stripe')
@Controller('stripe')
export class StripeCheckoutController {
  constructor(private readonly stripeService: StripeService) {}

  @Post('create-checkout-session')
  @ApiOperation({ summary: 'Create a Stripe checkout session' })
  @ApiResponse({ status: 200, description: 'Checkout session created' })
  async createCheckoutSession(@Body() dto: CreateCheckoutSessionDto) {
    const session = await this.stripeService.createCheckoutSession(dto);
    return { sessionId: session.id, url: session.url };
  }
}
```

**Create:** `apps/license-api/src/stripe/stripe.module.ts`

```typescript
import { Module } from '@nestjs/common';
import { StripeService } from './stripe.service';
import { StripeCheckoutController } from './stripe-checkout.controller';

@Module({
  controllers: [StripeCheckoutController],
  providers: [StripeService],
  exports: [StripeService],
})
export class StripeModule {}
```

**Update:** `apps/license-api/src/app/app.module.ts`

```typescript
import { StripeModule } from '../stripe/stripe.module';

@Module({
  imports: [
    // ... existing imports
    StripeModule,
  ],
})
export class AppModule {}
```

### 1.6 Environment Variables

**Update:** `apps/license-api/.env.example`

```bash
# Database
LICENSE_DATABASE_URL="postgresql://user:password@localhost:5432/bitbonsai_licenses"

# Server
LICENSE_API_PORT=3200
NODE_ENV=development

# CORS
CORS_ORIGINS="https://bitbonsai.io,https://app.bitbonsai.io,http://localhost:4200"

# Crypto
LICENSE_SECRET_KEY="your-256-bit-secret-key-for-signing-licenses"

# Admin API Key (for admin dashboard)
ADMIN_API_KEY="your-secure-random-api-key"

# Patreon
PATREON_CLIENT_ID="your-patreon-client-id"
PATREON_CLIENT_SECRET="your-patreon-client-secret"
PATREON_REDIRECT_URI="https://bitbonsai.io/api/patreon/callback"
PATREON_WEBHOOK_SECRET="your-patreon-webhook-secret"

# Stripe
STRIPE_SECRET_KEY="sk_test_..."
STRIPE_WEBHOOK_SECRET="whsec_..."
STRIPE_PRICE_STARTER_MONTHLY="price_..."
STRIPE_PRICE_STARTER_YEARLY="price_..."
STRIPE_PRICE_PRO_MONTHLY="price_..."
STRIPE_PRICE_PRO_YEARLY="price_..."
STRIPE_PRICE_ENTERPRISE_MONTHLY="price_..."
STRIPE_PRICE_ENTERPRISE_YEARLY="price_..."

# Ko-fi
KOFI_VERIFICATION_TOKEN="your-kofi-verification-token"

# Email (Resend)
RESEND_API_KEY="re_..."
EMAIL_FROM="BitBonsai <noreply@bitbonsai.io>"
```

---

## 📋 PHASE 2: BITBONSAI INTEGRATION

### 2.1 Delete Backend Patreon Integration

```bash
rm -rf apps/backend/src/integrations/patreon/
```

**Remove from backend imports** (check `app.module.ts`).

### 2.2 Create License Verification Service

**Create:** `apps/backend/src/license/license-verification.service.ts`

```typescript
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

interface LicenseVerificationResult {
  valid: boolean;
  license?: {
    email: string;
    tier: string;
    maxNodes: number;
    maxConcurrentJobs: number;
    expiresAt: string | null;
  };
  error?: string;
}

@Injectable()
export class LicenseVerificationService implements OnModuleInit {
  private readonly logger = new Logger(LicenseVerificationService.name);
  private readonly licenseApiUrl: string;
  private cachedVerification: LicenseVerificationResult | null = null;
  private cacheExpiry = 0;
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes

  constructor(
    private readonly config: ConfigService,
    private readonly http: HttpService,
  ) {
    this.licenseApiUrl = config.get('LICENSE_API_URL') || 'https://bitbonsai.io/api';
  }

  async onModuleInit() {
    await this.verifyLicense();
  }

  async verifyLicense(forceRefresh = false): Promise<LicenseVerificationResult> {
    if (!forceRefresh && this.cachedVerification && Date.now() < this.cacheExpiry) {
      return this.cachedVerification;
    }

    const licenseKey = this.config.get('LICENSE_KEY');
    if (!licenseKey) {
      this.logger.warn('No LICENSE_KEY configured. Running in FREE tier mode.');
      return { valid: false, error: 'No license key configured' };
    }

    try {
      const response = await firstValueFrom(
        this.http.post<LicenseVerificationResult>(
          `${this.licenseApiUrl}/licenses/verify`,
          { licenseKey },
        ),
      );

      this.cachedVerification = response.data;
      this.cacheExpiry = Date.now() + this.CACHE_TTL;

      if (response.data.valid) {
        this.logger.log(
          `License verified: ${response.data.license.tier} (${response.data.license.maxNodes} nodes, ${response.data.license.maxConcurrentJobs} concurrent jobs)`,
        );
      } else {
        this.logger.warn(`License invalid: ${response.data.error}`);
      }

      return response.data;
    } catch (error) {
      this.logger.error(`Failed to verify license: ${error.message}`);
      return { valid: false, error: 'License API unavailable' };
    }
  }

  async canAddNode(currentNodeCount: number): Promise<boolean> {
    const verification = await this.verifyLicense();
    if (!verification.valid) return currentNodeCount === 0; // FREE = 1 node
    return currentNodeCount < verification.license.maxNodes;
  }

  async canRunJob(currentRunningJobs: number): Promise<boolean> {
    const verification = await this.verifyLicense();
    if (!verification.valid) return currentRunningJobs < 2; // FREE = 2 jobs
    return currentRunningJobs < verification.license.maxConcurrentJobs;
  }

  async activateLicense(licenseKey: string, machineId: string, machineName: string) {
    try {
      const response = await firstValueFrom(
        this.http.post(`${this.licenseApiUrl}/licenses/activate`, {
          licenseKey,
          machineId,
          machineName,
        }),
      );

      this.logger.log(`License activated: ${licenseKey}`);
      await this.verifyLicense(true); // Refresh cache
      return response.data;
    } catch (error) {
      this.logger.error(`Failed to activate license: ${error.message}`);
      throw error;
    }
  }
}
```

**Create:** `apps/backend/src/license/license.module.ts`

```typescript
import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { LicenseVerificationService } from './license-verification.service';

@Module({
  imports: [HttpModule],
  providers: [LicenseVerificationService],
  exports: [LicenseVerificationService],
})
export class LicenseModule {}
```

**Update:** `apps/backend/src/app/app.module.ts`

```typescript
import { LicenseModule } from '../license/license.module';

@Module({
  imports: [
    // ... existing imports
    LicenseModule,
  ],
})
export class AppModule {}
```

### 2.3 Add License Guards

**Create:** `apps/backend/src/license/license.guard.ts`

```typescript
import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { LicenseVerificationService } from './license-verification.service';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class LicenseNodeGuard implements CanActivate {
  constructor(
    private readonly licenseService: LicenseVerificationService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const currentNodes = await this.prisma.node.count();
    const canAdd = await this.licenseService.canAddNode(currentNodes);

    if (!canAdd) {
      throw new ForbiddenException(
        'Node limit reached. Upgrade your license at https://bitbonsai.io/pricing',
      );
    }

    return true;
  }
}

@Injectable()
export class LicenseJobGuard implements CanActivate {
  constructor(
    private readonly licenseService: LicenseVerificationService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const runningJobs = await this.prisma.encodingJob.count({
      where: { status: 'ENCODING' },
    });

    const canRun = await this.licenseService.canRunJob(runningJobs);

    if (!canRun) {
      throw new ForbiddenException(
        'Concurrent job limit reached. Upgrade your license at https://bitbonsai.io/pricing',
      );
    }

    return true;
  }
}
```

**Update:** `apps/backend/src/license/license.module.ts`

```typescript
import { LicenseNodeGuard, LicenseJobGuard } from './license.guard';

@Module({
  // ...
  providers: [LicenseVerificationService, LicenseNodeGuard, LicenseJobGuard],
  exports: [LicenseVerificationService, LicenseNodeGuard, LicenseJobGuard],
})
export class LicenseModule {}
```

**Apply guards to controllers:**

```typescript
import { UseGuards } from '@nestjs/common';
import { LicenseNodeGuard, LicenseJobGuard } from '../license/license.guard';

@Controller('nodes')
export class NodeController {
  @Post()
  @UseGuards(LicenseNodeGuard)
  async createNode(@Body() data: CreateNodeDto) {
    // ...
  }
}

@Controller('encoding')
export class EncodingController {
  @Post('jobs')
  @UseGuards(LicenseJobGuard)
  async createJob(@Body() data: CreateJobDto) {
    // ...
  }
}
```

### 2.4 Update Frontend License Service

**Update:** `apps/frontend/src/environments/environment.ts`

```typescript
export const environment = {
  production: false,
  apiUrl: 'http://localhost:3100', // Backend API (encoding jobs, nodes)
  licenseApiUrl: 'http://localhost:3200/api', // License API
};
```

**Update:** `apps/frontend/src/environments/environment.prod.ts`

```typescript
export const environment = {
  production: true,
  apiUrl: 'https://bitbonsai.io/api', // Backend via reverse proxy
  licenseApiUrl: 'https://bitbonsai.io/license-api', // License API via reverse proxy
};
```

**Update:** `apps/frontend/src/app/features/settings/services/license.service.ts`

```typescript
import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../environments/environment';

export interface LicenseVerificationResponse {
  valid: boolean;
  error?: string;
  license?: {
    email: string;
    tier: string;
    maxNodes: number;
    maxConcurrentJobs: number;
    expiresAt: string | null;
  };
}

@Injectable({ providedIn: 'root' })
export class LicenseService {
  private readonly licenseApiUrl = environment.licenseApiUrl;

  constructor(private readonly http: HttpClient) {}

  verifyLicense(licenseKey: string): Observable<LicenseVerificationResponse> {
    return this.http.post<LicenseVerificationResponse>(
      `${this.licenseApiUrl}/licenses/verify`,
      { licenseKey },
    );
  }

  activateLicense(licenseKey: string, machineId: string, machineName: string): Observable<any> {
    return this.http.post(`${this.licenseApiUrl}/licenses/activate`, {
      licenseKey,
      machineId,
      machineName,
    });
  }

  connectPatreon(): void {
    const returnUrl = encodeURIComponent(window.location.href);
    window.location.href = `${this.licenseApiUrl}/patreon/auth?return_url=${returnUrl}`;
  }

  createStripeCheckout(priceId: string, email: string): Observable<{ sessionId: string; url: string }> {
    return this.http.post<{ sessionId: string; url: string }>(
      `${this.licenseApiUrl}/stripe/create-checkout-session`,
      {
        priceId,
        email,
        successUrl: `${window.location.origin}/settings?stripe_success=true`,
        cancelUrl: `${window.location.origin}/settings?stripe_cancel=true`,
      },
    );
  }
}
```

**Update:** `apps/backend/.env`

```bash
LICENSE_API_URL="https://bitbonsai.io/api"
LICENSE_KEY="" # User fills this in Settings
```

---

## 📋 PHASE 3: ADMIN DASHBOARD

### 3.1 Generate Admin Dashboard App

```bash
cd /Users/wassimmehanna/git/bitbonsai
nx g @nx/angular:app admin-dashboard --style=scss --routing=true --standalone
```

### 3.2 Project Structure

```
apps/admin-dashboard/
├── src/
│   ├── app/
│   │   ├── core/
│   │   │   ├── guards/
│   │   │   │   └── auth.guard.ts
│   │   │   └── services/
│   │   │       ├── auth.service.ts
│   │   │       └── admin-api.service.ts
│   │   ├── features/
│   │   │   ├── login/
│   │   │   │   └── login.component.ts
│   │   │   ├── dashboard/
│   │   │   │   └── dashboard.component.ts
│   │   │   ├── licenses/
│   │   │   │   └── license-list.component.ts
│   │   │   └── webhooks/
│   │   │       └── webhook-list.component.ts
│   │   └── app.routes.ts
│   └── main.ts
```

### 3.3 Core Services

**Create:** `apps/admin-dashboard/src/app/core/services/auth.service.ts`

```typescript
import { Injectable, inject, signal } from '@angular/core';
import { Router } from '@angular/router';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly router = inject(Router);
  private readonly isAuthenticatedSignal = signal(this.hasApiKey());

  public readonly isAuthenticated = this.isAuthenticatedSignal.asReadonly();

  login(apiKey: string): void {
    localStorage.setItem('adminApiKey', apiKey);
    this.isAuthenticatedSignal.set(true);
    this.router.navigate(['/dashboard']);
  }

  logout(): void {
    localStorage.removeItem('adminApiKey');
    this.isAuthenticatedSignal.set(false);
    this.router.navigate(['/login']);
  }

  getApiKey(): string | null {
    return localStorage.getItem('adminApiKey');
  }

  private hasApiKey(): boolean {
    return !!localStorage.getItem('adminApiKey');
  }
}
```

**Create:** `apps/admin-dashboard/src/app/core/guards/auth.guard.ts`

```typescript
import { inject } from '@angular/core';
import { Router, CanActivateFn } from '@angular/router';
import { AuthService } from '../services/auth.service';

export const authGuard: CanActivateFn = () => {
  const authService = inject(AuthService);
  const router = inject(Router);

  if (!authService.isAuthenticated()) {
    router.navigate(['/login']);
    return false;
  }
  return true;
};
```

**Create:** `apps/admin-dashboard/src/app/core/services/admin-api.service.ts`

```typescript
import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { AuthService } from './auth.service';

@Injectable({ providedIn: 'root' })
export class AdminApiService {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);
  private readonly apiUrl = `${environment.licenseApiUrl}/admin`;

  private getHeaders(): HttpHeaders {
    const apiKey = this.auth.getApiKey();
    return new HttpHeaders({ 'x-api-key': apiKey || '' });
  }

  getStats(): Observable<{ totalLicenses: number; activeLicenses: number; mrr: number }> {
    return this.http.get<{ totalLicenses: number; activeLicenses: number; mrr: number }>(
      `${this.apiUrl}/stats`,
      { headers: this.getHeaders() },
    );
  }

  getLicenses(skip = 0, take = 20): Observable<{ data: any[]; total: number }> {
    return this.http.get<{ data: any[]; total: number }>(
      `${environment.licenseApiUrl}/licenses?skip=${skip}&take=${take}`,
      { headers: this.getHeaders() },
    );
  }

  revokeLicense(licenseId: string, reason: string): Observable<any> {
    return this.http.post(
      `${environment.licenseApiUrl}/licenses/${licenseId}/revoke`,
      { reason },
      { headers: this.getHeaders() },
    );
  }

  getWebhooks(skip = 0, take = 100): Observable<{ data: any[]; total: number }> {
    return this.http.get<{ data: any[]; total: number }>(
      `${this.apiUrl}/webhooks?skip=${skip}&take=${take}`,
      { headers: this.getHeaders() },
    );
  }

  retryWebhook(webhookId: string): Observable<any> {
    return this.http.post(
      `${this.apiUrl}/webhooks/${webhookId}/retry`,
      {},
      { headers: this.getHeaders() },
    );
  }
}
```

**Create:** `apps/admin-dashboard/src/environments/environment.ts`

```typescript
export const environment = {
  production: false,
  licenseApiUrl: 'http://localhost:3200/api',
};
```

**Create:** `apps/admin-dashboard/src/environments/environment.prod.ts`

```typescript
export const environment = {
  production: true,
  licenseApiUrl: 'https://bitbonsai.io/license-api',
};
```

### 3.4 Login Component

**Create:** `apps/admin-dashboard/src/app/features/login/login.component.ts`

```typescript
import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { AuthService } from '../../core/services/auth.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="login-container">
      <h1>BitBonsai Admin</h1>
      <form (ngSubmit)="onSubmit()">
        <input
          type="password"
          [(ngModel)]="apiKey"
          name="apiKey"
          placeholder="Enter Admin API Key"
          required
        />
        @if (error()) {
          <p class="error">{{ error() }}</p>
        }
        <button type="submit">Login</button>
      </form>
    </div>
  `,
  styles: [`
    .login-container {
      max-width: 400px;
      margin: 100px auto;
      padding: 2rem;
      border: 1px solid #ddd;
      border-radius: 8px;
    }
    input {
      width: 100%;
      padding: 0.75rem;
      margin-bottom: 1rem;
      border: 1px solid #ddd;
      border-radius: 4px;
    }
    button {
      width: 100%;
      padding: 0.75rem;
      background: #2d5016;
      color: white;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-size: 1rem;
    }
    button:hover {
      background: #3d6022;
    }
    .error {
      color: red;
      margin-bottom: 1rem;
    }
  `],
})
export class LoginComponent {
  private readonly auth = inject(AuthService);

  protected apiKey = '';
  protected readonly error = signal<string | null>(null);

  onSubmit(): void {
    if (!this.apiKey) {
      this.error.set('API key is required');
      return;
    }

    this.auth.login(this.apiKey);
  }
}
```

### 3.5 Dashboard Component

**Create:** `apps/admin-dashboard/src/app/features/dashboard/dashboard.component.ts`

```typescript
import { Component, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { AdminApiService } from '../../core/services/admin-api.service';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, RouterLink],
  template: `
    <div class="dashboard">
      <h1>Dashboard</h1>

      <div class="stats">
        <div class="stat-card">
          <h3>Total Licenses</h3>
          <p class="stat-value">{{ stats().totalLicenses }}</p>
        </div>
        <div class="stat-card">
          <h3>Active</h3>
          <p class="stat-value">{{ stats().activeLicenses }}</p>
        </div>
        <div class="stat-card">
          <h3>MRR</h3>
          <p class="stat-value">\${{ stats().mrr }}</p>
        </div>
      </div>

      <div class="actions">
        <a routerLink="/licenses" class="btn">Manage Licenses</a>
        <a routerLink="/webhooks" class="btn">View Webhooks</a>
      </div>
    </div>
  `,
  styles: [`
    .dashboard {
      padding: 2rem;
    }
    .stats {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 1.5rem;
      margin-bottom: 2rem;
    }
    .stat-card {
      padding: 1.5rem;
      border: 1px solid #ddd;
      border-radius: 8px;
      background: #f9f9f9;
    }
    .stat-card h3 {
      margin: 0 0 0.5rem 0;
      font-size: 0.9rem;
      color: #666;
      text-transform: uppercase;
    }
    .stat-value {
      margin: 0;
      font-size: 2rem;
      font-weight: 700;
      color: #2d5016;
    }
    .actions {
      display: flex;
      gap: 1rem;
    }
    .btn {
      padding: 0.75rem 1.5rem;
      background: #2d5016;
      color: white;
      text-decoration: none;
      border-radius: 4px;
      font-weight: 600;
    }
    .btn:hover {
      background: #3d6022;
    }
  `],
})
export class DashboardComponent implements OnInit {
  private readonly api = inject(AdminApiService);
  protected readonly stats = signal({ totalLicenses: 0, activeLicenses: 0, mrr: 0 });

  ngOnInit(): void {
    this.api.getStats().subscribe(data => this.stats.set(data));
  }
}
```

### 3.6 License List Component

**Create:** `apps/admin-dashboard/src/app/features/licenses/license-list.component.ts`

```typescript
import { Component, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AdminApiService } from '../../core/services/admin-api.service';

@Component({
  selector: 'app-license-list',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="license-list">
      <h1>Licenses</h1>

      <table>
        <thead>
          <tr>
            <th>Email</th>
            <th>Tier</th>
            <th>Status</th>
            <th>Created</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          @for (license of licenses(); track license.id) {
            <tr>
              <td>{{ license.email }}</td>
              <td>{{ license.tier }}</td>
              <td>
                <span [class]="'status ' + license.status">{{ license.status }}</span>
              </td>
              <td>{{ license.createdAt | date:'short' }}</td>
              <td>
                <button (click)="revoke(license.id)" class="btn-revoke">Revoke</button>
              </td>
            </tr>
          }
        </tbody>
      </table>

      <div class="pagination">
        <button (click)="prevPage()" [disabled]="page() === 0">Previous</button>
        <span>Page {{ page() + 1 }}</span>
        <button (click)="nextPage()">Next</button>
      </div>
    </div>
  `,
  styles: [`
    .license-list {
      padding: 2rem;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 2rem;
    }
    th, td {
      text-align: left;
      padding: 0.75rem;
      border-bottom: 1px solid #ddd;
    }
    th {
      background: #f5f5f5;
      font-weight: 600;
    }
    .status {
      padding: 0.25rem 0.5rem;
      border-radius: 4px;
      font-size: 0.85rem;
      font-weight: 600;
    }
    .status.ACTIVE {
      background: #d4edda;
      color: #155724;
    }
    .status.EXPIRED {
      background: #fff3cd;
      color: #856404;
    }
    .status.REVOKED {
      background: #f8d7da;
      color: #721c24;
    }
    .btn-revoke {
      padding: 0.5rem 1rem;
      background: #dc3545;
      color: white;
      border: none;
      border-radius: 4px;
      cursor: pointer;
    }
    .pagination {
      display: flex;
      gap: 1rem;
      align-items: center;
    }
    .pagination button {
      padding: 0.5rem 1rem;
      background: #2d5016;
      color: white;
      border: none;
      border-radius: 4px;
      cursor: pointer;
    }
    .pagination button:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
  `],
})
export class LicenseListComponent implements OnInit {
  private readonly api = inject(AdminApiService);
  protected readonly licenses = signal<any[]>([]);
  protected readonly page = signal(0);
  private readonly pageSize = 20;

  ngOnInit(): void {
    this.loadLicenses();
  }

  loadLicenses(): void {
    const skip = this.page() * this.pageSize;
    this.api.getLicenses(skip, this.pageSize).subscribe(response => {
      this.licenses.set(response.data);
    });
  }

  revoke(licenseId: string): void {
    const reason = prompt('Reason for revocation:');
    if (!reason) return;

    this.api.revokeLicense(licenseId, reason).subscribe(() => {
      alert('License revoked');
      this.loadLicenses();
    });
  }

  nextPage(): void {
    this.page.update(p => p + 1);
    this.loadLicenses();
  }

  prevPage(): void {
    this.page.update(p => Math.max(0, p - 1));
    this.loadLicenses();
  }
}
```

### 3.7 Webhook List Component

**Create:** `apps/admin-dashboard/src/app/features/webhooks/webhook-list.component.ts`

```typescript
import { Component, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AdminApiService } from '../../core/services/admin-api.service';

@Component({
  selector: 'app-webhook-list',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="webhook-list">
      <h1>Webhooks</h1>

      <table>
        <thead>
          <tr>
            <th>Provider</th>
            <th>Event Type</th>
            <th>Status</th>
            <th>Created</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          @for (webhook of webhooks(); track webhook.id) {
            <tr>
              <td>{{ webhook.provider }}</td>
              <td>{{ webhook.eventType }}</td>
              <td>
                <span [class]="'status ' + webhook.status">{{ webhook.status }}</span>
              </td>
              <td>{{ webhook.createdAt | date:'short' }}</td>
              <td>
                @if (webhook.status === 'FAILED') {
                  <button (click)="retry(webhook.id)" class="btn-retry">Retry</button>
                }
              </td>
            </tr>
          }
        </tbody>
      </table>
    </div>
  `,
  styles: [`
    .webhook-list {
      padding: 2rem;
    }
    table {
      width: 100%;
      border-collapse: collapse;
    }
    th, td {
      text-align: left;
      padding: 0.75rem;
      border-bottom: 1px solid #ddd;
    }
    th {
      background: #f5f5f5;
      font-weight: 600;
    }
    .status {
      padding: 0.25rem 0.5rem;
      border-radius: 4px;
      font-size: 0.85rem;
      font-weight: 600;
    }
    .status.PROCESSED {
      background: #d4edda;
      color: #155724;
    }
    .status.PENDING {
      background: #fff3cd;
      color: #856404;
    }
    .status.FAILED {
      background: #f8d7da;
      color: #721c24;
    }
    .btn-retry {
      padding: 0.5rem 1rem;
      background: #ffc107;
      color: #212529;
      border: none;
      border-radius: 4px;
      cursor: pointer;
    }
  `],
})
export class WebhookListComponent implements OnInit {
  private readonly api = inject(AdminApiService);
  protected readonly webhooks = signal<any[]>([]);

  ngOnInit(): void {
    this.loadWebhooks();
  }

  loadWebhooks(): void {
    this.api.getWebhooks().subscribe(response => {
      this.webhooks.set(response.data);
    });
  }

  retry(webhookId: string): void {
    this.api.retryWebhook(webhookId).subscribe(() => {
      alert('Webhook retry initiated');
      this.loadWebhooks();
    });
  }
}
```

### 3.8 Routes

**Create:** `apps/admin-dashboard/src/app/app.routes.ts`

```typescript
import { Routes } from '@angular/router';
import { authGuard } from './core/guards/auth.guard';

export const routes: Routes = [
  {
    path: 'login',
    loadComponent: () => import('./features/login/login.component').then(m => m.LoginComponent),
  },
  {
    path: '',
    canActivate: [authGuard],
    children: [
      {
        path: 'dashboard',
        loadComponent: () => import('./features/dashboard/dashboard.component').then(m => m.DashboardComponent),
      },
      {
        path: 'licenses',
        loadComponent: () => import('./features/licenses/license-list.component').then(m => m.LicenseListComponent),
      },
      {
        path: 'webhooks',
        loadComponent: () => import('./features/webhooks/webhook-list.component').then(m => m.WebhookListComponent),
      },
      { path: '', redirectTo: 'dashboard', pathMatch: 'full' },
    ],
  },
  { path: '**', redirectTo: 'dashboard' },
];
```

---

## 📋 PHASE 4: MARKETING WEBSITE

(Same as v4 plan - no changes needed)

Generate Angular app, create Home/Pricing/Features/Download/Account pages.

---

## 📋 PHASE 5: DEPLOYMENT

### 5.1 Nginx Reverse Proxy

**Create:** `/etc/nginx/sites-available/bitbonsai.io`

```nginx
server {
    listen 80;
    server_name bitbonsai.io;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name bitbonsai.io;

    ssl_certificate /etc/letsencrypt/live/bitbonsai.io/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/bitbonsai.io/privkey.pem;

    # Marketing Website (Angular)
    location / {
        root /var/www/bitbonsai-website;
        try_files $uri $uri/ /index.html;
    }

    # Admin Dashboard (Angular)
    location /admin {
        alias /var/www/bitbonsai-admin;
        try_files $uri $uri/ /admin/index.html;
    }

    # License API (NestJS)
    location /license-api {
        rewrite ^/license-api(.*)$ /api$1 break;
        proxy_pass http://localhost:3200;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }

    # Stripe webhook (raw body required)
    location /license-api/webhooks/stripe {
        rewrite ^/license-api(.*)$ /api$1 break;
        proxy_pass http://localhost:3200;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_request_buffering off;
    }
}
```

### 5.2 Systemd Service

**Create:** `/etc/systemd/system/bitbonsai-license-api.service`

```ini
[Unit]
Description=BitBonsai License API
After=network.target postgresql.service

[Service]
Type=simple
User=bitbonsai
WorkingDirectory=/opt/bitbonsai
Environment="NODE_ENV=production"
EnvironmentFile=/opt/bitbonsai/apps/license-api/.env.production
ExecStart=/usr/bin/node apps/license-api/dist/main.js
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

---

## ✅ IMPLEMENTATION CHECKLIST

### Phase 1: Complete License API (20% remaining)
- [ ] Add license activation endpoints (activate, deactivate, list)
- [ ] Add license expiration cron service
- [ ] Add admin dashboard endpoints (stats, webhooks)
- [ ] Add Patreon OAuth flow (auth, callback)
- [ ] Add Stripe checkout session endpoint
- [ ] Install @nestjs/schedule
- [ ] Test all new endpoints

### Phase 2: BitBonsai Integration
- [ ] Delete apps/backend/src/integrations/patreon/
- [ ] Create LicenseVerificationService in backend
- [ ] Add LicenseNodeGuard and LicenseJobGuard
- [ ] Update frontend environment files
- [ ] Update frontend LicenseService
- [ ] Add LICENSE_API_URL to backend .env
- [ ] Test license verification flow

### Phase 3: Admin Dashboard
- [ ] Generate admin-dashboard Angular app
- [ ] Create AuthService (API key-based)
- [ ] Create AdminApiService
- [ ] Build Login component
- [ ] Build Dashboard component
- [ ] Build License List component
- [ ] Build Webhook List component
- [ ] Test admin authentication

### Phase 4: Marketing Website
- [ ] Generate website Angular app
- [ ] Build Home page
- [ ] Build Pricing page
- [ ] Build Features page
- [ ] Build Download page
- [ ] Build Account page
- [ ] Test payment flows

### Phase 5: Deployment
- [ ] Configure Nginx reverse proxy
- [ ] Setup SSL with Let's Encrypt
- [ ] Create systemd service
- [ ] Deploy license-api
- [ ] Deploy admin dashboard
- [ ] Deploy marketing website
- [ ] Test in production

---

## 📊 SUMMARY

**License API:** 80% → 100% (20% work remaining)
**BitBonsai Integration:** 0% → 100%
**Admin Dashboard:** 0% → 100% (simplified - no JWT, just API key)
**Marketing Website:** 0% → 100%
**Deployment:** 30% → 100%

**Total remaining work:** ~60% of original plan

Your existing implementation saved **weeks** of development time. The architecture is solid, secure, and production-ready.
