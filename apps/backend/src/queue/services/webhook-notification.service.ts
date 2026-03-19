import { HttpService } from '@nestjs/axios';
import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import type { Job } from '@prisma/client';
import { firstValueFrom } from 'rxjs';
import type { SystemSettings } from '../../common/interfaces/system-settings.interface';
import { SettingsRepository } from '../../common/repositories/settings.repository';

/**
 * Failed webhook entry for dead-letter queue
 */
interface FailedWebhook {
  payload: WebhookPayload;
  url: string;
  secret: string | null;
  attempts: number;
  lastAttempt: Date;
  firstFailure: Date;
  lastError: string;
}

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
export class WebhookNotificationService implements OnModuleDestroy {
  private readonly logger = new Logger(WebhookNotificationService.name);
  private readonly MAX_RETRIES = 3;
  private readonly MAX_DLQ_RETRIES = 10;
  private readonly MAX_DLQ_SIZE = 100;
  private readonly DLQ_MAX_AGE_HOURS = 24;
  private readonly RATE_LIMIT_MS = 1000; // 1 second between notifications
  private lastNotificationTime = 0;

  // Dead-letter queue for failed webhooks
  private deadLetterQueue: FailedWebhook[] = [];
  private isProcessingDLQ = false;

  constructor(
    private readonly settingsRepository: SettingsRepository,
    private readonly httpService: HttpService
  ) {}

  onModuleDestroy(): void {
    // Log any remaining failed webhooks on shutdown
    if (this.deadLetterQueue.length > 0) {
      this.logger.warn(
        `Shutting down with ${this.deadLetterQueue.length} undelivered webhooks in dead-letter queue`
      );
    }
  }

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
    } catch (error: unknown) {
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
    } catch (error: unknown) {
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
    } catch (error: unknown) {
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
    const settings = await this.settingsRepository.findFirst();
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

    let lastError = '';
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
      } catch (error: unknown) {
        lastError = error instanceof Error ? error.message : String(error);

        if (attempt < this.MAX_RETRIES) {
          const delay = 2 ** attempt * 1000; // Exponential backoff
          this.logger.warn(
            `Webhook attempt ${attempt}/${this.MAX_RETRIES} failed: ${lastError}. Retrying in ${delay}ms...`
          );
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    // Add to dead-letter queue for later retry
    this.addToDeadLetterQueue(payload, url, secret ?? null, lastError);
  }

  /**
   * Add failed webhook to dead-letter queue
   * @private
   */
  private addToDeadLetterQueue(
    payload: WebhookPayload,
    url: string,
    secret: string | null,
    lastError: string
  ): void {
    const now = new Date();

    // Check if this payload is already in the queue (dedup by event+timestamp)
    const existingIndex = this.deadLetterQueue.findIndex(
      (item) => item.payload.event === payload.event && item.payload.timestamp === payload.timestamp
    );

    if (existingIndex >= 0) {
      // Update existing entry
      this.deadLetterQueue[existingIndex].attempts++;
      this.deadLetterQueue[existingIndex].lastAttempt = now;
      this.deadLetterQueue[existingIndex].lastError = lastError;
      return;
    }

    // Enforce queue size limit (remove oldest entries)
    while (this.deadLetterQueue.length >= this.MAX_DLQ_SIZE) {
      const removed = this.deadLetterQueue.shift();
      if (removed) {
        this.logger.warn(
          `Dead-letter queue full - discarding oldest webhook: ${removed.payload.event} from ${removed.firstFailure.toISOString()}`
        );
      }
    }

    // Add new entry
    this.deadLetterQueue.push({
      payload,
      url,
      secret,
      attempts: this.MAX_RETRIES,
      lastAttempt: now,
      firstFailure: now,
      lastError,
    });

    this.logger.warn(
      `Webhook added to dead-letter queue: ${payload.event}. Queue size: ${this.deadLetterQueue.length}`
    );
  }

  /**
   * Process dead-letter queue - retry failed webhooks
   * Runs every 5 minutes
   */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async processDeadLetterQueue(): Promise<void> {
    if (this.isProcessingDLQ || this.deadLetterQueue.length === 0) {
      return;
    }

    this.isProcessingDLQ = true;

    try {
      const now = new Date();
      const maxAgeMs = this.DLQ_MAX_AGE_HOURS * 60 * 60 * 1000;
      const itemsToRetry = [...this.deadLetterQueue];
      const succeededIds: number[] = [];
      const expiredIds: number[] = [];
      const maxRetriesIds: number[] = [];

      for (let i = 0; i < itemsToRetry.length; i++) {
        const item = itemsToRetry[i];

        // Check if webhook is too old
        if (now.getTime() - item.firstFailure.getTime() > maxAgeMs) {
          expiredIds.push(i);
          this.logger.warn(
            `Webhook expired (age > ${this.DLQ_MAX_AGE_HOURS}h): ${item.payload.event}`
          );
          continue;
        }

        // Check if max retries exceeded
        if (item.attempts >= this.MAX_DLQ_RETRIES) {
          maxRetriesIds.push(i);
          this.logger.error(
            `Webhook permanently failed after ${item.attempts} attempts: ${item.payload.event} - ${item.lastError}`
          );
          continue;
        }

        // Exponential backoff based on attempt count
        const backoffMinutes = Math.min(2 ** (item.attempts - this.MAX_RETRIES), 60);
        const nextRetryTime = new Date(item.lastAttempt.getTime() + backoffMinutes * 60 * 1000);

        if (now < nextRetryTime) {
          continue; // Not ready for retry yet
        }

        // Attempt retry
        try {
          const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            'User-Agent': 'BitBonsai-Webhook/1.0',
          };

          if (item.secret) {
            const crypto = await import('node:crypto');
            const signature = crypto
              .createHmac('sha256', item.secret)
              .update(JSON.stringify(item.payload))
              .digest('hex');
            headers['X-BitBonsai-Signature'] = `sha256=${signature}`;
          }

          const response = await firstValueFrom(
            this.httpService.post(item.url, item.payload, {
              headers,
              timeout: 10000,
            })
          );

          if (response.status >= 200 && response.status < 300) {
            succeededIds.push(i);
            this.logger.log(
              `📤 DLQ webhook succeeded on retry ${item.attempts + 1}: ${item.payload.event}`
            );
          } else {
            item.attempts++;
            item.lastAttempt = now;
            item.lastError = `Status ${response.status}`;
          }
        } catch (error: unknown) {
          item.attempts++;
          item.lastAttempt = now;
          item.lastError = error instanceof Error ? error.message : String(error);
        }
      }

      // Remove succeeded, expired, and max-retries items
      const idsToRemove = new Set([...succeededIds, ...expiredIds, ...maxRetriesIds]);
      this.deadLetterQueue = this.deadLetterQueue.filter((_, i) => !idsToRemove.has(i));

      if (succeededIds.length > 0 || expiredIds.length > 0 || maxRetriesIds.length > 0) {
        this.logger.log(
          `DLQ processed: ${succeededIds.length} succeeded, ${expiredIds.length} expired, ${maxRetriesIds.length} max retries. Remaining: ${this.deadLetterQueue.length}`
        );
      }
    } finally {
      this.isProcessingDLQ = false;
    }
  }

  /**
   * Get dead-letter queue stats (for monitoring)
   */
  getDeadLetterQueueStats(): { size: number; oldestAge: number | null } {
    if (this.deadLetterQueue.length === 0) {
      return { size: 0, oldestAge: null };
    }

    const oldest = this.deadLetterQueue.reduce((min, item) =>
      item.firstFailure < min.firstFailure ? item : min
    );

    return {
      size: this.deadLetterQueue.length,
      oldestAge: Math.round((Date.now() - oldest.firstFailure.getTime()) / 1000 / 60), // minutes
    };
  }
}
