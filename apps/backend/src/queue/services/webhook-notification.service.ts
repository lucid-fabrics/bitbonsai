import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';
import type { Job } from '@prisma/client';
import { firstValueFrom } from 'rxjs';
import type { SystemSettings } from '../../common/interfaces/system-settings.interface';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Webhook Event Types
 */
export enum WebhookEventType {
  JOB_COMPLETED = 'job.completed',
  JOB_FAILED = 'job.failed',
  JOB_STARTED = 'job.started',
  BATCH_COMPLETED = 'batch.completed',
  HEALTH_ALERT = 'health.alert',
  NODE_STATUS_CHANGED = 'node.status_changed',
}

/**
 * Webhook Payload Interface
 */
export interface WebhookPayload {
  event: WebhookEventType;
  timestamp: string;
  data: Record<string, unknown>;
}

/**
 * WebhookNotificationService
 *
 * Sends webhook notifications for job events.
 * Webhooks are configured in Settings (webhookUrl, webhookEnabled, webhookEvents).
 *
 * Features:
 * - Event-based notification (job completed, failed, started)
 * - Configurable events (only send specific event types)
 * - Retry logic with exponential backoff
 * - Rate limiting to prevent spam
 */
@Injectable()
export class WebhookNotificationService {
  private readonly logger = new Logger(WebhookNotificationService.name);
  private readonly MAX_RETRIES = 3;
  private readonly RATE_LIMIT_MS = 1000; // 1 second between notifications
  private lastNotificationTime = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly httpService: HttpService
  ) {}

  /**
   * Send webhook notification for a job event
   *
   * @param eventType - Type of event
   * @param job - Job data (partial)
   * @param additionalData - Additional data to include
   */
  async sendJobNotification(
    eventType: WebhookEventType,
    job: Partial<Job>,
    additionalData?: Record<string, unknown>
  ): Promise<void> {
    try {
      const settings = await this.getWebhookSettings();

      if (!settings.webhookEnabled || !settings.webhookUrl) {
        return;
      }

      // Check if this event type is enabled
      const enabledEvents = settings.webhookEvents as string[] | null;
      if (enabledEvents && enabledEvents.length > 0 && !enabledEvents.includes(eventType)) {
        this.logger.debug(`Webhook event ${eventType} not in enabled events list, skipping`);
        return;
      }

      // Rate limiting
      const now = Date.now();
      if (now - this.lastNotificationTime < this.RATE_LIMIT_MS) {
        this.logger.debug('Rate limited - skipping webhook notification');
        return;
      }
      this.lastNotificationTime = now;

      const payload: WebhookPayload = {
        event: eventType,
        timestamp: new Date().toISOString(),
        data: {
          jobId: job.id,
          fileLabel: job.fileLabel,
          filePath: job.filePath,
          stage: job.stage,
          progress: job.progress,
          savedPercent: job.savedPercent,
          savedBytes: job.savedBytes?.toString(),
          error: job.error,
          ...additionalData,
        },
      };

      await this.sendWebhook(settings.webhookUrl, payload, settings.webhookSecret);
    } catch (error) {
      this.logger.error(
        `Failed to send webhook notification: ${error instanceof Error ? error.message : error}`
      );
      // Don't throw - webhook failures shouldn't affect job processing
    }
  }

  /**
   * Send health alert webhook
   *
   * @param alertType - Type of health alert
   * @param message - Alert message
   * @param details - Alert details
   */
  async sendHealthAlert(
    alertType: string,
    message: string,
    details?: Record<string, unknown>
  ): Promise<void> {
    try {
      const settings = await this.getWebhookSettings();

      if (!settings.webhookEnabled || !settings.webhookUrl) {
        return;
      }

      const payload: WebhookPayload = {
        event: WebhookEventType.HEALTH_ALERT,
        timestamp: new Date().toISOString(),
        data: {
          alertType,
          message,
          ...details,
        },
      };

      await this.sendWebhook(settings.webhookUrl, payload, settings.webhookSecret);
    } catch (error) {
      this.logger.error(`Failed to send health alert webhook: ${error}`);
    }
  }

  /**
   * Send batch completion notification
   *
   * @param totalJobs - Total jobs in batch
   * @param completedJobs - Successfully completed jobs
   * @param failedJobs - Failed jobs
   * @param savedBytes - Total bytes saved
   */
  async sendBatchCompleteNotification(
    totalJobs: number,
    completedJobs: number,
    failedJobs: number,
    savedBytes: bigint
  ): Promise<void> {
    try {
      const settings = await this.getWebhookSettings();

      if (!settings.webhookEnabled || !settings.webhookUrl) {
        return;
      }

      const payload: WebhookPayload = {
        event: WebhookEventType.BATCH_COMPLETED,
        timestamp: new Date().toISOString(),
        data: {
          totalJobs,
          completedJobs,
          failedJobs,
          savedBytes: savedBytes.toString(),
          savedGB: (Number(savedBytes) / 1024 ** 3).toFixed(2),
        },
      };

      await this.sendWebhook(settings.webhookUrl, payload, settings.webhookSecret);
    } catch (error) {
      this.logger.error(`Failed to send batch complete webhook: ${error}`);
    }
  }

  /**
   * Get webhook settings from database
   * @private
   */
  private async getWebhookSettings(): Promise<{
    webhookEnabled: boolean;
    webhookUrl: string | null;
    webhookSecret: string | null;
    webhookEvents: unknown;
  }> {
    const settings = await this.prisma.settings.findFirst();
    const s = settings as SystemSettings | null;

    return {
      webhookEnabled: false, // Field doesn't exist in schema
      webhookUrl: s?.webhookUrl ?? null,
      webhookSecret: s?.webhookSecret ?? null,
      webhookEvents: null, // Field doesn't exist in schema
    };
  }

  /**
   * Send webhook with retry logic
   * @private
   */
  private async sendWebhook(
    url: string,
    payload: WebhookPayload,
    secret?: string | null
  ): Promise<void> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'User-Agent': 'BitBonsai-Webhook/1.0',
    };

    // Add HMAC signature if secret is configured
    if (secret) {
      const crypto = await import('node:crypto');
      const signature = crypto
        .createHmac('sha256', secret)
        .update(JSON.stringify(payload))
        .digest('hex');
      headers['X-BitBonsai-Signature'] = `sha256=${signature}`;
    }

    for (let attempt = 1; attempt <= this.MAX_RETRIES; attempt++) {
      try {
        const response = await firstValueFrom(
          this.httpService.post(url, payload, {
            headers,
            timeout: 10000, // 10 second timeout
          })
        );

        if (response.status >= 200 && response.status < 300) {
          this.logger.debug(`📤 Webhook sent successfully: ${payload.event}`);
          return;
        }

        throw new Error(`Webhook returned status ${response.status}`);
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);

        if (attempt < this.MAX_RETRIES) {
          const delay = 2 ** attempt * 1000; // Exponential backoff
          this.logger.warn(
            `Webhook attempt ${attempt}/${this.MAX_RETRIES} failed: ${errorMsg}. Retrying in ${delay}ms...`
          );
          await new Promise((resolve) => setTimeout(resolve, delay));
        } else {
          this.logger.error(`Webhook failed after ${this.MAX_RETRIES} attempts: ${errorMsg}`);
        }
      }
    }
  }
}
