import type { LicenseFeatures } from '@bitbonsai/prisma-types';

/**
 * Tier-based node and job limits
 */
export const TIER_LIMITS: Record<string, { maxNodes: number; maxConcurrentJobs: number }> = {
  FREE: { maxNodes: 1, maxConcurrentJobs: 2 },
  PATREON: { maxNodes: 2, maxConcurrentJobs: 3 }, // Legacy
  PATREON_SUPPORTER: { maxNodes: 2, maxConcurrentJobs: 3 },
  PATREON_PLUS: { maxNodes: 3, maxConcurrentJobs: 5 },
  PATREON_PRO: { maxNodes: 5, maxConcurrentJobs: 10 },
  PATREON_ULTIMATE: { maxNodes: 10, maxConcurrentJobs: 20 },
  COMMERCIAL_STARTER: { maxNodes: 15, maxConcurrentJobs: 30 },
  COMMERCIAL_PRO: { maxNodes: 50, maxConcurrentJobs: 100 },
  COMMERCIAL_ENTERPRISE: { maxNodes: 999, maxConcurrentJobs: 999 },
};

/**
 * Get feature flags for a license tier
 */
export function getTierFeatures(tier: string): LicenseFeatures {
  const isCommercial = tier.startsWith('COMMERCIAL');
  const isPatreonProOrHigher = tier === 'PATREON_PRO' || tier === 'PATREON_ULTIMATE';

  return {
    multiNode: tier !== 'FREE',
    advancedPresets: tier !== 'FREE',
    api: isPatreonProOrHigher || isCommercial,
    priorityQueue: isPatreonProOrHigher || isCommercial,
    cloudStorage: isCommercial,
    webhooks: isPatreonProOrHigher || isCommercial,
  };
}
