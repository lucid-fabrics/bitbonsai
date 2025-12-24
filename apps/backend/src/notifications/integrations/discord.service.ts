import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';
import { firstValueFrom } from 'rxjs';
import type { SystemSettings } from '../../common/interfaces/system-settings.interface';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Discord embed color codes
 */
const DISCORD_COLORS = {
  SUCCESS: 0x00ff00, // Green
  ERROR: 0xff0000, // Red
  WARNING: 0xffaa00, // Orange
  INFO: 0x0099ff, // Blue
};

/**
 * Discord embed structure
 */
interface DiscordEmbed {
  title: string;
  description?: string;
  color: number;
  fields?: Array<{ name: string; value: string; inline?: boolean }>;
  footer?: { text: string };
  timestamp?: string;
}

/**
 * Discord webhook payload
 */
interface DiscordWebhookPayload {
  username?: string;
  avatar_url?: string;
  content?: string;
  embeds?: DiscordEmbed[];
}

/**
 * DiscordNotificationService
 *
 * Sends notifications to Discord via webhooks.
 *
 * Features:
 * - Rich embeds for job status updates
 * - Color-coded messages (green=success, red=error)
 * - Batch completion summaries
 * - Health alerts
 */
@Injectable()
export class DiscordNotificationService {
  private readonly logger = new Logger(DiscordNotificationService.name);
  private readonly MAX_RETRIES = 2;

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

    const embed: DiscordEmbed = {
      title: '✅ Encoding Complete',
      description: `**${job.fileLabel}**`,
      color: DISCORD_COLORS.SUCCESS,
      fields: [{ name: 'Space Saved', value: `${savedPercent}% (${savedGB} GB)`, inline: true }],
      timestamp: new Date().toISOString(),
    };

    if (job.duration) {
      const mins = Math.floor(job.duration / 60);
      const secs = job.duration % 60;
      embed.fields?.push({ name: 'Duration', value: `${mins}m ${secs}s`, inline: true });
    }

    await this.sendWebhook(webhookUrl, { embeds: [embed] });
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

    const embed: DiscordEmbed = {
      title: '❌ Encoding Failed',
      description: `**${job.fileLabel}**`,
      color: DISCORD_COLORS.ERROR,
      fields: [
        { name: 'Error', value: job.error?.substring(0, 200) || 'Unknown error', inline: false },
      ],
      timestamp: new Date().toISOString(),
    };

    if (job.retryCount !== undefined) {
      embed.fields?.push({ name: 'Retry Count', value: `${job.retryCount}`, inline: true });
    }

    await this.sendWebhook(webhookUrl, { embeds: [embed] });
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

    const embed: DiscordEmbed = {
      title: '📊 Batch Encoding Summary',
      color: stats.failed > 0 ? DISCORD_COLORS.WARNING : DISCORD_COLORS.SUCCESS,
      fields: [
        { name: 'Completed', value: `${stats.completed}`, inline: true },
        { name: 'Failed', value: `${stats.failed}`, inline: true },
        { name: 'Success Rate', value: `${successRate}%`, inline: true },
        { name: 'Space Saved', value: `${stats.totalSavedGB.toFixed(2)} GB`, inline: true },
        { name: 'Duration', value: stats.duration, inline: true },
      ],
      timestamp: new Date().toISOString(),
    };

    await this.sendWebhook(webhookUrl, { embeds: [embed] });
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

    const embed: DiscordEmbed = {
      title: alert.severity === 'critical' ? '🚨 Critical Alert' : '⚠️ Warning',
      description: alert.message,
      color: alert.severity === 'critical' ? DISCORD_COLORS.ERROR : DISCORD_COLORS.WARNING,
      fields: [{ name: 'Type', value: alert.type, inline: true }],
      timestamp: new Date().toISOString(),
    };

    await this.sendWebhook(webhookUrl, { embeds: [embed] });
  }

  /**
   * Send system status update
   */
  async sendSystemStatus(status: {
    nodesOnline: number;
    nodesOffline: number;
    activeJobs: number;
    queuedJobs: number;
  }): Promise<void> {
    const webhookUrl = await this.getWebhookUrl();
    if (!webhookUrl) return;

    const embed: DiscordEmbed = {
      title: '📈 System Status',
      color: status.nodesOffline > 0 ? DISCORD_COLORS.WARNING : DISCORD_COLORS.INFO,
      fields: [
        { name: 'Nodes Online', value: `${status.nodesOnline}`, inline: true },
        { name: 'Nodes Offline', value: `${status.nodesOffline}`, inline: true },
        { name: 'Active Jobs', value: `${status.activeJobs}`, inline: true },
        { name: 'Queued Jobs', value: `${status.queuedJobs}`, inline: true },
      ],
      timestamp: new Date().toISOString(),
    };

    await this.sendWebhook(webhookUrl, { embeds: [embed] });
  }

  /**
   * Test webhook connection
   */
  async testWebhook(webhookUrl: string): Promise<{ success: boolean; error?: string }> {
    try {
      const embed: DiscordEmbed = {
        title: '🧪 BitBonsai Test',
        description: 'Webhook connection successful!',
        color: DISCORD_COLORS.SUCCESS,
        timestamp: new Date().toISOString(),
      };

      await this.sendWebhook(webhookUrl, { embeds: [embed] });
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
      return (settings as SystemSettings | null)?.discordWebhookUrl || null;
    } catch {
      return null;
    }
  }

  /**
   * Send webhook with retry logic
   */
  private async sendWebhook(url: string, payload: DiscordWebhookPayload): Promise<void> {
    // Add BitBonsai branding
    payload.username = payload.username || 'BitBonsai';
    payload.avatar_url = payload.avatar_url || 'https://avatars.githubusercontent.com/u/bitbonsai';

    for (let attempt = 1; attempt <= this.MAX_RETRIES; attempt++) {
      try {
        await firstValueFrom(
          this.httpService.post(url, payload, {
            headers: { 'Content-Type': 'application/json' },
            timeout: 10000,
          })
        );
        this.logger.debug('Discord webhook sent successfully');
        return;
      } catch (error) {
        if (attempt < this.MAX_RETRIES) {
          await new Promise((r) => setTimeout(r, 1000 * attempt));
        } else {
          this.logger.error(`Discord webhook failed: ${error}`);
        }
      }
    }
  }
}
