import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface RevenueMetrics {
  mrr: number;
  arr: number;
  churnRate: number;
  clv: number;
  activeSubscriptions: number;
  newSubscriptionsThisMonth: number;
  revenueByTier: Record<string, number>;
  subscriptionHealth: {
    healthy: number;
    expiringSoon: number;
    overdue: number;
  };
}

export interface DailyRevenue {
  date: string;
  revenue: number;
  subscriptions: number;
}

export interface TierDistribution {
  tier: string;
  count: number;
  percentage: number;
}

@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  async getRevenueMetrics(): Promise<RevenueMetrics> {
    const activeSubscriptions = await this.prisma.license.findMany({
      where: { status: 'ACTIVE' },
    });

    // MRR calculation
    const mrr = await this.calculateMRR();

    // ARR = MRR × 12
    const arr = mrr * 12;

    // Churn rate (last 30 days)
    const churnRate = await this.calculateChurnRate();

    // CLV = Average monthly revenue / churn rate
    const avgMonthlyRevenue = activeSubscriptions.length > 0 ? mrr / activeSubscriptions.length : 0;
    const clv = churnRate > 0 ? avgMonthlyRevenue / (churnRate / 100) : avgMonthlyRevenue * 12;

    // Revenue by tier
    const revenueByTier = await this.calculateRevenueByTier();

    // Subscription health
    const subscriptionHealth = await this.calculateSubscriptionHealth();

    return {
      mrr,
      arr,
      churnRate,
      clv,
      activeSubscriptions: activeSubscriptions.length,
      newSubscriptionsThisMonth: await this.getNewSubscriptionsCount(),
      revenueByTier,
      subscriptionHealth,
    };
  }

  async getDailyRevenue(days = 30): Promise<DailyRevenue[]> {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const licenses = await this.prisma.license.findMany({
      where: {
        createdAt: { gte: startDate },
        status: { in: ['ACTIVE', 'EXPIRED'] },
      },
      orderBy: { createdAt: 'asc' },
    });

    // Group by date
    const dailyData: Record<string, { revenue: number; subscriptions: number }> = {};

    for (const license of licenses) {
      const dateKey = license.createdAt.toISOString().split('T')[0];

      if (!dailyData[dateKey]) {
        dailyData[dateKey] = { revenue: 0, subscriptions: 0 };
      }

      // Calculate monthly revenue for this license
      const tier = await this.getTierLimits(license.tier);
      dailyData[dateKey].revenue += tier.monthlyPrice / 100; // Convert cents to dollars
      dailyData[dateKey].subscriptions += 1;
    }

    return Object.entries(dailyData).map(([date, data]) => ({
      date,
      revenue: data.revenue,
      subscriptions: data.subscriptions,
    }));
  }

  async getTierDistribution(): Promise<TierDistribution[]> {
    const licenses = await this.prisma.license.groupBy({
      by: ['tier'],
      where: { status: 'ACTIVE' },
      _count: true,
    });

    const total = licenses.reduce((sum, item) => sum + item._count, 0);

    return licenses.map((item) => ({
      tier: item.tier,
      count: item._count,
      percentage: total > 0 ? (item._count / total) * 100 : 0,
    }));
  }

  async getMonthlyChurnRate(months = 12): Promise<Array<{ month: string; churnRate: number }>> {
    const result: Array<{ month: string; churnRate: number }> = [];

    for (let i = 0; i < months; i++) {
      const monthStart = new Date();
      monthStart.setMonth(monthStart.getMonth() - i);
      monthStart.setDate(1);
      monthStart.setHours(0, 0, 0, 0);

      const monthEnd = new Date(monthStart);
      monthEnd.setMonth(monthEnd.getMonth() + 1);

      const cancelledCount = await this.prisma.license.count({
        where: {
          status: 'REVOKED',
          updatedAt: { gte: monthStart, lt: monthEnd },
        },
      });

      const totalAtStart = await this.prisma.license.count({
        where: {
          createdAt: { lt: monthEnd },
          status: { in: ['ACTIVE', 'REVOKED'] },
        },
      });

      const churnRate = totalAtStart > 0 ? (cancelledCount / totalAtStart) * 100 : 0;

      result.unshift({
        month: monthStart.toISOString().substring(0, 7),
        churnRate,
      });
    }

    return result;
  }

  private async calculateMRR(): Promise<number> {
    // Use groupBy to aggregate licenses by tier in a single query
    const tierGroups = await this.prisma.license.groupBy({
      by: ['tier'],
      where: { status: 'ACTIVE' },
      _count: true,
    });

    // Fetch all tier pricing in a single query
    const tierPricing = await this.prisma.pricingTier.findMany({
      where: {
        name: {
          in: tierGroups.map((g) => g.tier),
        },
      },
      select: {
        name: true,
        priceMonthly: true,
      },
    });

    // Create a map for O(1) lookups
    const pricingMap = new Map(tierPricing.map((tier) => [tier.name, tier.priceMonthly]));

    // Calculate total MRR
    let totalMRR = 0;
    for (const group of tierGroups) {
      const price = pricingMap.get(group.tier) || 0;
      totalMRR += price * group._count;
    }

    return totalMRR / 100; // Convert cents to dollars
  }

  private async calculateChurnRate(): Promise<number> {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const cancelledCount = await this.prisma.license.count({
      where: {
        status: 'REVOKED',
        updatedAt: { gte: thirtyDaysAgo },
      },
    });

    const activeCount = await this.prisma.license.count({
      where: { status: 'ACTIVE' },
    });

    const totalAtStart = activeCount + cancelledCount;
    return totalAtStart > 0 ? (cancelledCount / totalAtStart) * 100 : 0;
  }

  private async calculateRevenueByTier(): Promise<Record<string, number>> {
    const licenses = await this.prisma.license.findMany({
      where: { status: 'ACTIVE' },
    });

    const revenueByTier: Record<string, number> = {};

    for (const license of licenses) {
      const tier = await this.getTierLimits(license.tier);
      const tierName = license.tier;

      if (!revenueByTier[tierName]) {
        revenueByTier[tierName] = 0;
      }

      revenueByTier[tierName] += tier.monthlyPrice / 100;
    }

    return revenueByTier;
  }

  private async calculateSubscriptionHealth() {
    const now = new Date();
    const sevenDaysFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    const activeLicenses = await this.prisma.license.findMany({
      where: { status: 'ACTIVE' },
    });

    const health = {
      healthy: 0,
      expiringSoon: 0,
      overdue: 0,
    };

    for (const license of activeLicenses) {
      if (!license.expiresAt) {
        health.healthy++;
      } else if (license.expiresAt > sevenDaysFromNow) {
        health.healthy++;
      } else if (license.expiresAt > now) {
        health.expiringSoon++;
      } else {
        health.overdue++;
      }
    }

    return health;
  }

  private async getNewSubscriptionsCount(): Promise<number> {
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    return this.prisma.license.count({
      where: {
        createdAt: { gte: startOfMonth },
      },
    });
  }

  private async getTierLimits(
    tier: string
  ): Promise<{ monthlyPrice: number; yearlyPrice: number }> {
    // Try to get from pricing_tiers table first
    const pricingTier = await this.prisma.pricingTier.findFirst({
      where: { name: tier, isActive: true },
    });

    if (pricingTier) {
      return {
        monthlyPrice: pricingTier.priceMonthly,
        yearlyPrice: pricingTier.priceYearly || pricingTier.priceMonthly * 12,
      };
    }

    // Fallback to hardcoded tier pricing (legacy)
    const TIER_PRICING: Record<string, { monthlyPrice: number; yearlyPrice: number }> = {
      FREE: { monthlyPrice: 0, yearlyPrice: 0 },
      PATREON_SUPPORTER: { monthlyPrice: 300, yearlyPrice: 3000 },
      PATREON_PLUS: { monthlyPrice: 500, yearlyPrice: 5000 },
      PATREON_PRO: { monthlyPrice: 1000, yearlyPrice: 10000 },
      PATREON_ULTIMATE: { monthlyPrice: 2000, yearlyPrice: 20000 },
      COMMERCIAL_STARTER: { monthlyPrice: 2900, yearlyPrice: 29000 },
      COMMERCIAL_PRO: { monthlyPrice: 9900, yearlyPrice: 99000 },
      COMMERCIAL_ENTERPRISE: { monthlyPrice: 29900, yearlyPrice: 299000 },
    };

    return TIER_PRICING[tier] || { monthlyPrice: 0, yearlyPrice: 0 };
  }
}
