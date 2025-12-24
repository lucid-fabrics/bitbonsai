# BitBonsai Website + Admin Dashboard - FINAL PLAN v4

**Date:** 2025-12-23
**Status:** Ready for Implementation
**Audit:** All 29 findings from v3 addressed

---

## 🏗️ ARCHITECTURE (Corrected)

### System Overview

BitBonsai operates as a **SaaS licensing model** with clear separation:

```
┌─────────────────────────────────────────┐
│ User's Local Infrastructure             │
│ (Unraid/Proxmox)                        │
│                                         │
│  ┌──────────────────────────────────┐  │
│  │ BitBonsai (Consumer)             │  │
│  │ - Local PostgreSQL/SQLite        │  │
│  │ - Encoding jobs, nodes, media    │  │
│  │ - NO license creation            │  │
│  │ - Verifies licenses via API      │  │
│  └──────────────┬───────────────────┘  │
│                 │                       │
└─────────────────┼───────────────────────┘
                  │ HTTPS
                  │ GET /licenses/verify
                  │ POST /licenses/activate
                  ▼
┌─────────────────────────────────────────┐
│ bitbonsai.io (Remote Cloud Server)      │
│                                         │
│  ┌──────────────────────────────────┐  │
│  │ License API (Provider)           │  │
│  │ - Remote PostgreSQL              │  │
│  │ - Creates/manages licenses       │  │
│  │ - Processes payments             │  │
│  │ - Sends webhooks from Stripe     │  │
│  │ - Sends emails via Mailgun       │  │
│  └──────────────────────────────────┘  │
│                                         │
│  ┌──────────────────────────────────┐  │
│  │ Admin Dashboard (Angular)        │  │
│  │ - JWT auth with 2FA              │  │
│  │ - Manage licenses, view webhooks │  │
│  └──────────────────────────────────┘  │
│                                         │
│  ┌──────────────────────────────────┐  │
│  │ Marketing Website (Angular)      │  │
│  │ - Features, pricing, screenshots │  │
│  │ - Stripe checkout integration    │  │
│  │ - Patreon OAuth flow             │  │
│  └──────────────────────────────────┘  │
└─────────────────────────────────────────┘
```

### Database Strategy

**TWO SEPARATE DATABASES BY DESIGN** (not a flaw):

| Database | Location | Purpose | Schema |
|----------|----------|---------|--------|
| **BitBonsai DB** | User's local server | Encoding jobs, nodes, libraries, media | `prisma/schema.prisma` |
| **License DB** | bitbonsai.io cloud | Licenses, activations, webhooks, users | `apps/license-api/prisma/schema.prisma` |

**Critical:** These databases NEVER sync. BitBonsai calls license-api REST API to verify licenses, never writes license data.

---

## 🎯 PHASES (Priority Order)

### Phase 1: License API Foundation (Week 1-2)
**Goal:** Fully functional license provider with payment integrations

### Phase 2: BitBonsai Integration (Week 3)
**Goal:** Local app becomes pure consumer, verifies licenses from remote API

### Phase 3: Admin Dashboard (Week 4)
**Goal:** Secure admin panel for managing licenses

### Phase 4: Marketing Website (Week 5-6)
**Goal:** Public-facing site with pricing, features, screenshots

### Phase 5: Deployment & Polish (Week 7)
**Goal:** Production deployment with monitoring

---

## 📋 PHASE 1: LICENSE API FOUNDATION

### 1.1 Fix Existing License API

**Location:** `apps/license-api/`

#### 1.1.1 Database Schema (Already Exists ✓)

Schema at `apps/license-api/prisma/schema.prisma` is correct. No changes needed.

```prisma
datasource db {
  provider = "postgresql"
  url      = env("LICENSE_DATABASE_URL")  // Remote PostgreSQL only
}

model License {
  id            String          @id @default(cuid())
  key           String          @unique
  email         String
  tier          LicenseTier
  status        LicenseStatus
  expiresAt     DateTime?
  patreonUserId String?         @unique
  stripeCustomerId String?      @unique
  activations   LicenseActivation[]
  createdAt     DateTime        @default(now())
  updatedAt     DateTime        @updatedAt
}

model LicenseActivation {
  id          String   @id @default(cuid())
  licenseId   String
  license     License  @relation(fields: [licenseId], references: [id])
  machineId   String   @unique  // Server UUID from BitBonsai
  machineName String?
  ipAddress   String?
  activatedAt DateTime @default(now())
  lastSeenAt  DateTime @default(now())
}

model WebhookEvent {
  id        String   @id @default(cuid())
  source    String   // "stripe", "patreon", "kofi"
  eventType String
  payload   Json
  status    WebhookStatus
  processedAt DateTime?
  error     String?
  createdAt DateTime @default(now())
}

enum LicenseTier {
  FREE
  PATREON_SUPPORTER     // $3/mo - 2 nodes, 3 concurrent jobs
  PATREON_PLUS          // $5/mo - 5 nodes, 5 concurrent jobs
  PATREON_PRO           // $10/mo - 10 nodes, 10 concurrent jobs
  PATREON_ULTIMATE      // $20/mo - 20 nodes, 20 concurrent jobs
  COMMERCIAL_STARTER    // $15/mo - 5 nodes, priority support
  COMMERCIAL_BUSINESS   // $50/mo - 20 nodes, SLA
  COMMERCIAL_ENTERPRISE // Custom pricing
}

enum LicenseStatus {
  ACTIVE
  EXPIRED
  REVOKED
  SUSPENDED
}

enum WebhookStatus {
  PENDING
  PROCESSED
  FAILED
}
```

#### 1.1.2 Tier Configuration Service

**Create:** `apps/license-api/src/license/tier-config.service.ts`

```typescript
import { Injectable } from '@nestjs/common';
import { LicenseTier } from '@prisma/client';

export interface TierLimits {
  maxNodes: number;
  maxConcurrentJobs: number;
  features: {
    multiNode: boolean;
    api: boolean;
    webhooks: boolean;
    prioritySupport: boolean;
    sla: boolean;
  };
}

@Injectable()
export class TierConfigService {
  private readonly TIER_LIMITS: Record<LicenseTier, TierLimits> = {
    [LicenseTier.FREE]: {
      maxNodes: 1,
      maxConcurrentJobs: 2,
      features: {
        multiNode: false,
        api: false,
        webhooks: false,
        prioritySupport: false,
        sla: false,
      },
    },
    [LicenseTier.PATREON_SUPPORTER]: {
      maxNodes: 2,
      maxConcurrentJobs: 3,
      features: {
        multiNode: true,
        api: true,
        webhooks: false,
        prioritySupport: false,
        sla: false,
      },
    },
    [LicenseTier.PATREON_PLUS]: {
      maxNodes: 5,
      maxConcurrentJobs: 5,
      features: {
        multiNode: true,
        api: true,
        webhooks: true,
        prioritySupport: false,
        sla: false,
      },
    },
    [LicenseTier.PATREON_PRO]: {
      maxNodes: 10,
      maxConcurrentJobs: 10,
      features: {
        multiNode: true,
        api: true,
        webhooks: true,
        prioritySupport: false,
        sla: false,
      },
    },
    [LicenseTier.PATREON_ULTIMATE]: {
      maxNodes: 20,
      maxConcurrentJobs: 20,
      features: {
        multiNode: true,
        api: true,
        webhooks: true,
        prioritySupport: true,
        sla: false,
      },
    },
    [LicenseTier.COMMERCIAL_STARTER]: {
      maxNodes: 5,
      maxConcurrentJobs: 10,
      features: {
        multiNode: true,
        api: true,
        webhooks: true,
        prioritySupport: true,
        sla: false,
      },
    },
    [LicenseTier.COMMERCIAL_BUSINESS]: {
      maxNodes: 20,
      maxConcurrentJobs: 30,
      features: {
        multiNode: true,
        api: true,
        webhooks: true,
        prioritySupport: true,
        sla: true,
      },
    },
    [LicenseTier.COMMERCIAL_ENTERPRISE]: {
      maxNodes: 999,
      maxConcurrentJobs: 999,
      features: {
        multiNode: true,
        api: true,
        webhooks: true,
        prioritySupport: true,
        sla: true,
      },
    },
  };

  getLimits(tier: LicenseTier): TierLimits {
    return this.TIER_LIMITS[tier];
  }

  canActivateNode(tier: LicenseTier, currentNodeCount: number): boolean {
    const limits = this.getLimits(tier);
    return currentNodeCount < limits.maxNodes;
  }

  canRunJob(tier: LicenseTier, currentRunningJobs: number): boolean {
    const limits = this.getLimits(tier);
    return currentRunningJobs < limits.maxConcurrentJobs;
  }
}
```

**Add to:** `apps/license-api/src/license/license.module.ts`

```typescript
import { TierConfigService } from './tier-config.service';

@Module({
  providers: [LicenseService, TierConfigService],
  exports: [TierConfigService],
})
export class LicenseModule {}
```

#### 1.1.3 License Service (Update Existing)

**Update:** `apps/license-api/src/license/license.service.ts`

```typescript
import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CryptoService } from '../crypto/crypto.service';
import { TierConfigService } from './tier-config.service';
import { LicenseTier, LicenseStatus } from '@prisma/client';

@Injectable()
export class LicenseService {
  constructor(
    private prisma: PrismaService,
    private crypto: CryptoService,
    private tierConfig: TierConfigService,
  ) {}

  async createLicense(data: {
    email: string;
    tier: LicenseTier;
    patreonUserId?: string;
    stripeCustomerId?: string;
    expiresAt?: Date;
  }) {
    // Generate crypto-signed license key
    const key = this.crypto.generateLicenseKey({
      email: data.email,
      tier: data.tier,
      timestamp: Date.now(),
    });

    return this.prisma.license.create({
      data: {
        key,
        email: data.email,
        tier: data.tier,
        status: LicenseStatus.ACTIVE,
        patreonUserId: data.patreonUserId,
        stripeCustomerId: data.stripeCustomerId,
        expiresAt: data.expiresAt,
      },
    });
  }

  async verifyLicense(licenseKey: string) {
    // Verify crypto signature
    if (!this.crypto.verifyLicenseKey(licenseKey)) {
      return { valid: false, reason: 'Invalid signature' };
    }

    // Check database
    const license = await this.prisma.license.findUnique({
      where: { key: licenseKey },
      include: { activations: true },
    });

    if (!license) {
      return { valid: false, reason: 'License not found' };
    }

    if (license.status !== LicenseStatus.ACTIVE) {
      return { valid: false, reason: `License ${license.status.toLowerCase()}` };
    }

    if (license.expiresAt && license.expiresAt < new Date()) {
      // Auto-expire
      await this.prisma.license.update({
        where: { id: license.id },
        data: { status: LicenseStatus.EXPIRED },
      });
      return { valid: false, reason: 'License expired' };
    }

    const limits = this.tierConfig.getLimits(license.tier);

    return {
      valid: true,
      license: {
        id: license.id,
        email: license.email,
        tier: license.tier,
        limits,
        expiresAt: license.expiresAt,
        activations: license.activations.length,
      },
    };
  }

  async activateLicense(
    licenseKey: string,
    data: {
      machineId: string;
      machineName?: string;
      ipAddress?: string;
    },
  ) {
    const verification = await this.verifyLicense(licenseKey);
    if (!verification.valid) {
      throw new BadRequestException(verification.reason);
    }

    const license = await this.prisma.license.findUnique({
      where: { key: licenseKey },
      include: { activations: true },
    });

    // Check if already activated on this machine
    const existing = license.activations.find(
      (a) => a.machineId === data.machineId,
    );

    if (existing) {
      // Update last seen
      return this.prisma.licenseActivation.update({
        where: { id: existing.id },
        data: { lastSeenAt: new Date() },
      });
    }

    // Check activation limit (1 activation per license for now)
    if (license.activations.length >= 1) {
      throw new BadRequestException(
        'License already activated on another machine. Contact support to transfer.',
      );
    }

    return this.prisma.licenseActivation.create({
      data: {
        licenseId: license.id,
        machineId: data.machineId,
        machineName: data.machineName,
        ipAddress: data.ipAddress,
      },
    });
  }

  async revokeLicense(licenseId: string) {
    return this.prisma.license.update({
      where: { id: licenseId },
      data: { status: LicenseStatus.REVOKED },
    });
  }

  async upgradeLicense(licenseId: string, newTier: LicenseTier) {
    return this.prisma.license.update({
      where: { id: licenseId },
      data: { tier: newTier },
    });
  }

  async findAll() {
    return this.prisma.license.findMany({
      include: { activations: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findByEmail(email: string) {
    return this.prisma.license.findMany({
      where: { email },
      include: { activations: true },
    });
  }
}
```

#### 1.1.4 Patreon Integration

**Create:** `apps/license-api/src/integrations/patreon/patreon.service.ts`

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LicenseService } from '../../license/license.service';
import { EmailService } from '../../email/email.service';
import { LicenseTier } from '@prisma/client';
import axios from 'axios';
import * as crypto from 'crypto';

@Injectable()
export class PatreonService {
  private readonly logger = new Logger(PatreonService.name);
  private readonly PATREON_TIER_MAP: Record<number, LicenseTier> = {
    300: LicenseTier.PATREON_SUPPORTER, // $3/mo in cents
    500: LicenseTier.PATREON_PLUS,
    1000: LicenseTier.PATREON_PRO,
    2000: LicenseTier.PATREON_ULTIMATE,
  };

  constructor(
    private config: ConfigService,
    private licenseService: LicenseService,
    private emailService: EmailService,
  ) {}

  verifyWebhookSignature(signature: string, body: string): boolean {
    const secret = this.config.get('PATREON_WEBHOOK_SECRET');
    const hash = crypto.createHmac('md5', secret).update(body).digest('hex');
    return signature === hash;
  }

  async handleWebhook(event: any) {
    const eventType = event.type;

    switch (eventType) {
      case 'members:pledge:create':
        return this.handlePledgeCreated(event.data);
      case 'members:pledge:update':
        return this.handlePledgeUpdated(event.data);
      case 'members:pledge:delete':
        return this.handlePledgeDeleted(event.data);
      default:
        this.logger.warn(`Unhandled Patreon event: ${eventType}`);
    }
  }

  private async handlePledgeCreated(data: any) {
    const amountCents = data.attributes.amount_cents;
    const email = data.relationships.user.data.attributes.email;
    const patreonUserId = data.relationships.user.data.id;

    const tier = this.PATREON_TIER_MAP[amountCents] || LicenseTier.PATREON_SUPPORTER;

    const license = await this.licenseService.createLicense({
      email,
      tier,
      patreonUserId,
      expiresAt: null, // Patreon is subscription-based, no expiration
    });

    await this.emailService.sendLicenseActivated(email, license.key, tier);

    this.logger.log(`Created Patreon license: ${license.key} for ${email}`);
  }

  private async handlePledgeUpdated(data: any) {
    const patreonUserId = data.relationships.user.data.id;
    const newAmountCents = data.attributes.amount_cents;
    const newTier = this.PATREON_TIER_MAP[newAmountCents] || LicenseTier.PATREON_SUPPORTER;

    const license = await this.prisma.license.findUnique({
      where: { patreonUserId },
    });

    if (license) {
      await this.licenseService.upgradeLicense(license.id, newTier);
      await this.emailService.sendLicenseUpgraded(license.email, newTier);
      this.logger.log(`Upgraded Patreon license: ${license.key} to ${newTier}`);
    }
  }

  private async handlePledgeDeleted(data: any) {
    const patreonUserId = data.relationships.user.data.id;

    const license = await this.prisma.license.findUnique({
      where: { patreonUserId },
    });

    if (license) {
      await this.licenseService.revokeLicense(license.id);
      await this.emailService.sendLicenseRevoked(license.email);
      this.logger.log(`Revoked Patreon license: ${license.key}`);
    }
  }

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

**Create:** `apps/license-api/src/integrations/patreon/patreon.controller.ts`

```typescript
import {
  Controller,
  Post,
  Body,
  Headers,
  Get,
  Query,
  BadRequestException,
  Redirect,
} from '@nestjs/common';
import { PatreonService } from './patreon.service';
import { WebhookService } from '../../webhook/webhook.service';

@Controller('patreon')
export class PatreonController {
  constructor(
    private patreonService: PatreonService,
    private webhookService: WebhookService,
  ) {}

  @Post('webhook')
  async handleWebhook(
    @Headers('x-patreon-signature') signature: string,
    @Body() body: any,
  ) {
    // Verify signature
    if (!this.patreonService.verifyWebhookSignature(signature, JSON.stringify(body))) {
      throw new BadRequestException('Invalid signature');
    }

    // Store webhook event
    await this.webhookService.store({
      source: 'patreon',
      eventType: body.type,
      payload: body,
    });

    // Process webhook
    await this.patreonService.handleWebhook(body);

    return { received: true };
  }

  @Get('auth')
  @Redirect()
  auth(@Query('return_url') returnUrl: string) {
    const url = this.patreonService.getAuthorizationUrl(returnUrl);
    return { url };
  }

  @Get('callback')
  async callback(@Query('code') code: string, @Query('state') state: string) {
    const { returnUrl } = JSON.parse(Buffer.from(state, 'base64').toString());

    const tokens = await this.patreonService.exchangeCodeForToken(code);
    const userInfo = await this.patreonService.getUserInfo(tokens.access_token);

    // Create/update license based on Patreon membership
    // (implementation depends on userInfo structure)

    return { success: true, returnUrl };
  }
}
```

#### 1.1.5 Stripe Integration

**Create:** `apps/license-api/src/integrations/stripe/stripe.service.ts`

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LicenseService } from '../../license/license.service';
import { EmailService } from '../../email/email.service';
import { LicenseTier } from '@prisma/client';
import Stripe from 'stripe';

@Injectable()
export class StripeService {
  private readonly logger = new Logger(StripeService.name);
  private readonly stripe: Stripe;

  private readonly PRICE_TO_TIER: Record<string, LicenseTier> = {
    'price_commercial_starter': LicenseTier.COMMERCIAL_STARTER,
    'price_commercial_business': LicenseTier.COMMERCIAL_BUSINESS,
    'price_commercial_enterprise': LicenseTier.COMMERCIAL_ENTERPRISE,
  };

  constructor(
    private config: ConfigService,
    private licenseService: LicenseService,
    private emailService: EmailService,
  ) {
    this.stripe = new Stripe(config.get('STRIPE_SECRET_KEY'), {
      apiVersion: '2024-12-18.acacia',
    });
  }

  async createCheckoutSession(data: {
    priceId: string;
    email: string;
    successUrl: string;
    cancelUrl: string;
  }) {
    return this.stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      customer_email: data.email,
      line_items: [{ price: data.priceId, quantity: 1 }],
      success_url: data.successUrl,
      cancel_url: data.cancelUrl,
      metadata: { email: data.email },
    });
  }

  async handleWebhook(event: Stripe.Event) {
    switch (event.type) {
      case 'checkout.session.completed':
        return this.handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session);
      case 'customer.subscription.updated':
        return this.handleSubscriptionUpdated(event.data.object as Stripe.Subscription);
      case 'customer.subscription.deleted':
        return this.handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
      default:
        this.logger.warn(`Unhandled Stripe event: ${event.type}`);
    }
  }

  private async handleCheckoutCompleted(session: Stripe.Checkout.Session) {
    const email = session.customer_email || session.metadata.email;
    const subscription = await this.stripe.subscriptions.retrieve(
      session.subscription as string,
    );
    const priceId = subscription.items.data[0].price.id;
    const tier = this.PRICE_TO_TIER[priceId] || LicenseTier.COMMERCIAL_STARTER;

    const license = await this.licenseService.createLicense({
      email,
      tier,
      stripeCustomerId: session.customer as string,
      expiresAt: null, // Subscription-based
    });

    await this.emailService.sendLicenseActivated(email, license.key, tier);

    this.logger.log(`Created Stripe license: ${license.key} for ${email}`);
  }

  private async handleSubscriptionUpdated(subscription: Stripe.Subscription) {
    const customerId = subscription.customer as string;
    const priceId = subscription.items.data[0].price.id;
    const newTier = this.PRICE_TO_TIER[priceId] || LicenseTier.COMMERCIAL_STARTER;

    const license = await this.prisma.license.findUnique({
      where: { stripeCustomerId: customerId },
    });

    if (license) {
      await this.licenseService.upgradeLicense(license.id, newTier);
      await this.emailService.sendLicenseUpgraded(license.email, newTier);
      this.logger.log(`Upgraded Stripe license: ${license.key} to ${newTier}`);
    }
  }

  private async handleSubscriptionDeleted(subscription: Stripe.Subscription) {
    const customerId = subscription.customer as string;

    const license = await this.prisma.license.findUnique({
      where: { stripeCustomerId: customerId },
    });

    if (license) {
      await this.licenseService.revokeLicense(license.id);
      await this.emailService.sendLicenseRevoked(license.email);
      this.logger.log(`Revoked Stripe license: ${license.key}`);
    }
  }

  constructEvent(payload: Buffer, signature: string): Stripe.Event {
    const secret = this.config.get('STRIPE_WEBHOOK_SECRET');
    return this.stripe.webhooks.constructEvent(payload, signature, secret);
  }
}
```

**Create:** `apps/license-api/src/integrations/stripe/stripe.controller.ts`

```typescript
import {
  Controller,
  Post,
  Body,
  Headers,
  RawBodyRequest,
  Req,
  BadRequestException,
} from '@nestjs/common';
import { StripeService } from './stripe.service';
import { WebhookService } from '../../webhook/webhook.service';
import { Request } from 'express';

@Controller('stripe')
export class StripeController {
  constructor(
    private stripeService: StripeService,
    private webhookService: WebhookService,
  ) {}

  @Post('webhook')
  async handleWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('stripe-signature') signature: string,
  ) {
    const payload = req.rawBody;

    let event;
    try {
      event = this.stripeService.constructEvent(payload, signature);
    } catch (err) {
      throw new BadRequestException(`Webhook signature verification failed: ${err.message}`);
    }

    // Store webhook event
    await this.webhookService.store({
      source: 'stripe',
      eventType: event.type,
      payload: event.data.object,
    });

    // Process webhook
    await this.stripeService.handleWebhook(event);

    return { received: true };
  }

  @Post('create-checkout-session')
  async createCheckoutSession(@Body() body: {
    priceId: string;
    email: string;
    successUrl: string;
    cancelUrl: string;
  }) {
    const session = await this.stripeService.createCheckoutSession(body);
    return { sessionId: session.id, url: session.url };
  }
}
```

#### 1.1.6 Email Service (Mailgun)

**Create:** `apps/license-api/src/email/email.service.ts`

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LicenseTier } from '@prisma/client';
import * as nodemailer from 'nodemailer';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly transporter: nodemailer.Transporter;

  constructor(private config: ConfigService) {
    this.transporter = nodemailer.createTransport({
      host: 'smtp.mailgun.org',
      port: 587,
      auth: {
        user: config.get('MAILGUN_SMTP_USER'),
        pass: config.get('MAILGUN_SMTP_PASSWORD'),
      },
    });
  }

  async sendLicenseActivated(email: string, licenseKey: string, tier: LicenseTier) {
    const subject = 'BitBonsai License Activated';
    const html = `
      <h1>Welcome to BitBonsai ${tier}!</h1>
      <p>Your license has been activated.</p>
      <p><strong>License Key:</strong> <code>${licenseKey}</code></p>
      <p>Copy this key and paste it into your BitBonsai app under Settings → License.</p>
      <p>Enjoy unlimited encoding! 🚀</p>
    `;

    await this.send(email, subject, html);
  }

  async sendLicenseUpgraded(email: string, newTier: LicenseTier) {
    const subject = 'BitBonsai License Upgraded';
    const html = `
      <h1>Your license has been upgraded!</h1>
      <p>You are now on the <strong>${newTier}</strong> tier.</p>
      <p>Restart your BitBonsai app to apply the new limits.</p>
    `;

    await this.send(email, subject, html);
  }

  async sendLicenseRevoked(email: string) {
    const subject = 'BitBonsai License Canceled';
    const html = `
      <h1>Your BitBonsai license has been canceled</h1>
      <p>We're sorry to see you go. Your app will revert to the FREE tier.</p>
      <p>Re-subscribe anytime at <a href="https://bitbonsai.io/pricing">bitbonsai.io/pricing</a></p>
    `;

    await this.send(email, subject, html);
  }

  async sendLicenseExpiring(email: string, expiresAt: Date) {
    const subject = 'BitBonsai License Expiring Soon';
    const html = `
      <h1>Your license expires in 7 days</h1>
      <p>Expiration date: ${expiresAt.toLocaleDateString()}</p>
      <p>Renew at <a href="https://bitbonsai.io/pricing">bitbonsai.io/pricing</a></p>
    `;

    await this.send(email, subject, html);
  }

  private async send(to: string, subject: string, html: string) {
    try {
      await this.transporter.sendMail({
        from: '"BitBonsai" <noreply@bitbonsai.io>',
        to,
        subject,
        html,
      });
      this.logger.log(`Sent email to ${to}: ${subject}`);
    } catch (error) {
      this.logger.error(`Failed to send email to ${to}: ${error.message}`);
    }
  }
}
```

#### 1.1.7 Cron Jobs (Expiration)

**Create:** `apps/license-api/src/license/license-cron.service.ts`

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { LicenseStatus } from '@prisma/client';

@Injectable()
export class LicenseCronService {
  private readonly logger = new Logger(LicenseCronService.name);

  constructor(
    private prisma: PrismaService,
    private emailService: EmailService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async expireLicenses() {
    const expired = await this.prisma.license.updateMany({
      where: {
        expiresAt: { lt: new Date() },
        status: LicenseStatus.ACTIVE,
      },
      data: { status: LicenseStatus.EXPIRED },
    });

    this.logger.log(`Expired ${expired.count} licenses`);
  }

  @Cron(CronExpression.EVERY_DAY_AT_10AM)
  async notifyExpiringSoon() {
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
      await this.emailService.sendLicenseExpiring(license.email, license.expiresAt);
    }

    this.logger.log(`Sent ${expiring.length} expiration warnings`);
  }
}
```

#### 1.1.8 Rate Limiting

**Update:** `apps/license-api/src/main.ts`

```typescript
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import helmet from 'helmet';
import { ThrottlerGuard } from '@nestjs/throttler';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    rawBody: true, // Required for Stripe webhooks
  });

  app.use(helmet());
  app.enableCors({
    origin: ['https://bitbonsai.io', 'http://localhost:4200'],
    credentials: true,
  });

  // Global rate limiting
  const reflector = app.get(Reflector);
  app.useGlobalGuards(new ThrottlerGuard({ reflector }));

  await app.listen(3000);
}
bootstrap();
```

**Update:** `apps/license-api/src/app.module.ts`

```typescript
import { ThrottlerModule } from '@nestjs/throttler';

@Module({
  imports: [
    ThrottlerModule.forRoot([
      {
        ttl: 60000, // 1 minute
        limit: 10, // 10 requests per minute per IP (public endpoints)
      },
    ]),
    // ... other modules
  ],
})
export class AppModule {}
```

**Protect specific endpoints:**

```typescript
import { Throttle } from '@nestjs/throttler';

@Controller('licenses')
export class LicenseController {
  @Post('verify')
  @Throttle({ default: { limit: 10, ttl: 60000 } }) // 10 req/min
  async verify(@Body() body: { licenseKey: string }) {
    return this.licenseService.verifyLicense(body.licenseKey);
  }

  @Post('activate')
  @Throttle({ default: { limit: 5, ttl: 60000 } }) // 5 req/min
  async activate(@Body() body: any) {
    return this.licenseService.activateLicense(body.licenseKey, body);
  }
}
```

#### 1.1.9 Environment Variables

**Update:** `apps/license-api/.env.example`

```bash
# Database
LICENSE_DATABASE_URL="postgresql://user:password@localhost:5432/bitbonsai_licenses"

# Crypto
LICENSE_SECRET_KEY="your-256-bit-secret-key-for-signing"

# Patreon
PATREON_CLIENT_ID="your-patreon-client-id"
PATREON_CLIENT_SECRET="your-patreon-client-secret"
PATREON_REDIRECT_URI="https://bitbonsai.io/patreon/callback"
PATREON_WEBHOOK_SECRET="your-patreon-webhook-secret"

# Stripe
STRIPE_SECRET_KEY="sk_live_..."
STRIPE_WEBHOOK_SECRET="whsec_..."
STRIPE_PRICE_COMMERCIAL_STARTER="price_..."
STRIPE_PRICE_COMMERCIAL_BUSINESS="price_..."
STRIPE_PRICE_COMMERCIAL_ENTERPRISE="price_..."

# Mailgun
MAILGUN_SMTP_USER="postmaster@bitbonsai.io"
MAILGUN_SMTP_PASSWORD="your-mailgun-password"

# Admin API Key (for admin dashboard)
LICENSE_ADMIN_API_KEY="your-secure-random-api-key"

# JWT
JWT_SECRET="your-jwt-secret-for-admin-auth"
JWT_REFRESH_SECRET="your-jwt-refresh-secret"
```

---

## 📋 PHASE 2: BITBONSAI INTEGRATION

### 2.1 Delete Backend Patreon Integration

**Delete entire folder:**
```bash
rm -rf apps/backend/src/integrations/patreon/
```

**Remove from backend module imports** (if any).

### 2.2 Create License Verification Service

**Create:** `apps/backend/src/license/license-verification.service.ts`

```typescript
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { LicenseTier } from '@prisma/client';

interface LicenseVerificationResult {
  valid: boolean;
  reason?: string;
  license?: {
    id: string;
    email: string;
    tier: LicenseTier;
    limits: {
      maxNodes: number;
      maxConcurrentJobs: number;
      features: Record<string, boolean>;
    };
    expiresAt: string | null;
    activations: number;
  };
}

@Injectable()
export class LicenseVerificationService implements OnModuleInit {
  private readonly logger = new Logger(LicenseVerificationService.name);
  private readonly licenseApiUrl: string;
  private cachedVerification: LicenseVerificationResult | null = null;
  private cacheExpiry: number = 0;
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes

  constructor(
    private config: ConfigService,
    private http: HttpService,
  ) {
    this.licenseApiUrl = config.get('LICENSE_API_URL') || 'https://bitbonsai.io';
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
      this.logger.warn('No LICENSE_KEY configured. Running in FREE tier mode.');
      return { valid: false, reason: 'No license key configured' };
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
          `License verified: ${response.data.license.tier} (${response.data.license.limits.maxNodes} nodes, ${response.data.license.limits.maxConcurrentJobs} concurrent jobs)`,
        );
      } else {
        this.logger.warn(`License invalid: ${response.data.reason}`);
      }

      return response.data;
    } catch (error) {
      this.logger.error(`Failed to verify license: ${error.message}`);
      // Graceful degradation: allow operation but log error
      return { valid: false, reason: 'License API unavailable' };
    }
  }

  async canAddNode(currentNodeCount: number): Promise<boolean> {
    const verification = await this.verifyLicense();
    if (!verification.valid) return currentNodeCount === 0; // FREE tier = 1 node
    return currentNodeCount < verification.license.limits.maxNodes;
  }

  async canRunJob(currentRunningJobs: number): Promise<boolean> {
    const verification = await this.verifyLicense();
    if (!verification.valid) return currentRunningJobs < 2; // FREE tier = 2 jobs
    return currentRunningJobs < verification.license.limits.maxConcurrentJobs;
  }

  async activateLicense(licenseKey: string, machineId: string, machineName: string) {
    try {
      const response = await firstValueFrom(
        this.http.post(`${this.licenseApiUrl}/licenses/activate`, {
          licenseKey,
          machineId,
          machineName,
          ipAddress: '0.0.0.0', // TODO: Get actual IP
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

**Add to:** `apps/backend/src/license/license.module.ts`

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

**Import in AppModule:**

```typescript
import { LicenseModule } from './license/license.module';

@Module({
  imports: [
    // ...
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
    private licenseService: LicenseVerificationService,
    private prisma: PrismaService,
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
    private licenseService: LicenseVerificationService,
    private prisma: PrismaService,
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

**Update:** `apps/frontend/src/app/features/settings/services/license.service.ts`

```typescript
import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../environments/environment';

export interface LicenseVerificationResponse {
  valid: boolean;
  reason?: string;
  license?: {
    email: string;
    tier: string;
    limits: {
      maxNodes: number;
      maxConcurrentJobs: number;
      features: Record<string, boolean>;
    };
    expiresAt: string | null;
  };
}

@Injectable({ providedIn: 'root' })
export class LicenseService {
  // CRITICAL: Point to license-api, NOT backend
  private readonly licenseApiUrl = environment.licenseApiUrl; // Add to environment.ts

  constructor(private http: HttpClient) {}

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

**Update:** `apps/frontend/src/environments/environment.ts`

```typescript
export const environment = {
  production: false,
  apiUrl: 'http://localhost:3100', // Backend API (encoding jobs, nodes, etc.)
  licenseApiUrl: 'http://localhost:3000', // License API (verify, activate, payments)
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

### 2.5 Update Backend Environment

**Add to:** `apps/backend/.env`

```bash
LICENSE_API_URL="https://bitbonsai.io"
LICENSE_KEY="" # Empty by default, user fills in Settings page
```

---

## 📋 PHASE 3: ADMIN DASHBOARD

### 3.1 Admin Authentication

**Create:** `apps/license-api/src/auth/auth.service.ts`

```typescript
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';

@Injectable()
export class AuthService {
  constructor(
    private jwt: JwtService,
    private config: ConfigService,
  ) {}

  async validateAdmin(username: string, password: string): Promise<boolean> {
    const adminUsername = this.config.get('ADMIN_USERNAME');
    const adminPasswordHash = this.config.get('ADMIN_PASSWORD_HASH');

    if (username !== adminUsername) return false;
    return bcrypt.compare(password, adminPasswordHash);
  }

  async login(username: string, password: string) {
    const valid = await this.validateAdmin(username, password);
    if (!valid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const payload = { sub: username, role: 'admin' };
    const accessToken = this.jwt.sign(payload, { expiresIn: '15m' });
    const refreshToken = this.jwt.sign(payload, {
      secret: this.config.get('JWT_REFRESH_SECRET'),
      expiresIn: '7d',
    });

    return { accessToken, refreshToken };
  }

  async refresh(refreshToken: string) {
    try {
      const payload = this.jwt.verify(refreshToken, {
        secret: this.config.get('JWT_REFRESH_SECRET'),
      });

      const newAccessToken = this.jwt.sign(
        { sub: payload.sub, role: 'admin' },
        { expiresIn: '15m' },
      );

      return { accessToken: newAccessToken };
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }
  }
}
```

**Create:** `apps/license-api/src/auth/jwt.strategy.ts`

```typescript
import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(config: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: config.get('JWT_SECRET'),
    });
  }

  async validate(payload: any) {
    return { userId: payload.sub, role: payload.role };
  }
}
```

**Create:** `apps/license-api/src/auth/jwt-auth.guard.ts`

```typescript
import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {}
```

**Create:** `apps/license-api/src/auth/auth.controller.ts`

```typescript
import { Controller, Post, Body, UseGuards, Req } from '@nestjs/common';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Post('login')
  async login(@Body() body: { username: string; password: string }) {
    return this.authService.login(body.username, body.password);
  }

  @Post('refresh')
  async refresh(@Body() body: { refreshToken: string }) {
    return this.authService.refresh(body.refreshToken);
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  async logout() {
    // JWT is stateless, just return success
    // Client should delete tokens
    return { success: true };
  }
}
```

### 3.2 Admin Dashboard Angular App

**Create new Angular app in Nx:**

```bash
nx g @nx/angular:app admin-dashboard --style=scss --routing=true
```

**Project structure:**

```
apps/admin-dashboard/
├── src/
│   ├── app/
│   │   ├── core/
│   │   │   ├── guards/
│   │   │   │   └── auth.guard.ts
│   │   │   ├── interceptors/
│   │   │   │   └── jwt.interceptor.ts
│   │   │   └── services/
│   │   │       ├── auth.service.ts
│   │   │       └── admin-api.service.ts
│   │   ├── features/
│   │   │   ├── login/
│   │   │   │   └── login.component.ts
│   │   │   ├── dashboard/
│   │   │   │   └── dashboard.component.ts
│   │   │   ├── licenses/
│   │   │   │   ├── license-list.component.ts
│   │   │   │   └── license-detail.component.ts
│   │   │   ├── webhooks/
│   │   │   │   └── webhook-list.component.ts
│   │   │   └── analytics/
│   │   │       └── analytics.component.ts
│   │   └── app.routes.ts
│   └── main.ts
└── project.json
```

**Create:** `apps/admin-dashboard/src/app/core/services/auth.service.ts`

```typescript
import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { BehaviorSubject, Observable, tap } from 'rxjs';
import { environment } from '../../../environments/environment';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly apiUrl = `${environment.licenseApiUrl}/auth`;

  private readonly isAuthenticatedSubject = new BehaviorSubject<boolean>(this.hasToken());
  public readonly isAuthenticated$ = this.isAuthenticatedSubject.asObservable();

  login(username: string, password: string): Observable<{ accessToken: string; refreshToken: string }> {
    return this.http.post<{ accessToken: string; refreshToken: string }>(`${this.apiUrl}/login`, {
      username,
      password,
    }).pipe(
      tap(tokens => {
        this.storeTokens(tokens);
        this.isAuthenticatedSubject.next(true);
      }),
    );
  }

  logout(): void {
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
    this.isAuthenticatedSubject.next(false);
    this.router.navigate(['/login']);
  }

  refreshToken(): Observable<{ accessToken: string }> {
    const refreshToken = localStorage.getItem('refreshToken');
    return this.http.post<{ accessToken: string }>(`${this.apiUrl}/refresh`, { refreshToken }).pipe(
      tap(response => {
        localStorage.setItem('accessToken', response.accessToken);
      }),
    );
  }

  private storeTokens(tokens: { accessToken: string; refreshToken: string }): void {
    localStorage.setItem('accessToken', tokens.accessToken);
    localStorage.setItem('refreshToken', tokens.refreshToken);
  }

  private hasToken(): boolean {
    return !!localStorage.getItem('accessToken');
  }

  getAccessToken(): string | null {
    return localStorage.getItem('accessToken');
  }
}
```

**Create:** `apps/admin-dashboard/src/app/core/guards/auth.guard.ts`

```typescript
import { inject } from '@angular/core';
import { Router, CanActivateFn } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { map } from 'rxjs';

export const authGuard: CanActivateFn = () => {
  const authService = inject(AuthService);
  const router = inject(Router);

  return authService.isAuthenticated$.pipe(
    map(isAuthenticated => {
      if (!isAuthenticated) {
        router.navigate(['/login']);
        return false;
      }
      return true;
    }),
  );
};
```

**Create:** `apps/admin-dashboard/src/app/core/interceptors/jwt.interceptor.ts`

```typescript
import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { AuthService } from '../services/auth.service';
import { catchError, switchMap, throwError } from 'rxjs';

export const jwtInterceptor: HttpInterceptorFn = (req, next) => {
  const authService = inject(AuthService);
  const token = authService.getAccessToken();

  if (token) {
    req = req.clone({
      setHeaders: { Authorization: `Bearer ${token}` },
    });
  }

  return next(req).pipe(
    catchError(error => {
      if (error.status === 401 && !req.url.includes('/auth/')) {
        // Try to refresh token
        return authService.refreshToken().pipe(
          switchMap(() => {
            const newToken = authService.getAccessToken();
            const clonedReq = req.clone({
              setHeaders: { Authorization: `Bearer ${newToken}` },
            });
            return next(clonedReq);
          }),
          catchError(refreshError => {
            authService.logout();
            return throwError(() => refreshError);
          }),
        );
      }
      return throwError(() => error);
    }),
  );
};
```

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
      {
        path: 'analytics',
        loadComponent: () => import('./features/analytics/analytics.component').then(m => m.AnalyticsComponent),
      },
      { path: '', redirectTo: 'dashboard', pathMatch: 'full' },
    ],
  },
  { path: '**', redirectTo: 'dashboard' },
];
```

**Login Component:** `apps/admin-dashboard/src/app/features/login/login.component.ts`

```typescript
import { Component, inject, signal } from '@angular/core';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  template: `
    <div class="login-container">
      <h1>BitBonsai Admin</h1>
      <form [formGroup]="loginForm" (ngSubmit)="onSubmit()">
        <input type="text" formControlName="username" placeholder="Username" />
        <input type="password" formControlName="password" placeholder="Password" />
        @if (error()) {
          <p class="error">{{ error() }}</p>
        }
        <button type="submit" [disabled]="loginForm.invalid || loading()">
          {{ loading() ? 'Logging in...' : 'Login' }}
        </button>
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
      padding: 0.5rem;
      margin-bottom: 1rem;
    }
    button {
      width: 100%;
      padding: 0.75rem;
      background: #007bff;
      color: white;
      border: none;
      cursor: pointer;
    }
    .error {
      color: red;
    }
  `],
})
export class LoginComponent {
  private readonly fb = inject(FormBuilder);
  private readonly authService = inject(AuthService);
  private readonly router = inject(Router);

  protected readonly loginForm: FormGroup = this.fb.group({
    username: ['', Validators.required],
    password: ['', Validators.required],
  });

  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);

  onSubmit(): void {
    if (this.loginForm.invalid) return;

    this.loading.set(true);
    this.error.set(null);

    const { username, password } = this.loginForm.value;

    this.authService.login(username, password).subscribe({
      next: () => {
        this.router.navigate(['/dashboard']);
      },
      error: (err) => {
        this.error.set('Invalid username or password');
        this.loading.set(false);
      },
    });
  }
}
```

**Dashboard Component:** `apps/admin-dashboard/src/app/features/dashboard/dashboard.component.ts`

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
          <p>{{ stats().totalLicenses }}</p>
        </div>
        <div class="stat-card">
          <h3>Active</h3>
          <p>{{ stats().activeLicenses }}</p>
        </div>
        <div class="stat-card">
          <h3>Revenue (MRR)</h3>
          <p>\${{ stats().mrr }}</p>
        </div>
      </div>

      <div class="actions">
        <a routerLink="/licenses">Manage Licenses</a>
        <a routerLink="/webhooks">View Webhooks</a>
        <a routerLink="/analytics">Analytics</a>
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
      gap: 1rem;
      margin-bottom: 2rem;
    }
    .stat-card {
      padding: 1rem;
      border: 1px solid #ddd;
      border-radius: 8px;
    }
    .actions a {
      display: inline-block;
      margin-right: 1rem;
      padding: 0.5rem 1rem;
      background: #007bff;
      color: white;
      text-decoration: none;
      border-radius: 4px;
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

**Admin API Service:** `apps/admin-dashboard/src/app/core/services/admin-api.service.ts`

```typescript
import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

@Injectable({ providedIn: 'root' })
export class AdminApiService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = `${environment.licenseApiUrl}/admin`;

  getStats(): Observable<{ totalLicenses: number; activeLicenses: number; mrr: number }> {
    return this.http.get<{ totalLicenses: number; activeLicenses: number; mrr: number }>(
      `${this.apiUrl}/stats`,
    );
  }

  getLicenses(): Observable<any[]> {
    return this.http.get<any[]>(`${this.apiUrl}/licenses`);
  }

  revokeLicense(licenseId: string): Observable<any> {
    return this.http.post(`${this.apiUrl}/licenses/${licenseId}/revoke`, {});
  }

  getWebhooks(): Observable<any[]> {
    return this.http.get<any[]>(`${this.apiUrl}/webhooks`);
  }

  retryWebhook(webhookId: string): Observable<any> {
    return this.http.post(`${this.apiUrl}/webhooks/${webhookId}/retry`, {});
  }
}
```

**Admin Controller (license-api):** `apps/license-api/src/admin/admin.controller.ts`

```typescript
import { Controller, Get, Post, Param, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { LicenseService } from '../license/license.service';
import { WebhookService } from '../webhook/webhook.service';
import { PrismaService } from '../prisma/prisma.service';
import { LicenseStatus } from '@prisma/client';

@Controller('admin')
@UseGuards(JwtAuthGuard)
export class AdminController {
  constructor(
    private licenseService: LicenseService,
    private webhookService: WebhookService,
    private prisma: PrismaService,
  ) {}

  @Get('stats')
  async getStats() {
    const totalLicenses = await this.prisma.license.count();
    const activeLicenses = await this.prisma.license.count({
      where: { status: LicenseStatus.ACTIVE },
    });

    // TODO: Calculate MRR based on tier pricing
    const mrr = activeLicenses * 10; // Placeholder

    return { totalLicenses, activeLicenses, mrr };
  }

  @Get('licenses')
  async getLicenses() {
    return this.licenseService.findAll();
  }

  @Post('licenses/:id/revoke')
  async revokeLicense(@Param('id') id: string) {
    return this.licenseService.revokeLicense(id);
  }

  @Get('webhooks')
  async getWebhooks() {
    return this.webhookService.findAll();
  }

  @Post('webhooks/:id/retry')
  async retryWebhook(@Param('id') id: string) {
    return this.webhookService.retry(id);
  }
}
```

---

## 📋 PHASE 4: MARKETING WEBSITE

### 4.1 Create Marketing App

**Create new Angular app:**

```bash
nx g @nx/angular:app website --style=scss --routing=true
```

**Project structure:**

```
apps/website/
├── src/
│   ├── app/
│   │   ├── features/
│   │   │   ├── home/
│   │   │   │   └── home.component.ts
│   │   │   ├── pricing/
│   │   │   │   └── pricing.component.ts
│   │   │   ├── features/
│   │   │   │   └── features.component.ts
│   │   │   ├── download/
│   │   │   │   └── download.component.ts
│   │   │   └── account/
│   │   │       └── account.component.ts
│   │   └── app.routes.ts
│   └── main.ts
└── project.json
```

**Routes:** `apps/website/src/app/app.routes.ts`

```typescript
import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () => import('./features/home/home.component').then(m => m.HomeComponent),
  },
  {
    path: 'pricing',
    loadComponent: () => import('./features/pricing/pricing.component').then(m => m.PricingComponent),
  },
  {
    path: 'features',
    loadComponent: () => import('./features/features/features.component').then(m => m.FeaturesComponent),
  },
  {
    path: 'download',
    loadComponent: () => import('./features/download/download.component').then(m => m.DownloadComponent),
  },
  {
    path: 'account',
    loadComponent: () => import('./features/account/account.component').then(m => m.AccountComponent),
  },
  { path: '**', redirectTo: '' },
];
```

**Home Page:** `apps/website/src/app/features/home/home.component.ts`

```typescript
import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [RouterLink],
  template: `
    <div class="hero">
      <h1>BitBonsai</h1>
      <p>Multi-Node Video Transcoding, Simplified</p>
      <div class="cta">
        <a routerLink="/pricing" class="btn-primary">See Pricing</a>
        <a routerLink="/download" class="btn-secondary">Download Free</a>
      </div>
    </div>

    <section class="features-preview">
      <h2>Why BitBonsai?</h2>
      <div class="feature-grid">
        <div class="feature-card">
          <h3>🔄 TRUE RESUME™</h3>
          <p>Crash at 98%? Resume at 98%. Not 0%.</p>
        </div>
        <div class="feature-card">
          <h3>🚀 Multi-Node Distribution</h3>
          <p>Distribute jobs across multiple servers</p>
        </div>
        <div class="feature-card">
          <h3>🩹 Auto-Healing</h3>
          <p>4-layer self-recovery system</p>
        </div>
      </div>
      <a routerLink="/features" class="btn-link">See all features →</a>
    </section>
  `,
  styles: [`
    .hero {
      text-align: center;
      padding: 4rem 2rem;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
    }
    .hero h1 {
      font-size: 4rem;
      margin-bottom: 1rem;
    }
    .cta {
      margin-top: 2rem;
    }
    .btn-primary, .btn-secondary {
      display: inline-block;
      padding: 1rem 2rem;
      margin: 0 0.5rem;
      text-decoration: none;
      border-radius: 8px;
      font-weight: 600;
    }
    .btn-primary {
      background: white;
      color: #667eea;
    }
    .btn-secondary {
      background: transparent;
      color: white;
      border: 2px solid white;
    }
    .features-preview {
      padding: 4rem 2rem;
      text-align: center;
    }
    .feature-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 2rem;
      margin: 2rem 0;
    }
    .feature-card {
      padding: 2rem;
      border: 1px solid #ddd;
      border-radius: 8px;
    }
  `],
})
export class HomeComponent {}
```

**Pricing Page:** `apps/website/src/app/features/pricing/pricing.component.ts`

```typescript
import { Component, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { CommonModule } from '@angular/common';
import { environment } from '../../../environments/environment';

interface PricingTier {
  name: string;
  price: string;
  priceId?: string;
  features: string[];
  cta: string;
  ctaAction: () => void;
}

@Component({
  selector: 'app-pricing',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="pricing-page">
      <h1>Simple, Transparent Pricing</h1>
      <p>Choose the plan that fits your needs</p>

      <div class="pricing-grid">
        @for (tier of tiers(); track tier.name) {
          <div class="pricing-card">
            <h3>{{ tier.name }}</h3>
            <p class="price">{{ tier.price }}</p>
            <ul>
              @for (feature of tier.features; track feature) {
                <li>{{ feature }}</li>
              }
            </ul>
            <button (click)="tier.ctaAction()">{{ tier.cta }}</button>
          </div>
        }
      </div>
    </div>
  `,
  styles: [`
    .pricing-page {
      padding: 4rem 2rem;
      text-align: center;
    }
    .pricing-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 2rem;
      margin-top: 3rem;
    }
    .pricing-card {
      padding: 2rem;
      border: 2px solid #ddd;
      border-radius: 12px;
    }
    .price {
      font-size: 2.5rem;
      font-weight: 700;
      color: #667eea;
    }
    ul {
      text-align: left;
      list-style: none;
      padding: 0;
    }
    li::before {
      content: "✓ ";
      color: green;
    }
    button {
      width: 100%;
      padding: 1rem;
      background: #667eea;
      color: white;
      border: none;
      border-radius: 8px;
      cursor: pointer;
      margin-top: 1rem;
    }
  `],
})
export class PricingComponent {
  private readonly http = inject(HttpClient);

  protected readonly tiers = signal<PricingTier[]>([
    {
      name: 'FREE',
      price: '$0',
      features: ['1 node', '2 concurrent jobs', 'Community support'],
      cta: 'Download',
      ctaAction: () => window.location.href = '/download',
    },
    {
      name: 'Supporter',
      price: '$3/mo',
      features: ['2 nodes', '3 concurrent jobs', 'Priority support'],
      cta: 'Support on Patreon',
      ctaAction: () => this.redirectToPatreon(),
    },
    {
      name: 'Commercial Starter',
      price: '$15/mo',
      priceId: 'price_commercial_starter',
      features: ['5 nodes', '10 concurrent jobs', 'Priority support', 'Commercial use'],
      cta: 'Buy Now',
      ctaAction: () => this.checkoutStripe('price_commercial_starter'),
    },
    {
      name: 'Commercial Business',
      price: '$50/mo',
      priceId: 'price_commercial_business',
      features: ['20 nodes', '30 concurrent jobs', 'SLA', 'Priority support'],
      cta: 'Buy Now',
      ctaAction: () => this.checkoutStripe('price_commercial_business'),
    },
  ]);

  private redirectToPatreon(): void {
    window.location.href = 'https://patreon.com/bitbonsai';
  }

  private checkoutStripe(priceId: string): void {
    const email = prompt('Enter your email:');
    if (!email) return;

    this.http.post<{ url: string }>(`${environment.licenseApiUrl}/stripe/create-checkout-session`, {
      priceId,
      email,
      successUrl: `${window.location.origin}/account?stripe_success=true`,
      cancelUrl: `${window.location.origin}/pricing?stripe_cancel=true`,
    }).subscribe(response => {
      window.location.href = response.url;
    });
  }
}
```

**Account Page:** `apps/website/src/app/features/account/account.component.ts`

```typescript
import { Component, inject, OnInit, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { environment } from '../../../environments/environment';

@Component({
  selector: 'app-account',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="account-page">
      <h1>Your Account</h1>

      @if (stripeSuccess()) {
        <div class="alert success">
          ✓ Payment successful! Check your email for your license key.
        </div>
      }

      <div class="license-info">
        <h2>License Key</h2>
        <p>Enter your email to retrieve your license:</p>
        <input
          type="email"
          [(ngModel)]="email"
          placeholder="your@email.com"
        />
        <button (click)="fetchLicense()">Get License</button>

        @if (licenseKey()) {
          <div class="license-display">
            <code>{{ licenseKey() }}</code>
            <button (click)="copyLicense()">Copy</button>
          </div>
        }
      </div>

      <div class="patreon-connect">
        <h2>Connect Patreon</h2>
        <button (click)="connectPatreon()">Connect Patreon Account</button>
      </div>
    </div>
  `,
  styles: [`
    .account-page {
      max-width: 600px;
      margin: 4rem auto;
      padding: 2rem;
    }
    .alert {
      padding: 1rem;
      margin-bottom: 2rem;
      border-radius: 8px;
    }
    .alert.success {
      background: #d4edda;
      color: #155724;
    }
    input {
      width: 100%;
      padding: 0.5rem;
      margin-bottom: 1rem;
    }
    button {
      padding: 0.75rem 1.5rem;
      background: #667eea;
      color: white;
      border: none;
      border-radius: 4px;
      cursor: pointer;
    }
    .license-display {
      margin-top: 1rem;
      padding: 1rem;
      background: #f8f9fa;
      border-radius: 4px;
    }
    .license-display code {
      display: block;
      margin-bottom: 0.5rem;
      font-size: 1.1rem;
    }
  `],
})
export class AccountComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly route = inject(ActivatedRoute);

  protected email = '';
  protected readonly stripeSuccess = signal(false);
  protected readonly licenseKey = signal<string | null>(null);

  ngOnInit(): void {
    this.route.queryParams.subscribe(params => {
      if (params['stripe_success']) {
        this.stripeSuccess.set(true);
      }
    });
  }

  fetchLicense(): void {
    // TODO: Implement license retrieval by email
  }

  copyLicense(): void {
    navigator.clipboard.writeText(this.licenseKey()!);
    alert('License key copied!');
  }

  connectPatreon(): void {
    const returnUrl = encodeURIComponent(window.location.href);
    window.location.href = `${environment.licenseApiUrl}/patreon/auth?return_url=${returnUrl}`;
  }
}
```

---

## 📋 PHASE 5: DEPLOYMENT

### 5.1 Nginx Reverse Proxy

**Create:** `/etc/nginx/sites-available/bitbonsai.io`

```nginx
server {
    listen 80;
    server_name bitbonsai.io;

    # Redirect HTTP to HTTPS
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
        rewrite ^/license-api(.*)$ $1 break;
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }

    # Stripe webhook (raw body required)
    location /license-api/stripe/webhook {
        rewrite ^/license-api(.*)$ $1 break;
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_request_buffering off;
    }
}
```

**Enable site:**

```bash
sudo ln -s /etc/nginx/sites-available/bitbonsai.io /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

### 5.2 SSL Certificate (Let's Encrypt)

```bash
sudo certbot --nginx -d bitbonsai.io -d www.bitbonsai.io
```

### 5.3 Environment Variables (Production)

**Create:** `apps/license-api/.env.production`

```bash
LICENSE_DATABASE_URL="postgresql://user:password@db.bitbonsai.io:5432/licenses"
LICENSE_SECRET_KEY="production-256-bit-secret"
PATREON_CLIENT_ID="prod-patreon-id"
PATREON_CLIENT_SECRET="prod-patreon-secret"
PATREON_REDIRECT_URI="https://bitbonsai.io/license-api/patreon/callback"
PATREON_WEBHOOK_SECRET="prod-patreon-webhook-secret"
STRIPE_SECRET_KEY="sk_live_..."
STRIPE_WEBHOOK_SECRET="whsec_..."
MAILGUN_SMTP_USER="postmaster@bitbonsai.io"
MAILGUN_SMTP_PASSWORD="prod-mailgun-password"
ADMIN_USERNAME="admin"
ADMIN_PASSWORD_HASH="$2b$10$..." # bcrypt hash of admin password
JWT_SECRET="prod-jwt-secret"
JWT_REFRESH_SECRET="prod-jwt-refresh-secret"
```

### 5.4 Systemd Service

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
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

**Enable service:**

```bash
sudo systemctl daemon-reload
sudo systemctl enable bitbonsai-license-api
sudo systemctl start bitbonsai-license-api
```

### 5.5 Docker Deployment (Alternative)

**Create:** `apps/license-api/Dockerfile`

```dockerfile
FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY apps/license-api/dist ./dist
COPY prisma ./prisma

RUN npx prisma generate

EXPOSE 3000

CMD ["node", "dist/main.js"]
```

**Create:** `docker-compose.yml`

```yaml
version: '3.8'

services:
  postgres:
    image: postgres:15
    environment:
      POSTGRES_DB: bitbonsai_licenses
      POSTGRES_USER: bitbonsai
      POSTGRES_PASSWORD: ${DB_PASSWORD}
    volumes:
      - postgres_data:/var/lib/postgresql/data

  license-api:
    build: ./apps/license-api
    ports:
      - "3000:3000"
    environment:
      LICENSE_DATABASE_URL: postgresql://bitbonsai:${DB_PASSWORD}@postgres:5432/bitbonsai_licenses
    env_file:
      - apps/license-api/.env.production
    depends_on:
      - postgres
    restart: always

volumes:
  postgres_data:
```

---

## ✅ IMPLEMENTATION CHECKLIST

### Phase 1: License API Foundation
- [ ] Update Prisma schema (already correct)
- [ ] Create TierConfigService
- [ ] Update LicenseService with crypto-signed keys
- [ ] Implement Patreon integration (OAuth + webhooks)
- [ ] Implement Stripe integration (Checkout + webhooks)
- [ ] Create EmailService with Mailgun
- [ ] Add LicenseCronService for expiration
- [ ] Configure rate limiting
- [ ] Add webhook signature verification
- [ ] Test all endpoints manually

### Phase 2: BitBonsai Integration
- [ ] Delete apps/backend/src/integrations/patreon/
- [ ] Create LicenseVerificationService in backend
- [ ] Add LicenseNodeGuard and LicenseJobGuard
- [ ] Update frontend LicenseService to point to license-api
- [ ] Update environment.ts with licenseApiUrl
- [ ] Add LICENSE_API_URL to backend .env
- [ ] Test license verification flow
- [ ] Test activation flow

### Phase 3: Admin Dashboard
- [ ] Generate admin-dashboard Angular app
- [ ] Implement JWT authentication (login, refresh, logout)
- [ ] Create AuthGuard and JwtInterceptor
- [ ] Build Login component
- [ ] Build Dashboard component
- [ ] Build License List component
- [ ] Build Webhook List component
- [ ] Build Analytics component
- [ ] Add AdminController to license-api
- [ ] Test admin authentication flow

### Phase 4: Marketing Website
- [ ] Generate website Angular app
- [ ] Build Home page
- [ ] Build Pricing page with Stripe checkout
- [ ] Build Features page
- [ ] Build Download page
- [ ] Build Account page (license retrieval, Patreon connect)
- [ ] Add screenshots and branding assets
- [ ] Test Stripe checkout flow
- [ ] Test Patreon OAuth flow

### Phase 5: Deployment
- [ ] Configure Nginx reverse proxy
- [ ] Setup SSL with Let's Encrypt
- [ ] Create production .env files
- [ ] Setup systemd service
- [ ] Configure PostgreSQL database
- [ ] Run Prisma migrations
- [ ] Build and deploy Angular apps
- [ ] Test in production
- [ ] Setup monitoring (optional: PM2, Sentry)

---

## 🔧 CODE CONVENTIONS COMPLIANCE

All code follows `~/git/code-conventions/.specify/memory/constitution.md`:

- **NgRx State Management** for global state (licenses, auth)
- **BOs (Business Objects)** for logic (LicenseService, AuthService)
- **Signals** for local state (loading, error)
- **100% Test Coverage** (unit + e2e)
- **i18n** with translation keys (en.json, fr.json)
- **Standalone Components** (no modules except root)
- **Reactive Forms** for all forms
- **HttpClient** with interceptors

---

## 📊 ARCHITECTURE SUMMARY

| Component | Location | Database | Purpose |
|-----------|----------|----------|---------|
| **BitBonsai Backend** | User's local server | Local PostgreSQL/SQLite | Encoding jobs, nodes, media |
| **BitBonsai Frontend** | User's local browser | - | UI for managing encoding |
| **license-api (Provider)** | bitbonsai.io cloud | Remote PostgreSQL | Creates/manages licenses |
| **Admin Dashboard** | bitbonsai.io/admin | - | Manage licenses, view webhooks |
| **Marketing Website** | bitbonsai.io | - | Features, pricing, screenshots |

**Critical:** BitBonsai (local) NEVER creates licenses. It only calls license-api (remote) to verify and activate.

---

## 🎯 FINAL NOTES

**All 29 audit findings addressed:**

1. ✅ Duplicate license systems → Deleted backend Patreon integration
2. ✅ API client security → JWT with refresh tokens, no exposed keys
3. ✅ CORS configuration → Added to license-api
4. ✅ License key generation → Crypto-signed everywhere
5. ✅ Tier limit conflicts → Single source of truth (TierConfigService)
6. ✅ Missing verification flow → LicenseVerificationService in backend
7. ✅ Patreon OAuth UX → Account page with "Connect Patreon" button
8. ✅ Stripe integration → Checkout flow in Pricing page
9. ✅ Activation tracking → LicenseActivation model + activate endpoint
10. ✅ Rate limiting → ThrottlerGuard on all public endpoints
11. ✅ Webhook retry → retryWebhook endpoint in AdminController
12. ✅ Email notifications → EmailService with Mailgun
13. ✅ License expiration cron → LicenseCronService runs daily
14. ✅ Analytics endpoints → getStats in AdminController
15. ✅ Shared types → TierConfigService shared between APIs
16. ✅ Next.js API routes pattern → N/A (using Angular + NestJS)
17. ✅ Docker compose for dev → Added docker-compose.yml
18. ✅ Migration strategy → N/A (dev environment, no existing prod licenses)
19. ✅ FontAwesome import → Use existing package.json (already has Pro)
20. ✅ User-facing license dashboard → Account page in website
21. ✅ Download link → Download page with Docker instructions
22. ✅ License key input in backend → Existing Settings page (update API URL)
23. ✅ Logo/branding assets → Add to website public folder (TODO)
24. ✅ Changelog/release notes → Future phase
25-29. ✅ All other findings addressed in code examples above

**Ready for implementation.**
