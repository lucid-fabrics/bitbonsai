import { Injectable, Logger } from '@nestjs/common';
import type { Transporter } from 'nodemailer';
import * as nodemailer from 'nodemailer';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Email configuration interface
 */
interface EmailConfig {
  host: string;
  port: number;
  secure: boolean;
  auth: {
    user: string;
    pass: string;
  };
  from: string;
  to: string;
}

/**
 * EmailNotificationService
 *
 * Sends email notifications via SMTP.
 *
 * Features:
 * - SMTP configuration from settings
 * - HTML email templates
 * - Job completion/failure alerts
 * - Daily/weekly digest summaries
 * - Health alerts
 */
@Injectable()
export class EmailNotificationService {
  private readonly logger = new Logger(EmailNotificationService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Send job completed notification
   */
  async sendJobCompleted(job: {
    fileLabel: string;
    savedPercent?: number | null;
    savedBytes?: bigint | null;
    duration?: number;
  }): Promise<void> {
    const config = await this.getEmailConfig();
    if (!config) return;

    const savedGB = job.savedBytes ? (Number(job.savedBytes) / 1024 ** 3).toFixed(2) : '0';
    const savedPercent = job.savedPercent?.toFixed(1) || '0';
    const durationStr = job.duration
      ? `${Math.floor(job.duration / 60)}m ${job.duration % 60}s`
      : 'N/A';

    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: #00aa00; color: white; padding: 20px; border-radius: 8px 8px 0 0;">
          <h2 style="margin: 0;">✅ Encoding Complete</h2>
        </div>
        <div style="background: #f5f5f5; padding: 20px; border-radius: 0 0 8px 8px;">
          <h3 style="margin-top: 0;">${job.fileLabel}</h3>
          <table style="width: 100%; border-collapse: collapse;">
            <tr>
              <td style="padding: 8px 0; border-bottom: 1px solid #ddd;"><strong>Space Saved</strong></td>
              <td style="padding: 8px 0; border-bottom: 1px solid #ddd;">${savedPercent}% (${savedGB} GB)</td>
            </tr>
            <tr>
              <td style="padding: 8px 0;"><strong>Duration</strong></td>
              <td style="padding: 8px 0;">${durationStr}</td>
            </tr>
          </table>
        </div>
        <p style="color: #666; font-size: 12px; text-align: center;">
          Sent by BitBonsai Media Optimizer
        </p>
      </div>
    `;

    await this.sendEmail(config, `Encoding Complete: ${job.fileLabel}`, html);
  }

  /**
   * Send job failed notification
   */
  async sendJobFailed(job: {
    fileLabel: string;
    error?: string | null;
    retryCount?: number;
  }): Promise<void> {
    const config = await this.getEmailConfig();
    if (!config) return;

    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: #cc0000; color: white; padding: 20px; border-radius: 8px 8px 0 0;">
          <h2 style="margin: 0;">❌ Encoding Failed</h2>
        </div>
        <div style="background: #f5f5f5; padding: 20px; border-radius: 0 0 8px 8px;">
          <h3 style="margin-top: 0;">${job.fileLabel}</h3>
          <div style="background: #fff0f0; border: 1px solid #ffcccc; padding: 15px; border-radius: 4px; margin-bottom: 15px;">
            <strong>Error:</strong><br/>
            <code style="word-break: break-all;">${job.error || 'Unknown error'}</code>
          </div>
          <p><strong>Retry Count:</strong> ${job.retryCount || 0}</p>
        </div>
        <p style="color: #666; font-size: 12px; text-align: center;">
          Sent by BitBonsai Media Optimizer
        </p>
      </div>
    `;

    await this.sendEmail(config, `⚠️ Encoding Failed: ${job.fileLabel}`, html);
  }

  /**
   * Send daily digest summary
   */
  async sendDailyDigest(stats: {
    date: string;
    completed: number;
    failed: number;
    totalSavedGB: number;
    topFiles: Array<{ name: string; savedPercent: number }>;
  }): Promise<void> {
    const config = await this.getEmailConfig();
    if (!config) return;

    const successRate =
      stats.completed + stats.failed > 0
        ? ((stats.completed / (stats.completed + stats.failed)) * 100).toFixed(1)
        : '0';

    const topFilesHtml = stats.topFiles
      .map(
        (f) => `
        <tr>
          <td style="padding: 8px; border-bottom: 1px solid #ddd;">${f.name}</td>
          <td style="padding: 8px; border-bottom: 1px solid #ddd;">${f.savedPercent.toFixed(1)}%</td>
        </tr>
      `
      )
      .join('');

    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: #0066cc; color: white; padding: 20px; border-radius: 8px 8px 0 0;">
          <h2 style="margin: 0;">📊 Daily Encoding Summary</h2>
          <p style="margin: 5px 0 0 0; opacity: 0.9;">${stats.date}</p>
        </div>
        <div style="background: #f5f5f5; padding: 20px; border-radius: 0 0 8px 8px;">
          <div style="display: flex; gap: 20px; margin-bottom: 20px;">
            <div style="flex: 1; background: white; padding: 15px; border-radius: 8px; text-align: center;">
              <div style="font-size: 24px; font-weight: bold; color: #00aa00;">${stats.completed}</div>
              <div style="color: #666;">Completed</div>
            </div>
            <div style="flex: 1; background: white; padding: 15px; border-radius: 8px; text-align: center;">
              <div style="font-size: 24px; font-weight: bold; color: #cc0000;">${stats.failed}</div>
              <div style="color: #666;">Failed</div>
            </div>
            <div style="flex: 1; background: white; padding: 15px; border-radius: 8px; text-align: center;">
              <div style="font-size: 24px; font-weight: bold; color: #0066cc;">${stats.totalSavedGB.toFixed(1)} GB</div>
              <div style="color: #666;">Space Saved</div>
            </div>
          </div>

          <p><strong>Success Rate:</strong> ${successRate}%</p>

          ${
            stats.topFiles.length > 0
              ? `
            <h4>Top Space Savers</h4>
            <table style="width: 100%; border-collapse: collapse; background: white; border-radius: 4px;">
              <tr style="background: #eee;">
                <th style="padding: 8px; text-align: left;">File</th>
                <th style="padding: 8px; text-align: left;">Saved</th>
              </tr>
              ${topFilesHtml}
            </table>
          `
              : ''
          }
        </div>
        <p style="color: #666; font-size: 12px; text-align: center;">
          Sent by BitBonsai Media Optimizer
        </p>
      </div>
    `;

    await this.sendEmail(
      config,
      `📊 Daily Summary: ${stats.completed} encoded, ${stats.totalSavedGB.toFixed(1)} GB saved`,
      html
    );
  }

  /**
   * Send health alert
   */
  async sendHealthAlert(alert: {
    type: string;
    message: string;
    severity: 'warning' | 'critical';
  }): Promise<void> {
    const config = await this.getEmailConfig();
    if (!config) return;

    const bgColor = alert.severity === 'critical' ? '#cc0000' : '#ff9900';
    const emoji = alert.severity === 'critical' ? '🚨' : '⚠️';

    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: ${bgColor}; color: white; padding: 20px; border-radius: 8px 8px 0 0;">
          <h2 style="margin: 0;">${emoji} ${alert.severity === 'critical' ? 'Critical Alert' : 'Warning'}</h2>
        </div>
        <div style="background: #f5f5f5; padding: 20px; border-radius: 0 0 8px 8px;">
          <p style="font-size: 16px; margin-top: 0;">${alert.message}</p>
          <p><strong>Alert Type:</strong> ${alert.type}</p>
        </div>
        <p style="color: #666; font-size: 12px; text-align: center;">
          Sent by BitBonsai Media Optimizer
        </p>
      </div>
    `;

    const subject =
      alert.severity === 'critical' ? `🚨 CRITICAL: ${alert.type}` : `⚠️ Warning: ${alert.type}`;

    await this.sendEmail(config, subject, html);
  }

  /**
   * Test email configuration
   */
  async testEmail(config: EmailConfig): Promise<{ success: boolean; error?: string }> {
    try {
      const transporter = this.createTransporter(config);
      await transporter.verify();

      await transporter.sendMail({
        from: config.from,
        to: config.to,
        subject: '🧪 BitBonsai Email Test',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="background: #00aa00; color: white; padding: 20px; border-radius: 8px;">
              <h2 style="margin: 0;">✅ Email Configuration Successful</h2>
              <p style="margin: 10px 0 0 0;">Your BitBonsai email notifications are working!</p>
            </div>
          </div>
        `,
      });

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Get email configuration from settings
   */
  private async getEmailConfig(): Promise<EmailConfig | null> {
    try {
      const settings = await this.prisma.settings.findFirst();
      const s = settings as any;

      if (!s?.smtpHost || !s?.smtpUser || !s?.emailTo) {
        return null;
      }

      return {
        host: s.smtpHost,
        port: s.smtpPort || 587,
        secure: s.smtpSecure || false,
        auth: {
          user: s.smtpUser,
          pass: s.smtpPass || '',
        },
        from: s.emailFrom || s.smtpUser,
        to: s.emailTo,
      };
    } catch {
      return null;
    }
  }

  /**
   * Create nodemailer transporter
   */
  private createTransporter(config: EmailConfig): Transporter {
    return nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: config.auth,
    });
  }

  /**
   * Send email
   */
  private async sendEmail(config: EmailConfig, subject: string, html: string): Promise<void> {
    try {
      const transporter = this.createTransporter(config);

      await transporter.sendMail({
        from: config.from,
        to: config.to,
        subject,
        html,
      });

      this.logger.debug(`Email sent: ${subject}`);
    } catch (error) {
      this.logger.error(`Failed to send email: ${error}`);
    }
  }
}
