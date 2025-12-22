import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';
import { firstValueFrom } from 'rxjs';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Slack block structure
 */
interface SlackBlock {
  type: string;
  text?: { type: string; text: string; emoji?: boolean };
  fields?: Array<{ type: string; text: string }>;
  elements?: Array<{ type: string; text: string }>;
}

/**
 * Slack attachment for colored messages
 */
interface SlackAttachment {
  color: string;
  blocks: SlackBlock[];
}

/**
 * Slack webhook payload
 */
interface SlackWebhookPayload {
  text?: string;
  blocks?: SlackBlock[];
  attachments?: SlackAttachment[];
}

/**
 * SlackNotificationService
 *
 * Sends notifications to Slack via webhooks.
 *
 * Features:
 * - Block Kit formatting for rich messages
 * - Color-coded attachments
 * - Job status updates
 * - Batch summaries
 * - Health alerts
 */
@Injectable()
export class SlackNotificationService {
  private readonly logger = new Logger(SlackNotificationService.name);
  private readonly MAX_RETRIES = 2;

  // Slack attachment colors
  private readonly COLORS = {
    SUCCESS: '#00ff00',
    ERROR: '#ff0000',
    WARNING: '#ffaa00',
    INFO: '#0099ff',
  };

  constructor(
    private readonly prisma: PrismaService,
    private readonly httpService: HttpService
  ) {}

  /**
   * Send job completed notification
   */
  async sendJobCompleted(job: {
    fileLabel: string;
    savedPercent?: number | null;
    savedBytes?: bigint | null;
    duration?: number;
  }): Promise<void> {
    const webhookUrl = await this.getWebhookUrl();
    if (!webhookUrl) return;

    const savedGB = job.savedBytes ? (Number(job.savedBytes) / 1024 ** 3).toFixed(2) : '0';
    const savedPercent = job.savedPercent?.toFixed(1) || '0';
    const durationStr = job.duration
      ? `${Math.floor(job.duration / 60)}m ${job.duration % 60}s`
      : 'N/A';

    const payload: SlackWebhookPayload = {
      attachments: [
        {
          color: this.COLORS.SUCCESS,
          blocks: [
            {
              type: 'header',
              text: { type: 'plain_text', text: '✅ Encoding Complete', emoji: true },
            },
            {
              type: 'section',
              text: { type: 'mrkdwn', text: `*${job.fileLabel}*` },
            },
            {
              type: 'section',
              fields: [
                { type: 'mrkdwn', text: `*Space Saved:*\n${savedPercent}% (${savedGB} GB)` },
                { type: 'mrkdwn', text: `*Duration:*\n${durationStr}` },
              ],
            },
          ],
        },
      ],
    };

    await this.sendWebhook(webhookUrl, payload);
  }

  /**
   * Send job failed notification
   */
  async sendJobFailed(job: {
    fileLabel: string;
    error?: string | null;
    retryCount?: number;
  }): Promise<void> {
    const webhookUrl = await this.getWebhookUrl();
    if (!webhookUrl) return;

    const payload: SlackWebhookPayload = {
      attachments: [
        {
          color: this.COLORS.ERROR,
          blocks: [
            {
              type: 'header',
              text: { type: 'plain_text', text: '❌ Encoding Failed', emoji: true },
            },
            {
              type: 'section',
              text: { type: 'mrkdwn', text: `*${job.fileLabel}*` },
            },
            {
              type: 'section',
              fields: [
                {
                  type: 'mrkdwn',
                  text: `*Error:*\n${job.error?.substring(0, 200) || 'Unknown error'}`,
                },
                { type: 'mrkdwn', text: `*Retry Count:*\n${job.retryCount || 0}` },
              ],
            },
          ],
        },
      ],
    };

    await this.sendWebhook(webhookUrl, payload);
  }

  /**
   * Send batch completion summary
   */
  async sendBatchSummary(stats: {
    completed: number;
    failed: number;
    totalSavedGB: number;
    duration: string;
  }): Promise<void> {
    const webhookUrl = await this.getWebhookUrl();
    if (!webhookUrl) return;

    const successRate =
      stats.completed + stats.failed > 0
        ? ((stats.completed / (stats.completed + stats.failed)) * 100).toFixed(1)
        : '0';

    const payload: SlackWebhookPayload = {
      attachments: [
        {
          color: stats.failed > 0 ? this.COLORS.WARNING : this.COLORS.SUCCESS,
          blocks: [
            {
              type: 'header',
              text: { type: 'plain_text', text: '📊 Batch Encoding Summary', emoji: true },
            },
            {
              type: 'section',
              fields: [
                { type: 'mrkdwn', text: `*Completed:*\n${stats.completed}` },
                { type: 'mrkdwn', text: `*Failed:*\n${stats.failed}` },
                { type: 'mrkdwn', text: `*Success Rate:*\n${successRate}%` },
                { type: 'mrkdwn', text: `*Space Saved:*\n${stats.totalSavedGB.toFixed(2)} GB` },
              ],
            },
            {
              type: 'context',
              elements: [{ type: 'mrkdwn', text: `Duration: ${stats.duration}` }],
            },
          ],
        },
      ],
    };

    await this.sendWebhook(webhookUrl, payload);
  }

  /**
   * Send health alert
   */
  async sendHealthAlert(alert: {
    type: string;
    message: string;
    severity: 'warning' | 'critical';
  }): Promise<void> {
    const webhookUrl = await this.getWebhookUrl();
    if (!webhookUrl) return;

    const emoji = alert.severity === 'critical' ? '🚨' : '⚠️';
    const title = alert.severity === 'critical' ? 'Critical Alert' : 'Warning';

    const payload: SlackWebhookPayload = {
      attachments: [
        {
          color: alert.severity === 'critical' ? this.COLORS.ERROR : this.COLORS.WARNING,
          blocks: [
            {
              type: 'header',
              text: { type: 'plain_text', text: `${emoji} ${title}`, emoji: true },
            },
            {
              type: 'section',
              text: { type: 'mrkdwn', text: alert.message },
            },
            {
              type: 'context',
              elements: [{ type: 'mrkdwn', text: `Type: ${alert.type}` }],
            },
          ],
        },
      ],
    };

    await this.sendWebhook(webhookUrl, payload);
  }

  /**
   * Test webhook connection
   */
  async testWebhook(webhookUrl: string): Promise<{ success: boolean; error?: string }> {
    try {
      const payload: SlackWebhookPayload = {
        attachments: [
          {
            color: this.COLORS.SUCCESS,
            blocks: [
              {
                type: 'header',
                text: { type: 'plain_text', text: '🧪 BitBonsai Test', emoji: true },
              },
              {
                type: 'section',
                text: { type: 'mrkdwn', text: 'Webhook connection successful!' },
              },
            ],
          },
        ],
      };

      await this.sendWebhook(webhookUrl, payload);
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Get webhook URL from settings
   */
  private async getWebhookUrl(): Promise<string | null> {
    try {
      const settings = await this.prisma.settings.findFirst();
      return (settings as any)?.slackWebhookUrl || null;
    } catch {
      return null;
    }
  }

  /**
   * Send webhook with retry logic
   */
  private async sendWebhook(url: string, payload: SlackWebhookPayload): Promise<void> {
    for (let attempt = 1; attempt <= this.MAX_RETRIES; attempt++) {
      try {
        await firstValueFrom(
          this.httpService.post(url, payload, {
            headers: { 'Content-Type': 'application/json' },
            timeout: 10000,
          })
        );
        this.logger.debug('Slack webhook sent successfully');
        return;
      } catch (error) {
        if (attempt < this.MAX_RETRIES) {
          await new Promise((r) => setTimeout(r, 1000 * attempt));
        } else {
          this.logger.error(`Slack webhook failed: ${error}`);
        }
      }
    }
  }
}
