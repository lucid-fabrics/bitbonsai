import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import { PricingService } from '../pricing/pricing.service';
import { CreateCheckoutDto } from './dto/create-checkout.dto';

@Injectable()
export class StripeService {
  private readonly logger = new Logger(StripeService.name);
  private readonly stripe: Stripe;

  constructor(
    private readonly configService: ConfigService,
    private readonly pricingService: PricingService
  ) {
    const secretKey = this.configService.get<string>('STRIPE_SECRET_KEY');
    if (!secretKey) {
      this.logger.warn('STRIPE_SECRET_KEY not configured - Stripe operations will fail');
    }
    this.stripe = new Stripe(secretKey || 'sk_placeholder_will_fail', {
      apiVersion: '2025-12-15.clover',
    });
  }

  async createCheckoutSession(dto: CreateCheckoutDto): Promise<{ url: string; sessionId: string }> {
    // Validate price ID exists in our system
    const tier = await this.pricingService.getTierByStripePriceId(dto.priceId);
    if (!tier) {
      throw new BadRequestException(`Invalid price ID: ${dto.priceId}`);
    }

    try {
      const session = await this.stripe.checkout.sessions.create({
        mode: 'subscription',
        payment_method_types: ['card'],
        customer_email: dto.email,
        line_items: [
          {
            price: dto.priceId,
            quantity: 1,
          },
        ],
        success_url: dto.successUrl,
        cancel_url: dto.cancelUrl,
        metadata: {
          email: dto.email,
          tierId: tier.id,
          tierName: tier.name,
        },
      });

      if (!session.url) {
        throw new Error('Stripe did not return a checkout URL');
      }

      return {
        url: session.url,
        sessionId: session.id,
      };
    } catch (error) {
      this.logger.error('Stripe checkout session creation failed', error);
      throw new BadRequestException('Failed to create Stripe checkout session');
    }
  }
}
