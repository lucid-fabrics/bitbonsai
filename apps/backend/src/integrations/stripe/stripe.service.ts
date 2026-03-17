import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { LicenseStatus, LicenseTier } from '@prisma/client';
import Stripe from 'stripe';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Stripe price ID to license tier mapping
 */
interface PriceConfig {
  tier: LicenseTier;
  maxNodes: number;
  maxConcurrentJobs: number;
}

/**
 * StripeService
 *
 * Handles Stripe payment integration for commercial licenses:
 * - Checkout session creation
 * - Subscription management
 * - Webhook handling for payment events
 *
 * Commercial tiers:
 * - COMMERCIAL_STARTER: $49/mo - 15 nodes, 30 concurrent
 * - COMMERCIAL_PRO: $149/mo - 50 nodes, 100 concurrent
 * - COMMERCIAL_ENTERPRISE: Custom pricing
 */
@Injectable()
export class StripeService {
  private readonly logger = new Logger(StripeService.name);
  private stripe: Stripe | null = null;

  private readonly priceMap: Record<string, PriceConfig> = {
    // Map Stripe price IDs to license tiers
    // These should match your Stripe product configuration
    [process.env.STRIPE_PRICE_STARTER || 'price_starter']: {
      tier: LicenseTier.COMMERCIAL_STARTER,
      maxNodes: 15,
      maxConcurrentJobs: 30,
    },
    [process.env.STRIPE_PRICE_PRO || 'price_pro']: {
      tier: LicenseTier.COMMERCIAL_PRO,
      maxNodes: 50,
      maxConcurrentJobs: 100,
    },
    [process.env.STRIPE_PRICE_ENTERPRISE || 'price_enterprise']: {
      tier: LicenseTier.COMMERCIAL_ENTERPRISE,
      maxNodes: 999,
      maxConcurrentJobs: 999,
    },
  };

  constructor(private readonly prisma: PrismaService) {
    const secretKey = process.env.STRIPE_SECRET_KEY;
    if (secretKey) {
      this.stripe = new Stripe(secretKey, {
        apiVersion: '2025-12-15.clover',
      });
    }
  }

  /**
   * Check if Stripe is configured
   */
  isConfigured(): boolean {
    return !!this.stripe;
  }

  /**
   * Create a checkout session for a commercial license
   */
  async createCheckoutSession(params: {
    email: string;
    priceId: string;
    successUrl: string;
    cancelUrl: string;
  }): Promise<{ sessionId: string; url: string }> {
    if (!this.stripe) {
      throw new Error('Stripe is not configured');
    }

    const session = await this.stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      customer_email: params.email,
      line_items: [
        {
          price: params.priceId,
          quantity: 1,
        },
      ],
      success_url: params.successUrl,
      cancel_url: params.cancelUrl,
      metadata: {
        email: params.email,
      },
    });

    this.logger.log(`Created checkout session for ${params.email}`);

    return {
      sessionId: session.id,
      url: session.url!,
    };
  }

  /**
   * Handle Stripe webhook events
   */
  async handleWebhook(signature: string, rawBody: Buffer): Promise<void> {
    if (!this.stripe) {
      throw new Error('Stripe is not configured');
    }

    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!webhookSecret) {
      throw new Error('STRIPE_WEBHOOK_SECRET not configured');
    }

    let event: Stripe.Event;
    try {
      event = this.stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
    } catch (err) {
      this.logger.error('Webhook signature verification failed', err);
      throw new UnauthorizedException('Invalid webhook signature');
    }

    this.logger.log(`Received Stripe webhook: ${event.type}`);

    switch (event.type) {
      case 'checkout.session.completed':
        await this.handleCheckoutComplete(event.data.object as Stripe.Checkout.Session);
        break;

      case 'customer.subscription.updated':
        await this.handleSubscriptionUpdated(event.data.object as Stripe.Subscription);
        break;

      case 'customer.subscription.deleted':
        await this.handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
        break;

      case 'invoice.payment_failed':
        await this.handlePaymentFailed(event.data.object as Stripe.Invoice);
        break;

      default:
        this.logger.debug(`Unhandled event type: ${event.type}`);
    }
  }

  /**
   * Handle successful checkout
   */
  private async handleCheckoutComplete(session: Stripe.Checkout.Session): Promise<void> {
    const email = session.customer_email || session.metadata?.email;
    const customerId = session.customer as string;
    const subscriptionId = session.subscription as string;

    if (!email) {
      this.logger.error('No email in checkout session');
      return;
    }

    // Get subscription to find price/tier
    const subscription = await this.stripe?.subscriptions.retrieve(subscriptionId);
    if (!subscription) {
      this.logger.error('Failed to retrieve subscription from Stripe');
      return;
    }
    const priceId = subscription.items.data[0]?.price.id;
    const config = this.priceMap[priceId];

    if (!config) {
      this.logger.error(`Unknown price ID: ${priceId}`);
      return;
    }

    // Find or create license
    const license = await this.prisma.license.findFirst({
      where: { email },
    });

    const features = {
      multiNode: true,
      advancedPresets: true,
      api: true,
      priorityQueue: true,
      cloudStorage: true,
      webhooks: true,
    };

    if (license) {
      await this.prisma.license.update({
        where: { id: license.id },
        data: {
          tier: config.tier,
          status: LicenseStatus.ACTIVE,
          maxNodes: config.maxNodes,
          maxConcurrentJobs: config.maxConcurrentJobs,
          stripeCustomerId: customerId,
          stripeSubscriptionId: subscriptionId,
          features,
        },
      });
      this.logger.log(`Updated license for ${email} to ${config.tier}`);
    } else {
      await this.prisma.license.create({
        data: {
          key: this.generateLicenseKey(config.tier),
          tier: config.tier,
          status: LicenseStatus.ACTIVE,
          email,
          maxNodes: config.maxNodes,
          maxConcurrentJobs: config.maxConcurrentJobs,
          stripeCustomerId: customerId,
          stripeSubscriptionId: subscriptionId,
          features,
        },
      });
      this.logger.log(`Created new license for ${email} at ${config.tier}`);
    }
  }

  /**
   * Handle subscription update (tier change)
   */
  private async handleSubscriptionUpdated(subscription: Stripe.Subscription): Promise<void> {
    const subscriptionId = subscription.id;
    const priceId = subscription.items.data[0]?.price.id;
    const config = this.priceMap[priceId];

    if (!config) {
      this.logger.warn(`Unknown price ID in subscription update: ${priceId}`);
      return;
    }

    const license = await this.prisma.license.findFirst({
      where: { stripeSubscriptionId: subscriptionId },
    });

    if (license) {
      await this.prisma.license.update({
        where: { id: license.id },
        data: {
          tier: config.tier,
          maxNodes: config.maxNodes,
          maxConcurrentJobs: config.maxConcurrentJobs,
          status: subscription.status === 'active' ? LicenseStatus.ACTIVE : LicenseStatus.EXPIRED,
        },
      });
      this.logger.log(`Updated subscription for license ${license.id} to ${config.tier}`);
    }
  }

  /**
   * Handle subscription cancellation
   */
  private async handleSubscriptionDeleted(subscription: Stripe.Subscription): Promise<void> {
    const subscriptionId = subscription.id;

    const license = await this.prisma.license.findFirst({
      where: { stripeSubscriptionId: subscriptionId },
    });

    if (license) {
      await this.prisma.license.update({
        where: { id: license.id },
        data: {
          tier: LicenseTier.FREE,
          status: LicenseStatus.EXPIRED,
          maxNodes: 1,
          maxConcurrentJobs: 2,
          features: {
            multiNode: false,
            advancedPresets: false,
            api: false,
            priorityQueue: false,
            cloudStorage: false,
            webhooks: false,
          },
        },
      });
      this.logger.log(`Downgraded license ${license.id} to FREE (subscription cancelled)`);
    }
  }

  /**
   * Handle failed payment
   */
  private async handlePaymentFailed(invoice: Stripe.Invoice): Promise<void> {
    const customerId = invoice.customer as string;

    const license = await this.prisma.license.findFirst({
      where: { stripeCustomerId: customerId },
    });

    if (license) {
      this.logger.warn(`Payment failed for license ${license.id}`);
      // Don't immediately downgrade - Stripe will retry
      // After final retry failure, subscription.deleted will fire
    }
  }

  /**
   * Get customer portal URL for managing subscription
   */
  async getCustomerPortalUrl(customerId: string, returnUrl: string): Promise<string> {
    if (!this.stripe) {
      throw new Error('Stripe is not configured');
    }

    const session = await this.stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: returnUrl,
    });

    return session.url;
  }

  /**
   * Get available commercial plans
   */
  async getPlans(): Promise<
    Array<{
      priceId: string;
      tier: LicenseTier;
      name: string;
      price: number;
      interval: string;
      maxNodes: number;
      maxConcurrentJobs: number;
    }>
  > {
    if (!this.stripe) {
      return [];
    }

    const plans = [];

    for (const [priceId, config] of Object.entries(this.priceMap)) {
      try {
        const price = await this.stripe.prices.retrieve(priceId, {
          expand: ['product'],
        });

        const product = price.product as Stripe.Product;

        plans.push({
          priceId,
          tier: config.tier,
          name: product.name,
          price: (price.unit_amount || 0) / 100,
          interval: price.recurring?.interval || 'month',
          maxNodes: config.maxNodes,
          maxConcurrentJobs: config.maxConcurrentJobs,
        });
      } catch {
        // Price doesn't exist in Stripe yet
        this.logger.debug(`Price ${priceId} not found in Stripe`);
      }
    }

    return plans;
  }

  /**
   * Generate license key
   */
  private generateLicenseKey(tier: LicenseTier): string {
    const prefix = tier.substring(0, 3).toUpperCase();
    const random = require('crypto').randomBytes(8).toString('hex').substring(0, 10);
    return `${prefix}-${random}`;
  }
}
