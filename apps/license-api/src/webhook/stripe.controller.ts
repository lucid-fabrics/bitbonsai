import { LicenseTier, PaymentProvider } from '.prisma/license-client';
import {
  Controller,
  Headers,
  HttpCode,
  Logger,
  Post,
  RawBodyRequest,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiExcludeController } from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { Request } from 'express';
import Stripe from 'stripe';
import { Public } from '../auth/decorators/public.decorator';
import { PricingService } from '../pricing/pricing.service';
import { SecurityLoggerService } from '../security/security-logger.service';
import { WebhookService } from './_services/webhook.service';

@Public()
@ApiExcludeController()
@Controller('webhooks/stripe')
@UseGuards(ThrottlerGuard)
export class StripeController {
  private readonly logger = new Logger(StripeController.name);
  private readonly stripe: Stripe;

  constructor(
    private readonly webhookService: WebhookService,
    private readonly configService: ConfigService,
    private readonly securityLogger: SecurityLoggerService,
    private readonly pricingService: PricingService
  ) {
    const secretKey = this.configService.get<string>('STRIPE_SECRET_KEY');
    if (!secretKey) {
      this.logger.warn('STRIPE_SECRET_KEY not configured - Stripe webhooks will fail');
    }
    this.stripe = new Stripe(secretKey || 'sk_placeholder_will_fail');
  }

  @Post()
  @HttpCode(200)
  @Throttle({ default: { limit: 30, ttl: 60000 } }) // 30 requests per minute for webhooks
  async handleWebhook(
    @Headers('stripe-signature') signature: string,
    @Req() req: RawBodyRequest<Request>
  ): Promise<{ received: boolean }> {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const event = this.verifyAndConstructEvent(signature, req.rawBody as Buffer, ip);

    this.logger.log(`Stripe webhook: ${event.type}`);

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.mode === 'subscription') {
          await this.handleNewSubscription(session, event.id);
        }
        break;
      }

      case 'customer.subscription.updated': {
        const subscription = event.data.object as Stripe.Subscription;
        await this.handleSubscriptionUpdate(subscription, event.id);
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription;
        await this.handleSubscriptionCancelled(subscription, event.id);
        break;
      }

      case 'charge.refunded': {
        const charge = event.data.object as Stripe.Charge;
        await this.handleRefund(charge, event.id);
        break;
      }

      default:
        this.logger.debug(`Unhandled Stripe event: ${event.type}`);
    }

    return { received: true };
  }

  private verifyAndConstructEvent(signature: string, rawBody: Buffer, ip: string): Stripe.Event {
    const webhookSecret = this.configService.get<string>('STRIPE_WEBHOOK_SECRET');
    if (!webhookSecret) {
      this.securityLogger.logWebhookSignatureInvalid('stripe', ip);
      throw new UnauthorizedException('STRIPE_WEBHOOK_SECRET not configured');
    }

    if (!signature) {
      this.securityLogger.logWebhookSignatureInvalid('stripe', ip);
      throw new UnauthorizedException('Missing Stripe signature header');
    }

    try {
      return this.stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
    } catch {
      this.securityLogger.logWebhookSignatureInvalid('stripe', ip);
      throw new UnauthorizedException('Invalid Stripe webhook signature');
    }
  }

  private async handleNewSubscription(
    session: Stripe.Checkout.Session,
    eventId: string
  ): Promise<void> {
    const customerId = session.customer as string;
    const email = session.customer_email || session.customer_details?.email;

    if (!email) {
      this.logger.error('No email found in Stripe checkout session');
      return;
    }

    const subscription = await this.stripe.subscriptions.retrieve(session.subscription as string);
    const priceId = subscription.items.data[0]?.price.id;
    const tier = await this.determineTier(priceId);

    await this.webhookService.processNewSubscription({
      provider: PaymentProvider.STRIPE,
      providerEventId: eventId,
      email,
      tier,
      providerCustomerId: customerId,
      rawPayload: session as unknown as Record<string, unknown>,
    });
  }

  private async handleSubscriptionUpdate(
    subscription: Stripe.Subscription,
    eventId: string
  ): Promise<void> {
    const customerId = subscription.customer as string;
    const priceId = subscription.items.data[0]?.price.id;
    const tier = await this.determineTier(priceId);

    await this.webhookService.processUpgrade({
      provider: PaymentProvider.STRIPE,
      providerEventId: eventId,
      providerCustomerId: customerId,
      newTier: tier,
      rawPayload: subscription as unknown as Record<string, unknown>,
    });
  }

  private async handleSubscriptionCancelled(
    subscription: Stripe.Subscription,
    eventId: string
  ): Promise<void> {
    const customerId = subscription.customer as string;

    await this.webhookService.processCancellation({
      provider: PaymentProvider.STRIPE,
      providerEventId: eventId,
      providerCustomerId: customerId,
      rawPayload: subscription as unknown as Record<string, unknown>,
    });
  }

  private async handleRefund(charge: Stripe.Charge, eventId: string): Promise<void> {
    const customerId = charge.customer as string;

    if (!customerId) {
      this.logger.warn(`Refund received with no customer ID (charge: ${charge.id})`);
      return;
    }

    this.logger.log(`Processing refund for customer ${customerId} (charge: ${charge.id})`);

    await this.webhookService.processCancellation({
      provider: PaymentProvider.STRIPE,
      providerEventId: eventId,
      providerCustomerId: customerId,
      rawPayload: charge as unknown as Record<string, unknown>,
    });
  }

  private async determineTier(priceId: string): Promise<LicenseTier> {
    const tier = await this.pricingService.getTierByStripePriceId(priceId);

    if (!tier) {
      this.logger.error(
        `CRITICAL: Unknown Stripe price ID: ${priceId} - No matching tier found. License creation blocked.`
      );

      // Log security alert for admin review
      this.securityLogger.logCriticalEvent('UNKNOWN_STRIPE_PRICE', {
        priceId,
        message:
          'Stripe webhook received payment for unknown price ID - requires immediate admin attention',
      });

      // Throw error to block license creation instead of silently creating wrong tier
      throw new Error(`Unknown Stripe price ID: ${priceId}. Cannot determine license tier.`);
    }

    return tier.name as LicenseTier;
  }
}
