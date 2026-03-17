import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { StripeController } from './stripe.controller';
import { StripeService } from './stripe.service';

/**
 * StripeModule
 *
 * Provides Stripe payment integration for commercial licenses.
 *
 * Required environment variables:
 * - STRIPE_SECRET_KEY: Stripe secret API key
 * - STRIPE_WEBHOOK_SECRET: Webhook endpoint signing secret
 * - STRIPE_PRICE_STARTER: Price ID for Commercial Starter ($49/mo)
 * - STRIPE_PRICE_PRO: Price ID for Commercial Pro ($149/mo)
 * - STRIPE_PRICE_ENTERPRISE: Price ID for Enterprise (custom)
 */
@Module({
  imports: [PrismaModule],
  controllers: [StripeController],
  providers: [StripeService],
  exports: [StripeService],
})
export class StripeModule {}
