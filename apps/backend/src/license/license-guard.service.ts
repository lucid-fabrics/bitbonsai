import type { LicenseFeatures } from '@bitbonsai/prisma-types';
import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { LicenseStatus, LicenseTier } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * License feature flags
 */
export interface LicenseCapabilities {
  tier: LicenseTier;
  maxNodes: number;
  maxConcurrentJobs: number;
  currentNodes: number;
  currentConcurrentJobs: number;
  features: LicenseFeatures;
  canAddNode: boolean;
  canStartJob: boolean;
}

/**
 * LicenseGuardService
 *
 * Enforces license limits across the application:
 * - Node limits: Prevents adding nodes beyond tier limit
 * - Concurrent job limits: Prevents starting jobs beyond limit
 * - Feature access: Gates features based on tier
 *
 * UX Philosophy: Graceful degradation with clear upgrade prompts
 */
@Injectable()
export class LicenseGuardService {
  private readonly logger = new Logger(LicenseGuardService.name);

  // Default limits for FREE tier (no license record)
  private readonly FREE_DEFAULTS = {
    maxNodes: 1,
    maxConcurrentJobs: 2,
    features: {
      multiNode: false,
      advancedPresets: false,
      api: false,
      priorityQueue: false,
      cloudStorage: false,
      webhooks: false,
    } as LicenseFeatures,
  };

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Get current license capabilities
   */
  async getCapabilities(): Promise<LicenseCapabilities> {
    // Find active license
    const license = await this.prisma.license.findFirst({
      where: { status: LicenseStatus.ACTIVE },
      select: {
        tier: true,
        maxNodes: true,
        maxConcurrentJobs: true,
        features: true,
        validUntil: true,
      },
    });

    // Check expiration
    if (license?.validUntil && license.validUntil < new Date()) {
      this.logger.warn('License has expired, reverting to FREE tier limits');
      return this.getFreeTierCapabilities();
    }

    // Count current usage
    const [nodeCount, activeJobCount] = await Promise.all([
      this.prisma.node.count({ where: { status: 'ONLINE' } }),
      this.prisma.job.count({ where: { stage: 'ENCODING' } }),
    ]);

    if (!license) {
      return {
        tier: LicenseTier.FREE,
        maxNodes: this.FREE_DEFAULTS.maxNodes,
        maxConcurrentJobs: this.FREE_DEFAULTS.maxConcurrentJobs,
        currentNodes: nodeCount,
        currentConcurrentJobs: activeJobCount,
        features: this.FREE_DEFAULTS.features,
        canAddNode: nodeCount < this.FREE_DEFAULTS.maxNodes,
        canStartJob: activeJobCount < this.FREE_DEFAULTS.maxConcurrentJobs,
      };
    }

    const features = license.features as unknown as LicenseFeatures;

    return {
      tier: license.tier,
      maxNodes: license.maxNodes,
      maxConcurrentJobs: license.maxConcurrentJobs,
      currentNodes: nodeCount,
      currentConcurrentJobs: activeJobCount,
      features,
      canAddNode: nodeCount < license.maxNodes,
      canStartJob: activeJobCount < license.maxConcurrentJobs,
    };
  }

  /**
   * Get FREE tier capabilities (used when no license or expired)
   */
  private async getFreeTierCapabilities(): Promise<LicenseCapabilities> {
    const [nodeCount, activeJobCount] = await Promise.all([
      this.prisma.node.count({ where: { status: 'ONLINE' } }),
      this.prisma.job.count({ where: { stage: 'ENCODING' } }),
    ]);

    return {
      tier: LicenseTier.FREE,
      maxNodes: this.FREE_DEFAULTS.maxNodes,
      maxConcurrentJobs: this.FREE_DEFAULTS.maxConcurrentJobs,
      currentNodes: nodeCount,
      currentConcurrentJobs: activeJobCount,
      features: this.FREE_DEFAULTS.features,
      canAddNode: nodeCount < this.FREE_DEFAULTS.maxNodes,
      canStartJob: activeJobCount < this.FREE_DEFAULTS.maxConcurrentJobs,
    };
  }

  /**
   * Check if a new node can be added
   * @throws ForbiddenException if node limit reached
   */
  async assertCanAddNode(): Promise<void> {
    const capabilities = await this.getCapabilities();

    if (!capabilities.canAddNode) {
      throw new ForbiddenException({
        error: 'NODE_LIMIT_REACHED',
        message: `Your ${capabilities.tier} license allows ${capabilities.maxNodes} node(s). Currently using ${capabilities.currentNodes}.`,
        currentNodes: capabilities.currentNodes,
        maxNodes: capabilities.maxNodes,
        tier: capabilities.tier,
        upgradeUrl: '/settings?tab=license',
      });
    }
  }

  /**
   * Check if a new job can be started
   * @throws ForbiddenException if concurrent job limit reached
   */
  async assertCanStartJob(): Promise<void> {
    const capabilities = await this.getCapabilities();

    if (!capabilities.canStartJob) {
      throw new ForbiddenException({
        error: 'CONCURRENT_JOB_LIMIT_REACHED',
        message: `Your ${capabilities.tier} license allows ${capabilities.maxConcurrentJobs} concurrent job(s). Currently running ${capabilities.currentConcurrentJobs}.`,
        currentJobs: capabilities.currentConcurrentJobs,
        maxJobs: capabilities.maxConcurrentJobs,
        tier: capabilities.tier,
        upgradeUrl: '/settings?tab=license',
      });
    }
  }

  /**
   * Check if a feature is enabled
   * @throws ForbiddenException if feature not available
   */
  async assertFeatureEnabled(feature: keyof LicenseFeatures): Promise<void> {
    const capabilities = await this.getCapabilities();

    if (!capabilities.features[feature]) {
      const featureNames: Record<keyof LicenseFeatures, string> = {
        multiNode: 'Multi-Node Support',
        advancedPresets: 'Advanced Presets',
        api: 'API Access',
        priorityQueue: 'Priority Queue',
        cloudStorage: 'Cloud Storage',
        webhooks: 'Webhooks',
        qualityAnalysis: 'Quality Analysis',
        hardwareAcceleration: 'Hardware Acceleration',
        customBranding: 'Custom Branding',
      };

      throw new ForbiddenException({
        error: 'FEATURE_NOT_AVAILABLE',
        message: `${featureNames[feature]} requires a higher tier license.`,
        feature,
        tier: capabilities.tier,
        upgradeUrl: '/settings?tab=license',
      });
    }
  }

  /**
   * Check if feature is enabled (non-throwing)
   */
  async isFeatureEnabled(feature: keyof LicenseFeatures): Promise<boolean> {
    const capabilities = await this.getCapabilities();
    return capabilities.features[feature] ?? false;
  }

  /**
   * Check if API access is allowed
   */
  async hasApiAccess(): Promise<boolean> {
    return this.isFeatureEnabled('api');
  }

  /**
   * Check if webhooks are allowed
   */
  async hasWebhookAccess(): Promise<boolean> {
    return this.isFeatureEnabled('webhooks');
  }

  /**
   * Get upgrade recommendation based on current usage
   */
  async getUpgradeRecommendation(): Promise<{
    shouldUpgrade: boolean;
    reason?: string;
    recommendedTier?: LicenseTier;
  }> {
    const capabilities = await this.getCapabilities();

    // Already at enterprise level
    if (capabilities.tier === LicenseTier.COMMERCIAL_ENTERPRISE) {
      return { shouldUpgrade: false };
    }

    // Check if near limits
    const nodeUsage = capabilities.currentNodes / capabilities.maxNodes;
    const jobUsage = capabilities.currentConcurrentJobs / capabilities.maxConcurrentJobs;

    if (nodeUsage >= 0.8 || jobUsage >= 0.8) {
      const tierOrder: LicenseTier[] = [
        LicenseTier.FREE,
        LicenseTier.PATREON_SUPPORTER,
        LicenseTier.PATREON_PLUS,
        LicenseTier.PATREON_PRO,
        LicenseTier.PATREON_ULTIMATE,
        LicenseTier.COMMERCIAL_STARTER,
        LicenseTier.COMMERCIAL_PRO,
        LicenseTier.COMMERCIAL_ENTERPRISE,
      ];

      const currentIndex = tierOrder.indexOf(capabilities.tier);
      const nextTier = tierOrder[currentIndex + 1];

      return {
        shouldUpgrade: true,
        reason:
          nodeUsage >= 0.8
            ? `Using ${capabilities.currentNodes}/${capabilities.maxNodes} nodes`
            : `Running ${capabilities.currentConcurrentJobs}/${capabilities.maxConcurrentJobs} concurrent jobs`,
        recommendedTier: nextTier,
      };
    }

    return { shouldUpgrade: false };
  }
}
