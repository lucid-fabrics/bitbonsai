import type { LicenseFeatures } from '@bitbonsai/prisma-types';
import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { CloudAuthService } from '../cloud-auth/cloud-auth.service';
import { JobRepository } from '../common/repositories/job.repository';
import { NodeRepository } from '../common/repositories/node.repository';

/**
 * License feature flags
 */
export interface LicenseCapabilities {
  tier: string;
  maxNodes: number;
  maxConcurrentJobs: number;
  currentNodes: number;
  currentConcurrentJobs: number;
  features: LicenseFeatures;
  canAddNode: boolean;
  canStartJob: boolean;
}

function defaultFeatures(tier: string): LicenseFeatures {
  const isNotFree = tier !== 'FREE';
  const isProOrHigher =
    tier === 'PRO' || tier === 'ULTIMATE' || tier === 'PLUS' || tier.startsWith('COMMERCIAL');
  const isCommercial = tier.startsWith('COMMERCIAL');

  return {
    multiNode: isNotFree,
    advancedPresets: isNotFree,
    api: isProOrHigher,
    priorityQueue: isProOrHigher,
    cloudStorage: isCommercial,
    webhooks: isProOrHigher,
    qualityAnalysis: isProOrHigher,
    hardwareAcceleration: isNotFree,
    customBranding: isCommercial,
  };
}

/**
 * LicenseGuardService
 *
 * Enforces license limits across the application.
 * Reads entitlements from Settings (cloud-auth cache) instead of
 * the legacy License DB table (which has been removed).
 */
@Injectable()
export class LicenseGuardService {
  private readonly logger = new Logger(LicenseGuardService.name);

  constructor(
    private readonly cloudAuth: CloudAuthService,
    private readonly nodeRepository: NodeRepository,
    private readonly jobRepository: JobRepository
  ) {}

  /**
   * Get current license capabilities
   */
  async getCapabilities(): Promise<LicenseCapabilities> {
    const [status, nodeCount, activeJobCount] = await Promise.all([
      this.cloudAuth.getStatus(),
      this.nodeRepository.count({ where: { status: 'ONLINE' } }),
      this.jobRepository.countWhere({ stage: 'ENCODING' }),
    ]);

    const tier = status.tier ?? 'FREE';
    const maxNodes = status.gracePeriodExpired ? 0 : (status.maxNodes ?? 1);
    const maxConcurrentJobs = status.gracePeriodExpired ? 0 : (status.maxConcurrentJobs ?? 2);

    return {
      tier,
      maxNodes,
      maxConcurrentJobs,
      currentNodes: nodeCount,
      currentConcurrentJobs: activeJobCount,
      features: defaultFeatures(tier),
      canAddNode: nodeCount < maxNodes,
      canStartJob: activeJobCount < maxConcurrentJobs,
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
        message: `Your ${capabilities.tier} plan allows ${capabilities.maxNodes} node(s). Currently using ${capabilities.currentNodes}.`,
        currentNodes: capabilities.currentNodes,
        maxNodes: capabilities.maxNodes,
        tier: capabilities.tier,
        upgradeUrl: '/settings?tab=account',
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
        message: `Your ${capabilities.tier} plan allows ${capabilities.maxConcurrentJobs} concurrent job(s). Currently running ${capabilities.currentConcurrentJobs}.`,
        currentJobs: capabilities.currentConcurrentJobs,
        maxJobs: capabilities.maxConcurrentJobs,
        tier: capabilities.tier,
        upgradeUrl: '/settings?tab=account',
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
      const featureNames: Record<string, string> = {
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
        message: `${featureNames[feature as string] ?? String(feature)} requires a higher tier plan.`,
        feature,
        tier: capabilities.tier,
        upgradeUrl: '/settings?tab=account',
      });
    }
  }

  /**
   * Check if feature is enabled (non-throwing)
   */
  async isFeatureEnabled(feature: keyof LicenseFeatures): Promise<boolean> {
    const capabilities = await this.getCapabilities();
    return (capabilities.features[feature] as boolean) ?? false;
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
    recommendedTier?: string;
  }> {
    const capabilities = await this.getCapabilities();

    if (capabilities.tier === 'COMMERCIAL_ENTERPRISE') {
      return { shouldUpgrade: false };
    }

    const nodeUsage =
      capabilities.maxNodes > 0 ? capabilities.currentNodes / capabilities.maxNodes : 1;
    const jobUsage =
      capabilities.maxConcurrentJobs > 0
        ? capabilities.currentConcurrentJobs / capabilities.maxConcurrentJobs
        : 1;

    if (nodeUsage >= 0.8 || jobUsage >= 0.8) {
      return {
        shouldUpgrade: true,
        reason:
          nodeUsage >= 0.8
            ? `Using ${capabilities.currentNodes}/${capabilities.maxNodes} nodes`
            : `Running ${capabilities.currentConcurrentJobs}/${capabilities.maxConcurrentJobs} concurrent jobs`,
        recommendedTier: 'PATREON_PRO',
      };
    }

    return { shouldUpgrade: false };
  }
}
