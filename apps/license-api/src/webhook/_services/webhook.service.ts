import {
  LicenseTier,
  PaymentProvider,
  Prisma,
  WebhookEventStatus,
  WebhookEventType,
} from '.prisma/license-client';
import { Injectable, Logger } from '@nestjs/common';
import { EmailService } from '../../email/email.service';
import { LicenseService } from '../../license/_services/license.service';
import { PrismaService } from '../../prisma/prisma.service';

interface WebhookResult {
  success: boolean;
  licenseId?: string;
  error?: string;
}

@Injectable()
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly licenseService: LicenseService,
    private readonly emailService: EmailService
  ) {}

  async processNewSubscription(params: {
    provider: PaymentProvider;
    providerEventId: string;
    email: string;
    tier: LicenseTier;
    providerCustomerId: string;
    rawPayload: Record<string, unknown>;
  }): Promise<WebhookResult> {
    // Check if webhook event already processed (idempotency)
    const existing = await this.findExistingWebhookEvent(params.provider, params.providerEventId);
    if (existing) {
      this.logger.log(
        `Webhook event ${params.providerEventId} already processed (status: ${existing.status}), skipping`
      );
      return {
        success: existing.status === WebhookEventStatus.PROCESSED,
        licenseId: existing.licenseId || undefined,
        error: existing.error || undefined,
      };
    }

    const eventRecord = await this.createWebhookEvent({
      provider: params.provider,
      providerEventId: params.providerEventId,
      eventType: WebhookEventType.SUBSCRIPTION_CREATED,
      rawPayload: params.rawPayload,
    });

    try {
      const license = await this.licenseService.createFromWebhook({
        email: params.email,
        tier: params.tier,
        provider: params.provider,
        providerCustomerId: params.providerCustomerId,
      });

      // Fire-and-forget email sending - don't let email failures break webhook processing
      this.emailService
        .sendLicenseEmail({
          email: license.email,
          licenseKey: license.key,
          tier: license.tier,
          maxNodes: license.maxNodes,
          maxConcurrentJobs: license.maxConcurrentJobs,
          expiresAt: license.expiresAt,
        })
        .catch((err) => this.logger.error(`Failed to send license email to ${license.email}`, err));

      await this.updateWebhookEvent(eventRecord.id, WebhookEventStatus.PROCESSED, license.id);
      this.logger.log(`Created license ${license.id} for ${params.email} via ${params.provider}`);
      return { success: true, licenseId: license.id };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      await this.updateWebhookEvent(
        eventRecord.id,
        WebhookEventStatus.FAILED,
        undefined,
        errorMessage
      );
      this.logger.error(`Failed to process subscription webhook: ${errorMessage}`, error);
      return { success: false, error: errorMessage };
    }
  }

  async processUpgrade(params: {
    provider: PaymentProvider;
    providerEventId: string;
    providerCustomerId: string;
    newTier: LicenseTier;
    rawPayload: Record<string, unknown>;
  }): Promise<WebhookResult> {
    // Check if webhook event already processed (idempotency)
    const existing = await this.findExistingWebhookEvent(params.provider, params.providerEventId);
    if (existing) {
      this.logger.log(
        `Webhook event ${params.providerEventId} already processed (status: ${existing.status}), skipping`
      );
      return {
        success: existing.status === WebhookEventStatus.PROCESSED,
        licenseId: existing.licenseId || undefined,
        error: existing.error || undefined,
      };
    }

    const eventRecord = await this.createWebhookEvent({
      provider: params.provider,
      providerEventId: params.providerEventId,
      eventType: WebhookEventType.SUBSCRIPTION_UPDATED,
      rawPayload: params.rawPayload,
    });

    try {
      const license = await this.licenseService.upgradeFromWebhook({
        provider: params.provider,
        providerCustomerId: params.providerCustomerId,
        newTier: params.newTier,
      });

      if (!license) {
        await this.updateWebhookEvent(
          eventRecord.id,
          WebhookEventStatus.FAILED,
          undefined,
          'License not found'
        );
        return { success: false, error: 'License not found for customer' };
      }

      // Fire-and-forget email sending - don't let email failures break webhook processing
      this.emailService
        .sendLicenseEmail({
          email: license.email,
          licenseKey: license.key,
          tier: license.tier,
          maxNodes: license.maxNodes,
          maxConcurrentJobs: license.maxConcurrentJobs,
          expiresAt: license.expiresAt,
        })
        .catch((err) => this.logger.error(`Failed to send license email to ${license.email}`, err));

      await this.updateWebhookEvent(eventRecord.id, WebhookEventStatus.PROCESSED, license.id);
      this.logger.log(`Upgraded license ${license.id} to ${params.newTier} via ${params.provider}`);
      return { success: true, licenseId: license.id };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      await this.updateWebhookEvent(
        eventRecord.id,
        WebhookEventStatus.FAILED,
        undefined,
        errorMessage
      );
      this.logger.error(`Failed to process upgrade webhook: ${errorMessage}`, error);
      return { success: false, error: errorMessage };
    }
  }

  async processCancellation(params: {
    provider: PaymentProvider;
    providerEventId: string;
    providerCustomerId: string;
    rawPayload: Record<string, unknown>;
  }): Promise<WebhookResult> {
    // Check if webhook event already processed (idempotency)
    const existing = await this.findExistingWebhookEvent(params.provider, params.providerEventId);
    if (existing) {
      this.logger.log(
        `Webhook event ${params.providerEventId} already processed (status: ${existing.status}), skipping`
      );
      return {
        success: existing.status === WebhookEventStatus.PROCESSED,
        licenseId: existing.licenseId || undefined,
        error: existing.error || undefined,
      };
    }

    const eventRecord = await this.createWebhookEvent({
      provider: params.provider,
      providerEventId: params.providerEventId,
      eventType: WebhookEventType.SUBSCRIPTION_CANCELLED,
      rawPayload: params.rawPayload,
    });

    try {
      const license = await this.licenseService.findByProviderCustomerId(
        params.provider,
        params.providerCustomerId
      );

      if (!license) {
        await this.updateWebhookEvent(
          eventRecord.id,
          WebhookEventStatus.FAILED,
          undefined,
          'License not found'
        );
        return { success: false, error: 'License not found for customer' };
      }

      await this.licenseService.revoke(license.id, `Subscription cancelled via ${params.provider}`);
      await this.updateWebhookEvent(eventRecord.id, WebhookEventStatus.PROCESSED, license.id);
      this.logger.log(`Revoked license ${license.id} due to cancellation via ${params.provider}`);
      return { success: true, licenseId: license.id };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      await this.updateWebhookEvent(
        eventRecord.id,
        WebhookEventStatus.FAILED,
        undefined,
        errorMessage
      );
      this.logger.error(`Failed to process cancellation webhook: ${errorMessage}`, error);
      return { success: false, error: errorMessage };
    }
  }

  private async findExistingWebhookEvent(provider: PaymentProvider, providerEventId: string) {
    return this.prisma.webhookEvent.findUnique({
      where: {
        provider_providerEventId: {
          provider,
          providerEventId,
        },
      },
    });
  }

  private async createWebhookEvent(params: {
    provider: PaymentProvider;
    providerEventId: string;
    eventType: WebhookEventType;
    rawPayload: Record<string, unknown>;
  }) {
    return this.prisma.webhookEvent.create({
      data: {
        provider: params.provider,
        providerEventId: params.providerEventId,
        eventType: params.eventType,
        rawPayload: params.rawPayload as Prisma.InputJsonValue,
        status: WebhookEventStatus.PENDING,
      },
    });
  }

  private async updateWebhookEvent(
    id: string,
    status: WebhookEventStatus,
    licenseId?: string,
    error?: string
  ) {
    return this.prisma.webhookEvent.update({
      where: { id },
      data: {
        status,
        licenseId,
        error,
        processedAt: status === WebhookEventStatus.PROCESSED ? new Date() : undefined,
      },
    });
  }
}
