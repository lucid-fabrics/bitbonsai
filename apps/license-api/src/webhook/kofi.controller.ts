import {
  Body,
  Controller,
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
import { timingSafeEqual } from 'crypto';
import { Request } from 'express';
import { Public } from '../auth/decorators/public.decorator';
import { EmailService } from '../email/email.service';
import { PrismaService } from '../prisma/prisma.service';
import { SecurityLoggerService } from '../security/security-logger.service';

interface KofiWebhookData {
  verification_token: string;
  message_id: string;
  timestamp: string;
  type: 'Donation' | 'Subscription' | 'Commission' | 'Shop Order';
  is_public: boolean;
  from_name: string;
  message: string;
  amount: string;
  url: string;
  email: string;
  currency: string;
  is_subscription_payment: boolean;
  is_first_subscription_payment: boolean;
  kofi_transaction_id: string;
  tier_name?: string;
}

interface KofiWebhookPayload {
  data: string;
}

@Public()
@ApiExcludeController()
@Controller('webhooks/kofi')
@UseGuards(ThrottlerGuard)
export class KofiController {
  private readonly logger = new Logger(KofiController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService,
    private readonly configService: ConfigService,
    private readonly securityLogger: SecurityLoggerService
  ) {}

  @Post()
  @HttpCode(200)
  @Throttle({ default: { limit: 30, ttl: 60000 } }) // 30 requests per minute for webhooks
  async handleWebhook(
    @Body() payload: KofiWebhookPayload,
    @Req() req: Request
  ): Promise<{ received: boolean }> {
    const data: KofiWebhookData = JSON.parse(payload.data);
    const ip = req.ip || req.socket.remoteAddress || 'unknown';

    this.verifyToken(data.verification_token, ip);

    this.logger.log(`Ko-fi webhook: ${data.type} from ${data.email} - Amount: ${data.amount}`);

    // Ko-fi = donations only (not licenses)
    // Store in donations table for admin review
    await this.prisma.donation.create({
      data: {
        email: data.email,
        amount: Math.round(parseFloat(data.amount) * 100), // Convert to cents
        provider: 'KOFI',
        providerEventId: data.kofi_transaction_id,
        status: 'PENDING',
        rawPayload: JSON.parse(JSON.stringify(data)),
      },
    });

    // Send thank-you email (no license created)
    await this.emailService.sendEmail({
      to: data.email,
      subject: 'Thank you for your Ko-fi donation!',
      html: `
        <h2>Thank you for supporting BitBonsai!</h2>
        <p>Hi ${data.from_name},</p>
        <p>We received your donation of $${data.amount}. Your support helps us continue developing BitBonsai!</p>
        <p>Ko-fi donations do not include a license. If you'd like to purchase a license, please visit our <a href="https://bitbonsai.io/pricing">pricing page</a>.</p>
        <p>Thank you again for your generosity!</p>
        <p>- The BitBonsai Team</p>
      `,
    });

    return { received: true };
  }

  private verifyToken(token: string, ip: string): void {
    const expectedToken = this.configService.get<string>('KOFI_VERIFICATION_TOKEN');
    if (!expectedToken) {
      this.securityLogger.logWebhookSignatureInvalid('kofi', ip);
      throw new UnauthorizedException('KOFI_VERIFICATION_TOKEN not configured');
    }

    if (!token) {
      this.securityLogger.logWebhookSignatureInvalid('kofi', ip);
      throw new UnauthorizedException('Invalid Ko-fi verification token');
    }

    // Use constant-time comparison to prevent timing attacks
    const tokenBuffer = Buffer.from(token);
    const expectedBuffer = Buffer.from(expectedToken);

    if (
      tokenBuffer.length !== expectedBuffer.length ||
      !timingSafeEqual(tokenBuffer, expectedBuffer)
    ) {
      this.securityLogger.logWebhookSignatureInvalid('kofi', ip);
      throw new UnauthorizedException('Invalid Ko-fi verification token');
    }
  }
}
