import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import { PrismaService } from '../prisma/prisma.service';

export interface CreatePricingTierDto {
  name: string;
  displayName: string;
  description: string;
  maxNodes: number;
  maxConcurrentJobs: number;
  priceMonthly: number;
  priceYearly?: number;
  patreonTierId?: string;
}

export interface UpdatePricingTierDto {
  displayName?: string;
  description?: string;
  maxNodes?: number;
  maxConcurrentJobs?: number;
  priceMonthly?: number;
  priceYearly?: number;
}

@Injectable()
export class PricingService {
  private readonly logger = new Logger(PricingService.name);
  private readonly stripe: Stripe;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService
  ) {
    const secretKey = this.configService.get<string>('STRIPE_SECRET_KEY');
    if (!secretKey) {
      this.logger.warn('STRIPE_SECRET_KEY not configured - pricing operations will fail');
    }
    this.stripe = new Stripe(secretKey || 'sk_placeholder_will_fail');
  }

  async getAllTiers() {
    return this.prisma.pricingTier.findMany({
      orderBy: { priceMonthly: 'asc' },
    });
  }

  async getActiveTiers() {
    return this.prisma.pricingTier.findMany({
      where: { isActive: true },
      orderBy: { priceMonthly: 'asc' },
    });
  }

  async getTierById(id: string) {
    const tier = await this.prisma.pricingTier.findUnique({
      where: { id },
    });

    if (!tier) {
      throw new NotFoundException('Pricing tier not found');
    }

    return tier;
  }

  async getTierByName(name: string) {
    return this.prisma.pricingTier.findUnique({
      where: { name },
    });
  }

  async getTierByStripePriceId(priceId: string) {
    return this.prisma.pricingTier.findFirst({
      where: {
        OR: [{ stripePriceIdMonthly: priceId }, { stripePriceIdYearly: priceId }],
      },
    });
  }

  async createTier(dto: CreatePricingTierDto, adminUserId: string) {
    return this.prisma.pricingTier.create({
      data: {
        name: dto.name,
        displayName: dto.displayName,
        description: dto.description,
        maxNodes: dto.maxNodes,
        maxConcurrentJobs: dto.maxConcurrentJobs,
        priceMonthly: dto.priceMonthly,
        priceYearly: dto.priceYearly,
        patreonTierId: dto.patreonTierId,
        createdBy: adminUserId,
      },
    });
  }

  async updateTier(id: string, dto: UpdatePricingTierDto, _adminUserId: string) {
    const tier = await this.getTierById(id);

    if (tier.isActive) {
      throw new Error('Cannot update published tier. Deactivate it first.');
    }

    return this.prisma.pricingTier.update({
      where: { id },
      data: dto,
    });
  }

  async publishTier(tierId: string, adminUserId: string): Promise<void> {
    return this.prisma.$transaction(async (tx) => {
      const tier = await tx.pricingTier.findUnique({ where: { id: tierId } });

      if (!tier) {
        throw new NotFoundException('Pricing tier not found');
      }

      if (tier.isActive) {
        throw new Error('Tier is already published');
      }

      const stripeProductId = this.configService.getOrThrow<string>('STRIPE_PRODUCT_ID');

      // Create Stripe monthly price
      this.logger.log(`Creating Stripe monthly price for tier: ${tier.name}`);
      const monthlyPrice = await this.stripe.prices.create({
        unit_amount: tier.priceMonthly,
        currency: 'usd',
        recurring: { interval: 'month' },
        product: stripeProductId,
        metadata: {
          tierName: tier.name,
          tierId: tier.id,
        },
      });

      // Create Stripe yearly price (if defined)
      let yearlyPrice = null;
      if (tier.priceYearly) {
        this.logger.log(`Creating Stripe yearly price for tier: ${tier.name}`);
        yearlyPrice = await this.stripe.prices.create({
          unit_amount: tier.priceYearly,
          currency: 'usd',
          recurring: { interval: 'year' },
          product: stripeProductId,
          metadata: {
            tierName: tier.name,
            tierId: tier.id,
          },
        });
      }

      // Save Stripe price IDs + mark published
      await tx.pricingTier.update({
        where: { id: tierId },
        data: {
          stripePriceIdMonthly: monthlyPrice.id,
          stripePriceIdYearly: yearlyPrice?.id,
          isActive: true,
          publishedBy: adminUserId,
          publishedAt: new Date(),
        },
      });

      // Audit log
      await tx.auditLog.create({
        data: {
          action: 'PUBLISH_PRICING_TIER',
          entityType: 'PRICING_TIER',
          entityId: tierId,
          userId: adminUserId,
          changes: {
            stripePriceIdMonthly: monthlyPrice.id,
            stripePriceIdYearly: yearlyPrice?.id,
          },
        },
      });

      this.logger.log(`Published tier: ${tier.name}`);
    });
  }

  async deactivateTier(tierId: string, adminUserId: string): Promise<void> {
    return this.prisma.$transaction(async (tx) => {
      await tx.pricingTier.update({
        where: { id: tierId },
        data: { isActive: false },
      });

      await tx.auditLog.create({
        data: {
          action: 'DEACTIVATE_PRICING_TIER',
          entityType: 'PRICING_TIER',
          entityId: tierId,
          userId: adminUserId,
        },
      });
    });
  }

  async mapPatreonTier(
    pricingTierId: string,
    patreonTierId: string,
    adminUserId: string
  ): Promise<void> {
    return this.prisma.$transaction(async (tx) => {
      await tx.pricingTier.update({
        where: { id: pricingTierId },
        data: { patreonTierId },
      });

      await tx.auditLog.create({
        data: {
          action: 'MAP_PATREON_TIER',
          entityType: 'PRICING_TIER',
          entityId: pricingTierId,
          userId: adminUserId,
          changes: { patreonTierId },
        },
      });
    });
  }
}
