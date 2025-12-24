import { LicenseTier, PaymentProvider } from '.prisma/license-client';
import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Logger,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiExcludeController } from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import * as crypto from 'crypto';
import { randomUUID } from 'crypto';
import { Request } from 'express';
import { SecurityLoggerService } from '../security/security-logger.service';
import { WebhookService } from './_services/webhook.service';

interface PatreonMember {
  id: string;
  attributes: {
    email: string;
    patron_status: string;
    currently_entitled_amount_cents: number;
  };
  relationships?: {
    currently_entitled_tiers?: {
      data: Array<{ id: string; type: string }>;
    };
  };
}

interface PatreonWebhookPayload {
  data: PatreonMember;
  included?: Array<{
    id: string;
    type: string;
    attributes: {
      title?: string;
      amount_cents?: number;
    };
  }>;
}

const PATREON_TIER_MAP: Record<string, LicenseTier> = {
  Supporter: LicenseTier.PATREON_SUPPORTER,
  Plus: LicenseTier.PATREON_PLUS,
  Pro: LicenseTier.PATREON_PRO,
  Ultimate: LicenseTier.PATREON_ULTIMATE,
};

@ApiExcludeController()
@Controller('webhooks/patreon')
@UseGuards(ThrottlerGuard)
export class PatreonController {
  private readonly logger = new Logger(PatreonController.name);

  constructor(
    private readonly webhookService: WebhookService,
    private readonly configService: ConfigService,
    private readonly securityLogger: SecurityLoggerService
  ) {}

  @Post()
  @HttpCode(200)
  @Throttle({ default: { limit: 30, ttl: 60000 } }) // 30 requests per minute for webhooks
  async handleWebhook(
    @Headers('x-patreon-signature') signature: string,
    @Headers('x-patreon-event') event: string,
    @Body() payload: PatreonWebhookPayload,
    @Req() req: Request
  ): Promise<{ received: boolean }> {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    this.verifySignature(signature, JSON.stringify(payload), ip);

    const member = payload.data;
    const email = member.attributes.email;
    const customerId = member.id;

    this.logger.log(`Patreon webhook: ${event} for ${email}`);

    switch (event) {
      case 'members:pledge:create':
      case 'members:create': {
        const tier = this.determineTier(payload);
        await this.webhookService.processNewSubscription({
          provider: PaymentProvider.PATREON,
          providerEventId: randomUUID(),
          email,
          tier,
          providerCustomerId: customerId,
          rawPayload: payload as unknown as Record<string, unknown>,
        });
        break;
      }

      case 'members:pledge:update':
      case 'members:update': {
        const tier = this.determineTier(payload);
        await this.webhookService.processUpgrade({
          provider: PaymentProvider.PATREON,
          providerEventId: randomUUID(),
          providerCustomerId: customerId,
          newTier: tier,
          rawPayload: payload as unknown as Record<string, unknown>,
        });
        break;
      }

      case 'members:pledge:delete':
      case 'members:delete': {
        await this.webhookService.processCancellation({
          provider: PaymentProvider.PATREON,
          providerEventId: randomUUID(),
          providerCustomerId: customerId,
          rawPayload: payload as unknown as Record<string, unknown>,
        });
        break;
      }

      default:
        this.logger.warn(`Unhandled Patreon event: ${event}`);
    }

    return { received: true };
  }

  private verifySignature(signature: string, payload: string, ip: string): void {
    const secret = this.configService.get<string>('PATREON_WEBHOOK_SECRET');
    if (!secret) {
      this.securityLogger.logWebhookSignatureInvalid('patreon', ip);
      throw new UnauthorizedException('PATREON_WEBHOOK_SECRET not configured');
    }

    if (!signature) {
      this.securityLogger.logWebhookSignatureInvalid('patreon', ip);
      throw new UnauthorizedException('Invalid Patreon webhook signature');
    }

    // Note: Patreon uses MD5 for webhook signatures (their requirement, not ours)
    const expectedSignature = crypto.createHmac('md5', secret).update(payload).digest('hex');

    // Use constant-time comparison to prevent timing attacks
    const signatureBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expectedSignature);

    if (
      signatureBuffer.length !== expectedBuffer.length ||
      !crypto.timingSafeEqual(signatureBuffer, expectedBuffer)
    ) {
      this.securityLogger.logWebhookSignatureInvalid('patreon', ip);
      throw new UnauthorizedException('Invalid Patreon webhook signature');
    }
  }

  private determineTier(payload: PatreonWebhookPayload): LicenseTier {
    const tiers = payload.included?.filter((i) => i.type === 'tier') ?? [];
    const entitledTierIds =
      payload.data.relationships?.currently_entitled_tiers?.data.map((t) => t.id) ?? [];

    for (const tier of tiers) {
      if (entitledTierIds.includes(tier.id) && tier.attributes.title) {
        const mapped = PATREON_TIER_MAP[tier.attributes.title];
        if (mapped) return mapped;
      }
    }

    const cents = payload.data.attributes.currently_entitled_amount_cents;
    if (cents >= 2500) return LicenseTier.PATREON_ULTIMATE;
    if (cents >= 1500) return LicenseTier.PATREON_PRO;
    if (cents >= 1000) return LicenseTier.PATREON_PLUS;
    if (cents >= 500) return LicenseTier.PATREON_SUPPORTER;

    return LicenseTier.PATREON_SUPPORTER;
  }
}
