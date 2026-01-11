# BitBonsai Website + Admin Dashboard - FINAL PLAN v6

**Date:** 2025-12-23
**Status:** Production-Ready Plan
**Based On:** Existing license-api (80% complete) + Security Audit findings

---

## 🎯 EXECUTIVE SUMMARY

**Clear Separation:**
- **license-api** (remote): Creates/manages licenses, handles payments, stores license data
- **BitBonsai backend** (local): Verifies licenses via API, enforces limits, NO license creation

**No Migrations:** All code is dev, nothing in production yet.

**Implementation Status:**
- License API: 80% complete (add activation, cron, admin endpoints)
- BitBonsai Integration: 0% (delete old code, add verification service)
- Admin Dashboard: 0% (Angular app with API key auth)
- Marketing Website: 0% (Angular app)
- Deployment: 30% (CORS/rate limiting done, need nginx/SSL)

---

## 🏗️ ARCHITECTURE

```
┌─────────────────────────────────────────┐
│ User's Local Infrastructure             │
│ (Unraid/Proxmox)                        │
│                                         │
│  ┌──────────────────────────────────┐  │
│  │ BitBonsai (Consumer ONLY)        │  │
│  │ - Local PostgreSQL/SQLite        │  │
│  │ - Encoding jobs, nodes, media    │  │
│  │ - NO license creation            │  │
│  │ - Verifies via API every 5min    │  │
│  └──────────────┬───────────────────┘  │
└─────────────────┼───────────────────────┘
                  │ HTTPS (every 5 min)
                  │ POST /api/licenses/verify
                  │ POST /api/licenses/activate
                  ▼
┌─────────────────────────────────────────┐
│ bitbonsai.io (Remote SaaS Provider)     │
│                                         │
│  ┌──────────────────────────────────┐  │
│  │ License API ✅ 80% Complete      │  │
│  │ - PostgreSQL (license DB)        │  │
│  │ - Crypto-signed license keys     │  │
│  │ - Patreon/Stripe/Ko-fi webhooks  │  │
│  │ - Email via Resend               │  │
│  │ - Rate limiting (10 req/min)     │  │
│  └──────────────────────────────────┘  │
│                                         │
│  ┌──────────────────────────────────┐  │
│  │ Admin Dashboard (Angular)        │  │
│  │ - API key auth                   │  │
│  │ - Manage licenses, view webhooks │  │
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

Your `apps/license-api/` is **80% production-ready**:

| Component | File | Status |
|-----------|------|--------|
| **Prisma Schema** | `prisma/schema.prisma` | ✅ Complete |
| **License Service** | `src/license/_services/license.service.ts` | ✅ Complete |
| **Crypto Service** | `src/crypto/crypto.service.ts` | ✅ Signed keys |
| **Patreon Webhooks** | `src/webhook/patreon.controller.ts` | ✅ + Signature verify |
| **Stripe Webhooks** | `src/webhook/stripe.controller.ts` | ✅ + Signature verify |
| **Ko-fi Webhooks** | `src/webhook/kofi.controller.ts` | ✅ Complete |
| **Webhook Service** | `src/webhook/_services/webhook.service.ts` | ✅ Complete |
| **Email Service** | `src/email/email.service.ts` | ✅ Resend |
| **Rate Limiting** | `src/main.ts` + `app.module.ts` | ✅ Configured |
| **CORS** | `src/main.ts` | ✅ Configured |
| **Admin Guard** | `src/guards/admin-api-key.guard.ts` | ✅ Complete |
| **Security Logger** | `src/security/security-logger.service.ts` | ✅ Complete |

---

## 📋 PHASE 1: COMPLETE LICENSE API (20% remaining)

### 1.1 Add License Activation Endpoints

**Update:** `apps/license-api/src/license/license.controller.ts`

Add these endpoints after existing methods:

```typescript
import { ActivateLicenseDto, DeactivateLicenseDto, LicenseActivationResponseDto } from './_dtos';

@Post('activate')
@ApiOperation({ summary: 'Activate a license on a machine' })
@ApiResponse({ status: 200, description: 'License activated', type: LicenseActivationResponseDto })
@ApiBadRequestResponse({ description: 'License invalid, already activated, or revoked' })
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
import { IsNotEmpty, IsString, IsOptional, IsUUID } from 'class-validator';

export class ActivateLicenseDto {
  @ApiProperty({ description: 'License key to activate' })
  @IsString()
  @IsNotEmpty()
  licenseKey: string;

  @ApiProperty({
    description: 'Unique machine identifier (UUID v4)',
    example: '550e8400-e29b-41d4-a716-446655440000'
  })
  @IsUUID('4')
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
  @IsUUID('4')
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
export * from './create-license.dto';
export * from './verify-license.dto';
export * from './revoke-license.dto';
export * from './license-response.dto';
export * from './verify-license-response.dto';
export * from './license-tier.enum';
```

**Update:** `apps/license-api/src/license/_services/license.service.ts`

Add these methods at the end of the class:

```typescript
import { LicenseActivation, LicenseStatus } from '.prisma/license-client';
import { BadRequestException } from '@nestjs/common';
import { ActivateLicenseDto, DeactivateLicenseDto } from '../_dtos';

async activateLicense(dto: ActivateLicenseDto): Promise<LicenseActivation> {
  // Verify license signature
  const verification = await this.verify({ licenseKey: dto.licenseKey });
  if (!verification.valid) {
    throw new BadRequestException(verification.error || 'Invalid license');
  }

  // Find license in DB and check status
  const license = await this.licenseRepository.findByKey(dto.licenseKey);
  if (!license) {
    throw new NotFoundException('License not found');
  }

  if (license.status !== LicenseStatus.ACTIVE) {
    throw new BadRequestException(`License is ${license.status.toLowerCase()}`);
  }

  // Use transaction to prevent race condition
  return await this.prisma.$transaction(async (tx) => {
    // Check if already activated on this machine
    const existing = await tx.licenseActivation.findUnique({
      where: {
        licenseId_machineId: {
          licenseId: license.id,
          machineId: dto.machineId,
        },
      },
    });

    if (existing) {
      if (!existing.deactivatedAt) {
        // Already active, return it
        return existing;
      }
      // Reactivate
      return tx.licenseActivation.update({
        where: { id: existing.id },
        data: { deactivatedAt: null },
      });
    }

    // Check activation limit (1 machine per license)
    const activeCount = await tx.licenseActivation.count({
      where: {
        licenseId: license.id,
        deactivatedAt: null,
      },
    });

    if (activeCount >= 1) {
      throw new BadRequestException(
        'License already activated on another machine. Deactivate it first or contact support at support@bitbonsai.io',
      );
    }

    // Create new activation
    return tx.licenseActivation.create({
      data: {
        licenseId: license.id,
        machineId: dto.machineId,
        machineName: dto.machineName,
        ipAddress: dto.ipAddress,
        userAgent: dto.userAgent,
      },
    });
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

### 1.2 Add License Expiration Cron

**Create:** `apps/license-api/src/license/license-cron.service.ts`

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { LicenseStatus } from '.prisma/license-client';
import { EmailService } from '../email/email.service';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class LicenseCronService {
  private readonly logger = new Logger(LicenseCronService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService,
  ) {}

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

    for (const license of expiring) {
      const daysRemaining = Math.ceil(
        (license.expiresAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24),
      );

      try {
        await this.emailService.sendExpirationWarning({
          email: license.email,
          tier: license.tier,
          expiresAt: license.expiresAt,
          daysRemaining,
        });
      } catch (error) {
        this.logger.error(`Failed to send expiration warning to ${license.email}`, error);
      }
    }

    if (expiring.length > 0) {
      this.logger.log(`Sent ${expiring.length} expiration warnings`);
    }
  }
}
```

**Update:** `apps/license-api/src/email/email.service.ts`

Add this method:

```typescript
async sendExpirationWarning(params: {
  email: string;
  tier: string;
  expiresAt: Date;
  daysRemaining: number;
}): Promise<void> {
  const { email, tier, expiresAt, daysRemaining } = params;
  const tierDisplay = this.formatTierName(tier);

  const html = `
<!DOCTYPE html>
<html>
<body style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
  <h1 style="color: #2d5016;">BitBonsai License Expiring Soon</h1>
  <p>Your <strong>${tierDisplay}</strong> license will expire in <strong>${daysRemaining} days</strong>.</p>
  <p><strong>Expiration date:</strong> ${expiresAt.toLocaleDateString()}</p>
  <p>Renew your subscription to continue enjoying unlimited encoding:</p>
  <a href="https://bitbonsai.io/pricing" style="display: inline-block; padding: 12px 24px; background: #2d5016; color: white; text-decoration: none; border-radius: 4px; margin-top: 16px;">Renew License</a>
  <p style="margin-top: 24px; color: #666; font-size: 0.9rem;">After expiration, your app will revert to the FREE tier (1 node, 2 concurrent jobs).</p>
</body>
</html>`;

  if (!this.configService.get<string>('RESEND_API_KEY')) {
    this.logger.log(`[DEV] Would send expiration warning to ${email}`);
    return;
  }

  try {
    await this.resend.emails.send({
      from: this.fromEmail,
      to: email,
      subject: `BitBonsai License Expiring in ${daysRemaining} Days`,
      html,
    });
    this.logger.log(`Expiration warning sent to ${email}`);
  } catch (error) {
    this.logger.error(`Failed to send expiration warning to ${email}`, error);
    throw error;
  }
}
```

**Update:** `apps/license-api/src/license/license.module.ts`

```typescript
import { LicenseCronService } from './license-cron.service';
import { EmailModule } from '../email/email.module';

@Module({
  imports: [CryptoModule, EmailModule],
  controllers: [LicenseController],
  providers: [LicenseService, LicenseRepository, LicenseCronService],
  exports: [LicenseService],
})
export class LicenseModule {}
```

**Update:** `apps/license-api/src/app/app.module.ts`

```typescript
import { ScheduleModule } from '@nestjs/schedule';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
    }),
    ScheduleModule.forRoot(), // ← Add this
    ThrottlerModule.forRoot([/* ... */]),
    // ... rest of imports
  ],
})
export class AppModule {}
```

**Install dependency:**

```bash
npm install @nestjs/schedule
```

### 1.3 Add Admin Dashboard Endpoints

**Create:** `apps/license-api/src/admin/admin.controller.ts`

```typescript
import { Controller, Get, Post, Param, UseGuards, Query, BadRequestException } from '@nestjs/common';
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

    return {
      totalLicenses: total,
      activeLicenses: active,
      expiredLicenses: expired,
      revokedLicenses: revoked,
    };
  }

  @Get('webhooks')
  @ApiOperation({ summary: 'Get webhook events (admin only)' })
  @ApiQuery({ name: 'skip', required: false, type: Number, description: 'Skip N records' })
  @ApiQuery({ name: 'take', required: false, type: Number, description: 'Take N records (max 100)' })
  @ApiResponse({ status: 200, description: 'List of webhook events' })
  async getWebhooks(
    @Query('skip') skip?: string,
    @Query('take') take?: string,
  ) {
    const skipNum = skip ? parseInt(skip, 10) : 0;
    const takeNum = take ? parseInt(take, 10) : 100;

    if (isNaN(skipNum) || skipNum < 0) {
      throw new BadRequestException('skip must be a non-negative integer');
    }
    if (isNaN(takeNum) || takeNum < 1) {
      throw new BadRequestException('take must be a positive integer');
    }

    const limitedTake = Math.min(takeNum, 100);

    const [events, total] = await Promise.all([
      this.prisma.webhookEvent.findMany({
        orderBy: { createdAt: 'desc' },
        skip: skipNum,
        take: limitedTake,
        include: { license: { select: { email: true, tier: true } } },
      }),
      this.prisma.webhookEvent.count(),
    ]);

    return { data: events, total };
  }

  @Post('webhooks/:id/retry')
  @ApiOperation({ summary: 'Retry a failed webhook event (admin only)' })
  @ApiParam({ name: 'id', description: 'Webhook event ID' })
  @ApiResponse({ status: 200, description: 'Webhook retry queued' })
  async retryWebhook(@Param('id') id: string) {
    // TODO: Implement webhook retry queue (BullMQ)
    // For now, return success (manual reprocessing required)
    return {
      success: true,
      message: 'Webhook retry not yet implemented - manual reprocessing required',
    };
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
    AdminModule, // ← Add this
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

    return `https://www.patreon.com/oauth2/authorize?response_type=code&client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}&scope=identity identity[email]`;
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

  validateReturnUrl(returnUrl: string): boolean {
    const allowedOrigins = ['https://bitbonsai.io', 'http://localhost:4200', 'http://localhost:3000'];
    try {
      const url = new URL(returnUrl);
      return allowedOrigins.includes(url.origin);
    } catch {
      return false;
    }
  }
}
```

**Create:** `apps/license-api/src/patreon/patreon-auth.controller.ts`

```typescript
import { Controller, Get, Query, Redirect, BadRequestException } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { PatreonService } from './patreon.service';

@ApiExcludeController()
@Controller('patreon')
export class PatreonAuthController {
  constructor(private readonly patreonService: PatreonService) {}

  @Get('auth')
  @Redirect()
  auth(@Query('return_url') returnUrl: string) {
    if (!returnUrl) {
      returnUrl = 'https://bitbonsai.io/account';
    }

    // Validate return URL to prevent open redirect
    if (!this.patreonService.validateReturnUrl(returnUrl)) {
      throw new BadRequestException('Invalid return URL');
    }

    const url = this.patreonService.getAuthorizationUrl(returnUrl);
    return { url };
  }

  @Get('callback')
  async callback(@Query('code') code: string, @Query('state') state: string) {
    if (!code || !state) {
      throw new BadRequestException('Missing code or state parameter');
    }

    const { returnUrl } = JSON.parse(Buffer.from(state, 'base64').toString());

    // Validate return URL again (defense in depth)
    if (!this.patreonService.validateReturnUrl(returnUrl)) {
      throw new BadRequestException('Invalid return URL');
    }

    const tokens = await this.patreonService.exchangeCodeForToken(code);
    const userInfo = await this.patreonService.getUserInfo(tokens.access_token);

    // TODO: Link Patreon account with license
    // For now, just return success + redirect

    return {
      success: true,
      returnUrl,
      userInfo,
      message: 'Patreon connected successfully',
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
    PatreonModule, // ← Add this
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
    if (!secretKey) {
      throw new Error('STRIPE_SECRET_KEY not configured');
    }
    this.stripe = new Stripe(secretKey, {
      apiVersion: '2024-12-18.acacia',
    });
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
      metadata: {
        email: params.email,
        source: 'bitbonsai_website',
      },
    });
  }
}
```

**Create:** `apps/license-api/src/stripe/stripe-checkout.controller.ts`

```typescript
import { Body, Controller, Post } from '@nestjs/common';
import { ApiOperation, ApiProperty, ApiResponse, ApiTags } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsString, IsUrl } from 'class-validator';
import { StripeService } from './stripe.service';

class CreateCheckoutSessionDto {
  @ApiProperty({ description: 'Stripe price ID (e.g., price_1ABC...)' })
  @IsString()
  @IsNotEmpty()
  priceId: string;

  @ApiProperty({ description: 'Customer email' })
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @ApiProperty({ description: 'URL to redirect after successful payment' })
  @IsUrl()
  @IsNotEmpty()
  successUrl: string;

  @ApiProperty({ description: 'URL to redirect after cancelled payment' })
  @IsUrl()
  @IsNotEmpty()
  cancelUrl: string;
}

@ApiTags('stripe')
@Controller('stripe')
export class StripeCheckoutController {
  constructor(private readonly stripeService: StripeService) {}

  @Post('create-checkout-session')
  @ApiOperation({ summary: 'Create a Stripe checkout session' })
  @ApiResponse({
    status: 200,
    description: 'Checkout session created',
    schema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string' },
        url: { type: 'string' },
      },
    },
  })
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
    StripeModule, // ← Add this
  ],
})
export class AppModule {}
```

### 1.6 Fix Stripe Price Mapping

**Update:** `apps/license-api/src/webhook/stripe.controller.ts`

Replace hardcoded mapping with environment variables:

```typescript
@Injectable()
export class StripeController {
  private readonly logger = new Logger(StripeController.name);
  private readonly stripe: Stripe;
  private readonly STRIPE_PRICE_TO_TIER: Record<string, LicenseTier>;

  constructor(
    private readonly webhookService: WebhookService,
    private readonly configService: ConfigService,
    private readonly securityLogger: SecurityLoggerService,
  ) {
    const secretKey = this.configService.get<string>('STRIPE_SECRET_KEY');
    if (!secretKey) {
      this.logger.warn('STRIPE_SECRET_KEY not configured - Stripe webhooks will fail');
    }
    this.stripe = new Stripe(secretKey || 'sk_placeholder_will_fail', {
      apiVersion: '2024-12-18.acacia',
    });

    // Load price mappings from environment
    this.STRIPE_PRICE_TO_TIER = {
      [this.configService.get('STRIPE_PRICE_STARTER_MONTHLY')]: LicenseTier.COMMERCIAL_STARTER,
      [this.configService.get('STRIPE_PRICE_STARTER_YEARLY')]: LicenseTier.COMMERCIAL_STARTER,
      [this.configService.get('STRIPE_PRICE_PRO_MONTHLY')]: LicenseTier.COMMERCIAL_PRO,
      [this.configService.get('STRIPE_PRICE_PRO_YEARLY')]: LicenseTier.COMMERCIAL_PRO,
      [this.configService.get('STRIPE_PRICE_ENTERPRISE_MONTHLY')]: LicenseTier.COMMERCIAL_ENTERPRISE,
      [this.configService.get('STRIPE_PRICE_ENTERPRISE_YEARLY')]: LicenseTier.COMMERCIAL_ENTERPRISE,
    };
  }

  // ... rest of controller code (no changes)
}
```

### 1.7 Update Environment Variables

**Update:** `apps/license-api/.env.example`

```bash
# Database
LICENSE_DATABASE_URL="postgresql://user:password@localhost:5432/bitbonsai_licenses"

# Server
LICENSE_API_PORT=3200
NODE_ENV=development

# CORS (comma-separated list)
CORS_ORIGINS="https://bitbonsai.io,https://app.bitbonsai.io,http://localhost:4200"

# Crypto
LICENSE_SECRET_KEY="your-256-bit-secret-key-for-signing-licenses"

# Admin API Key (for admin dashboard)
ADMIN_API_KEY="your-secure-random-api-key-minimum-32-chars"

# Patreon
PATREON_CLIENT_ID="your-patreon-client-id"
PATREON_CLIENT_SECRET="your-patreon-client-secret"
PATREON_REDIRECT_URI="https://bitbonsai.io/api/patreon/callback"
PATREON_WEBHOOK_SECRET="your-patreon-webhook-secret"

# Stripe (use real price IDs from Stripe dashboard)
STRIPE_SECRET_KEY="sk_test_..."
STRIPE_WEBHOOK_SECRET="whsec_..."
STRIPE_PRICE_STARTER_MONTHLY="price_1ABC..." # $15/mo
STRIPE_PRICE_STARTER_YEARLY="price_1DEF..."  # $150/yr
STRIPE_PRICE_PRO_MONTHLY="price_1GHI..."     # $50/mo
STRIPE_PRICE_PRO_YEARLY="price_1JKL..."      # $500/yr
STRIPE_PRICE_ENTERPRISE_MONTHLY="price_1MNO..." # Custom
STRIPE_PRICE_ENTERPRISE_YEARLY="price_1PQR..."  # Custom

# Ko-fi
KOFI_VERIFICATION_TOKEN="your-kofi-verification-token"

# Email (Resend)
RESEND_API_KEY="re_..."
EMAIL_FROM="BitBonsai <noreply@bitbonsai.io>"
```

---

## 📋 PHASE 2: BITBONSAI INTEGRATION

### 2.1 Delete Backend License System

**Delete these files/folders:**

```bash
# Delete Patreon integration
rm -rf apps/backend/src/integrations/patreon/

# Delete old license system (if exists - check first)
# Do NOT delete if it doesn't exist
# rm -rf apps/backend/src/license/license.service.ts
# rm -rf apps/backend/src/license/license-guard.service.ts
# rm -rf apps/backend/src/license/license.controller.ts

# Keep license.module.ts - we'll update it
```

**⚠️ IMPORTANT:** Only delete files that exist and contain the old license creation logic. We'll replace them with verification-only code.

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
    // Verify license on startup
    await this.verifyLicense();
  }

  async verifyLicense(forceRefresh = false): Promise<LicenseVerificationResult> {
    // Return cached result if still valid
    if (!forceRefresh && this.cachedVerification && Date.now() < this.cacheExpiry) {
      return this.cachedVerification;
    }

    const licenseKey = this.config.get('LICENSE_KEY');
    if (!licenseKey) {
      this.logger.warn('No LICENSE_KEY configured. Running in FREE tier mode (1 node, 2 jobs).');
      return {
        valid: false,
        error: 'No license key configured',
        license: {
          email: 'unlicensed',
          tier: 'FREE',
          maxNodes: 1,
          maxConcurrentJobs: 2,
          expiresAt: null,
        },
      };
    }

    try {
      const response = await firstValueFrom(
        this.http.post<LicenseVerificationResult>(
          `${this.licenseApiUrl}/licenses/verify`,
          { licenseKey },
          { timeout: 5000 },
        ),
      );

      this.cachedVerification = response.data;
      this.cacheExpiry = Date.now() + this.CACHE_TTL;

      if (response.data.valid) {
        this.logger.log(
          `License verified: ${response.data.license.tier} (${response.data.license.maxNodes} nodes, ${response.data.license.maxConcurrentJobs} concurrent jobs)`,
        );
      } else {
        this.logger.warn(`License verification failed: ${response.data.error}`);
      }

      return response.data;
    } catch (error) {
      this.logger.error(`Failed to verify license: ${error.message}. Operating in FREE tier mode.`);
      return {
        valid: false,
        error: 'License API unavailable',
        license: {
          email: 'unlicensed',
          tier: 'FREE',
          maxNodes: 1,
          maxConcurrentJobs: 2,
          expiresAt: null,
        },
      };
    }
  }

  async canAddNode(currentNodeCount: number): Promise<boolean> {
    const verification = await this.verifyLicense();
    const maxNodes = verification.license?.maxNodes || 1;
    return currentNodeCount < maxNodes;
  }

  async canRunJob(currentRunningJobs: number): Promise<boolean> {
    const verification = await this.verifyLicense();
    const maxJobs = verification.license?.maxConcurrentJobs || 2;
    return currentRunningJobs < maxJobs;
  }

  async invalidateCache(): Promise<void> {
    this.cachedVerification = null;
    this.cacheExpiry = 0;
    this.logger.log('License cache invalidated');
  }
}
```

### 2.3 Create License Guards

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
        'Node limit reached for your license tier. Upgrade at https://bitbonsai.io/pricing',
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
        'Concurrent job limit reached for your license tier. Upgrade at https://bitbonsai.io/pricing',
      );
    }

    return true;
  }
}
```

### 2.4 Update License Module

**Update:** `apps/backend/src/license/license.module.ts`

```typescript
import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { PrismaModule } from '../prisma/prisma.module';
import { LicenseVerificationService } from './license-verification.service';
import { LicenseNodeGuard, LicenseJobGuard } from './license.guard';

@Module({
  imports: [HttpModule, PrismaModule],
  providers: [LicenseVerificationService, LicenseNodeGuard, LicenseJobGuard],
  exports: [LicenseVerificationService, LicenseNodeGuard, LicenseJobGuard],
})
export class LicenseModule {}
```

**Update:** `apps/backend/src/app/app.module.ts`

```typescript
import { LicenseModule } from '../license/license.module';

@Module({
  imports: [
    // ... existing imports
    LicenseModule, // ← Add if not already present
  ],
})
export class AppModule {}
```

### 2.5 Apply Guards to Controllers

**Update:** `apps/backend/src/nodes/node.controller.ts` (or equivalent)

```typescript
import { UseGuards } from '@nestjs/common';
import { LicenseNodeGuard } from '../license/license.guard';

@Controller('nodes')
export class NodeController {
  @Post()
  @UseGuards(LicenseNodeGuard) // ← Add this guard
  async createNode(@Body() data: CreateNodeDto) {
    return this.nodeService.create(data);
  }
}
```

**Update:** `apps/backend/src/encoding/encoding.controller.ts` (or equivalent)

```typescript
import { UseGuards } from '@nestjs/common';
import { LicenseJobGuard } from '../license/license.guard';

@Controller('encoding')
export class EncodingController {
  @Post('jobs')
  @UseGuards(LicenseJobGuard) // ← Add this guard
  async createJob(@Body() data: CreateJobDto) {
    return this.encodingService.createJob(data);
  }
}
```

### 2.6 Update Backend Environment

**Update:** `apps/backend/.env`

```bash
# License API (remote)
LICENSE_API_URL="https://bitbonsai.io/api"

# License Key (user fills this in via Settings page)
LICENSE_KEY=""
```

**Update:** `apps/backend/.env.example`

```bash
LICENSE_API_URL="https://bitbonsai.io/api"
LICENSE_KEY="" # Enter your license key from bitbonsai.io
```

### 2.7 Update Frontend License Service

**Update:** `apps/frontend/src/environments/environment.ts`

```typescript
export const environment = {
  production: false,
  apiUrl: 'http://localhost:3100', // Backend API (encoding jobs, nodes)
  licenseApiUrl: 'http://localhost:3200/api', // License API (verify, activate)
};
```

**Update:** `apps/frontend/src/environments/environment.prod.ts`

```typescript
export const environment = {
  production: true,
  apiUrl: 'https://bitbonsai.io/api/backend', // Backend via reverse proxy
  licenseApiUrl: 'https://bitbonsai.io/api/license', // License API via reverse proxy
};
```

**Update:** `apps/frontend/src/app/features/settings/services/license.service.ts`

```typescript
import { Injectable, inject } from '@angular/core';
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
  private readonly http = inject(HttpClient);
  private readonly licenseApiUrl = environment.licenseApiUrl;

  verifyLicense(licenseKey: string): Observable<LicenseVerificationResponse> {
    return this.http.post<LicenseVerificationResponse>(
      `${this.licenseApiUrl}/licenses/verify`,
      { licenseKey },
    );
  }

  activateLicense(
    licenseKey: string,
    machineId: string,
    machineName: string,
  ): Observable<any> {
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

  createStripeCheckout(
    priceId: string,
    email: string,
  ): Observable<{ sessionId: string; url: string }> {
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

---

## 📋 PHASE 3: ADMIN DASHBOARD

(Same as v5 plan - no changes needed. Use API key auth, no JWT complexity.)

Generate Angular app:

```bash
nx g @nx/angular:app admin-dashboard --style=scss --routing=true --standalone
```

Implement:
- Login component (API key input)
- Dashboard component (stats)
- License List component
- Webhook List component
- AuthService (localStorage - simplified, not httpOnly cookies for now)
- AdminApiService (adds x-api-key header)

Refer to Phase 3 in v5 plan for full implementation.

---

## 📋 PHASE 4: MARKETING WEBSITE

(Same as v5 plan - no changes needed.)

Generate Angular app:

```bash
nx g @nx/angular:app website --style=scss --routing=true --standalone
```

Implement:
- Home page
- Pricing page (Stripe checkout buttons)
- Features page
- Download page
- Account page (Patreon connect, license retrieval)

Refer to Phase 4 in v5 plan for full implementation.

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

    # Security headers
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains; preload" always;
    add_header X-Frame-Options "DENY" always;
    add_header X-Content-Type-Options "nosniff" always;

    # Gzip compression
    gzip on;
    gzip_types application/json text/css application/javascript;
    gzip_min_length 1000;

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
    location /api/license {
        rewrite ^/api/license(.*)$ /api$1 break;
        proxy_pass http://localhost:3200;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Stripe webhook (raw body required, no buffering)
    location /api/license/webhooks/stripe {
        rewrite ^/api/license(.*)$ /api$1 break;
        proxy_pass http://localhost:3200;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_request_buffering off;
    }

    # Backend API (if also hosted on same server)
    location /api/backend {
        rewrite ^/api/backend(.*)$ /api$1 break;
        proxy_pass http://localhost:3100;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

**Enable site:**

```bash
sudo ln -s /etc/nginx/sites-available/bitbonsai.io /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

### 5.2 SSL Certificate

```bash
sudo certbot --nginx -d bitbonsai.io -d www.bitbonsai.io
```

### 5.3 Systemd Service

**Create:** `/etc/systemd/system/bitbonsai-license-api.service`

```ini
[Unit]
Description=BitBonsai License API
After=network.target postgresql.service

[Service]
Type=simple
User=bitbonsai
WorkingDirectory=/opt/bitbonsai/apps/license-api
Environment="NODE_ENV=production"
EnvironmentFile=/opt/bitbonsai/apps/license-api/.env.production
ExecStart=/usr/bin/node dist/main.js
Restart=on-failure
RestartSec=10
StartLimitBurst=5
StartLimitIntervalSec=300

# Security hardening
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/opt/bitbonsai/apps/license-api

[Install]
WantedBy=multi-user.target
```

**Enable service:**

```bash
sudo systemctl daemon-reload
sudo systemctl enable bitbonsai-license-api
sudo systemctl start bitbonsai-license-api
sudo systemctl status bitbonsai-license-api
```

### 5.4 Production Environment Variables

**Create:** `apps/license-api/.env.production`

```bash
LICENSE_DATABASE_URL="postgresql://bitbonsai:SECURE_PASSWORD@localhost:5432/bitbonsai_licenses"
LICENSE_API_PORT=3200
NODE_ENV=production

CORS_ORIGINS="https://bitbonsai.io,https://app.bitbonsai.io"

LICENSE_SECRET_KEY="PRODUCTION_256_BIT_SECRET_KEY_HERE"
ADMIN_API_KEY="PRODUCTION_ADMIN_API_KEY_MINIMUM_32_CHARS"

PATREON_CLIENT_ID="prod_client_id"
PATREON_CLIENT_SECRET="prod_client_secret"
PATREON_REDIRECT_URI="https://bitbonsai.io/api/license/patreon/callback"
PATREON_WEBHOOK_SECRET="prod_webhook_secret"

STRIPE_SECRET_KEY="sk_live_..."
STRIPE_WEBHOOK_SECRET="whsec_..."
STRIPE_PRICE_STARTER_MONTHLY="price_1ABC..."
STRIPE_PRICE_STARTER_YEARLY="price_1DEF..."
STRIPE_PRICE_PRO_MONTHLY="price_1GHI..."
STRIPE_PRICE_PRO_YEARLY="price_1JKL..."
STRIPE_PRICE_ENTERPRISE_MONTHLY="price_1MNO..."
STRIPE_PRICE_ENTERPRISE_YEARLY="price_1PQR..."

KOFI_VERIFICATION_TOKEN="prod_token"

RESEND_API_KEY="re_..."
EMAIL_FROM="BitBonsai <noreply@bitbonsai.io>"
```

### 5.5 Database Setup

```bash
# Create production database
sudo -u postgres psql
CREATE DATABASE bitbonsai_licenses;
CREATE USER bitbonsai WITH ENCRYPTED PASSWORD 'SECURE_PASSWORD';
GRANT ALL PRIVILEGES ON DATABASE bitbonsai_licenses TO bitbonsai;
\q

# Run migrations
cd /opt/bitbonsai/apps/license-api
npx prisma migrate deploy
```

---

## ✅ IMPLEMENTATION CHECKLIST

### Phase 1: Complete License API (20% remaining)
- [ ] Add license activation endpoints (activate, deactivate, list)
- [ ] Create activation DTOs with UUID validation
- [ ] Add transaction to prevent race condition
- [ ] Add license expiration cron service
- [ ] Add expiration warning email method
- [ ] Install @nestjs/schedule
- [ ] Add admin stats endpoint
- [ ] Add admin webhooks endpoint (with pagination)
- [ ] Add Patreon OAuth service + controller
- [ ] Add return URL validation (prevent open redirect)
- [ ] Add Stripe checkout session endpoint
- [ ] Fix Stripe price mapping (use env vars)
- [ ] Update .env.example with all variables
- [ ] Test all new endpoints

### Phase 2: BitBonsai Integration (100% to do)
- [ ] Delete apps/backend/src/integrations/patreon/
- [ ] Delete old license system files (if they exist)
- [ ] Create LicenseVerificationService
- [ ] Add FREE tier fallback (graceful degradation)
- [ ] Create LicenseNodeGuard
- [ ] Create LicenseJobGuard
- [ ] Update LicenseModule imports
- [ ] Apply guards to NodeController
- [ ] Apply guards to EncodingController
- [ ] Update backend environment files
- [ ] Update frontend environment files
- [ ] Update frontend LicenseService
- [ ] Test license verification flow
- [ ] Test activation flow
- [ ] Test guards (try exceeding limits)

### Phase 3: Admin Dashboard (100% to do)
- [ ] Generate admin-dashboard Angular app
- [ ] Create AuthService (API key in localStorage)
- [ ] Create AuthGuard
- [ ] Create AdminApiService (adds x-api-key header)
- [ ] Create environment files
- [ ] Build Login component
- [ ] Build Dashboard component (stats)
- [ ] Build License List component (pagination)
- [ ] Build Webhook List component
- [ ] Create app routes
- [ ] Test admin authentication
- [ ] Test all CRUD operations

### Phase 4: Marketing Website (100% to do)
- [ ] Generate website Angular app
- [ ] Build Home page (hero, features preview)
- [ ] Build Pricing page (Stripe checkout)
- [ ] Build Features page (detailed features)
- [ ] Build Download page (Docker instructions)
- [ ] Build Account page (Patreon connect, license retrieval)
- [ ] Add Stripe checkout integration
- [ ] Add Patreon OAuth integration
- [ ] Test payment flows end-to-end

### Phase 5: Deployment (70% to do)
- [ ] Configure Nginx reverse proxy
- [ ] Add security headers (HSTS, CSP)
- [ ] Enable gzip compression
- [ ] Setup SSL with Let's Encrypt
- [ ] Create systemd service for license-api
- [ ] Add service security hardening
- [ ] Create production .env file
- [ ] Setup PostgreSQL database
- [ ] Run Prisma migrations
- [ ] Build Angular apps (admin + website)
- [ ] Deploy to /var/www
- [ ] Test in production environment
- [ ] Setup monitoring (optional: PM2, Sentry)

---

## 📊 ESTIMATED EFFORT

| Phase | Tasks | Estimated Time |
|-------|-------|----------------|
| **Phase 1: License API** | 14 tasks | 2 days |
| **Phase 2: BitBonsai Integration** | 15 tasks | 2 days |
| **Phase 3: Admin Dashboard** | 13 tasks | 3 days |
| **Phase 4: Marketing Website** | 9 tasks | 3 days |
| **Phase 5: Deployment** | 13 tasks | 1 day |
| **Testing + QA** | E2E testing | 1 day |

**Total: 12 days** (2.4 weeks)

---

## 🎯 CRITICAL FIXES FROM AUDIT

### Fixed in This Plan
✅ Database conflict resolved (deleted backend license system)
✅ Activation race condition fixed (transaction)
✅ Stripe price mapping fixed (env vars)
✅ Open redirect fixed (return URL validation)
✅ Machine ID validation added (UUID v4)
✅ License status check added (activation)
✅ Input validation added (admin endpoints)

### Still TODO
⚠️ Webhook retry queue (BullMQ) - marked as TODO in admin controller
⚠️ Admin API key in httpOnly cookies (using localStorage for now)
⚠️ Code conventions (NgRx, i18n, tests) - follow-up phase

---

## 🔒 SECURITY NOTES

**API Key Storage:**
- Admin dashboard uses localStorage (simpler but XSS vulnerable)
- Production recommendation: Implement httpOnly cookies + CSRF tokens
- For now: Ensure CSP headers prevent XSS

**Rate Limiting:**
- License verify: 10 req/min per IP (already configured)
- Activation: No additional limit (rely on 1-machine constraint)
- Admin endpoints: Protected by API key (no public access)

**CORS:**
- Configured in license-api main.ts (already done)
- Allows specific origins only
- Credentials enabled for future cookie auth

**Webhook Security:**
- Patreon: MD5 signature (their requirement, mitigated by unique constraint)
- Stripe: Full webhook signature verification (already implemented)
- Ko-fi: Verification token (already implemented)

---

## 📝 FINAL NOTES

**This is a production-ready plan** with all critical audit issues addressed:

1. **Clean separation**: license-api creates, BitBonsai verifies
2. **No migrations**: Everything is dev, fresh start
3. **80% done**: Most of license-api already implemented
4. **Security hardened**: Transaction locks, validation, HTTPS
5. **Graceful degradation**: FREE tier fallback if API unavailable

**Start with Phase 1** - complete the license-api, then move to BitBonsai integration.
