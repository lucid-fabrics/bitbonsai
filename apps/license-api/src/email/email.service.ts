import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';

interface LicenseEmailParams {
  email: string;
  licenseKey: string;
  tier: string;
  maxNodes: number;
  maxConcurrentJobs: number;
  expiresAt: Date | null;
}

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly resend: Resend;
  private readonly fromEmail: string;

  constructor(private readonly configService: ConfigService) {
    const apiKey = this.configService.get<string>('RESEND_API_KEY');
    if (!apiKey) {
      this.logger.warn('RESEND_API_KEY not configured - emails will be logged only');
    }
    this.resend = new Resend(apiKey || 'dummy');
    this.fromEmail = this.configService.get<string>(
      'EMAIL_FROM',
      'BitBonsai <noreply@bitbonsai.io>'
    );
  }

  async sendLicenseEmail(params: LicenseEmailParams): Promise<void> {
    const { email, licenseKey, tier, maxNodes, maxConcurrentJobs, expiresAt } = params;
    const tierDisplay = this.formatTierName(tier);
    const expiryText = expiresAt
      ? `Valid until: ${expiresAt.toLocaleDateString()}`
      : 'Lifetime license';

    const html = `
<!DOCTYPE html>
<html>
<body style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
  <h1 style="color: #2d5016;">BitBonsai</h1>
  <h2>Thank you for your support!</h2>
  <p>Your <strong>${tierDisplay}</strong> license is ready.</p>
  <div style="background: #1a1a1a; padding: 20px; border-radius: 8px; margin: 20px 0;">
    <code style="color: #4ade80; word-break: break-all;">${licenseKey}</code>
  </div>
  <table style="width: 100%;">
    <tr><td><strong>Tier:</strong></td><td>${tierDisplay}</td></tr>
    <tr><td><strong>Max Nodes:</strong></td><td>${maxNodes}</td></tr>
    <tr><td><strong>Concurrent Jobs:</strong></td><td>${maxConcurrentJobs}</td></tr>
    <tr><td><strong>Validity:</strong></td><td>${expiryText}</td></tr>
  </table>
  <p>Paste this key in <strong>Settings → License</strong> in BitBonsai.</p>
</body>
</html>`;

    if (!this.configService.get<string>('RESEND_API_KEY')) {
      this.logger.log(`[DEV] Would send license email to ${email}`);
      return;
    }

    try {
      await this.resend.emails.send({
        from: this.fromEmail,
        to: email,
        subject: `Your BitBonsai ${tierDisplay} License`,
        html,
      });
      this.logger.log(`License email sent to ${email}`);
    } catch (error) {
      this.logger.error(`Failed to send email to ${email}`, error);
      throw error;
    }
  }

  async sendEmail(params: { to: string; subject: string; html: string }): Promise<void> {
    const { to, subject, html } = params;

    try {
      if (!this.configService.get<string>('RESEND_API_KEY')) {
        this.logger.warn(`[DRY RUN] Email to ${to}: ${subject}`);
        return;
      }

      await this.resend.emails.send({
        from: this.fromEmail,
        to,
        subject,
        html,
      });

      this.logger.log(`Email sent successfully to ${to}`);
    } catch (error) {
      this.logger.error(`Failed to send email to ${to}:`, error);
      throw error;
    }
  }

  private formatTierName(tier: string): string {
    const names: Record<string, string> = {
      FREE: 'Free',
      PATREON_SUPPORTER: 'Supporter',
      PATREON_PLUS: 'Plus',
      PATREON_PRO: 'Pro',
      PATREON_ULTIMATE: 'Ultimate',
      COMMERCIAL_STARTER: 'Commercial Starter',
      COMMERCIAL_PRO: 'Commercial Pro',
      COMMERCIAL_ENTERPRISE: 'Enterprise',
    };
    return names[tier] || tier;
  }
}
