import type { LicenseFeatures } from '@bitbonsai/prisma-types';
import { LicenseTier } from '@prisma/client';

/**
 * Tier-based node and job limits
 */
export const TIER_LIMITS: Record<LicenseTier, { maxNodes: number; maxConcurrentJobs: number }> = {
  // Free tier - single node, limited concurrency
  [LicenseTier.FREE]: { maxNodes: 1, maxConcurrentJobs: 2 },
  // Patreon tiers - individual supporters
  [LicenseTier.PATREON]: { maxNodes: 2, maxConcurrentJobs: 3 }, // Legacy
  [LicenseTier.PATREON_SUPPORTER]: { maxNodes: 2, maxConcurrentJobs: 3 }, // $3/mo
  [LicenseTier.PATREON_PLUS]: { maxNodes: 3, maxConcurrentJobs: 5 }, // $5/mo
  [LicenseTier.PATREON_PRO]: { maxNodes: 5, maxConcurrentJobs: 10 }, // $10/mo
  [LicenseTier.PATREON_ULTIMATE]: { maxNodes: 10, maxConcurrentJobs: 20 }, // $20/mo
  // Commercial tiers - businesses
  [LicenseTier.COMMERCIAL_STARTER]: { maxNodes: 15, maxConcurrentJobs: 30 },
  [LicenseTier.COMMERCIAL_PRO]: { maxNodes: 50, maxConcurrentJobs: 100 },
  [LicenseTier.COMMERCIAL_ENTERPRISE]: { maxNodes: 999, maxConcurrentJobs: 999 },
};

/**
 * Get feature flags for a license tier
 */
export function getTierFeatures(tier: LicenseTier): LicenseFeatures {
  const isCommercial = tier.startsWith('COMMERCIAL');
  const isPatreonProOrHigher =
    tier === LicenseTier.PATREON_PRO || tier === LicenseTier.PATREON_ULTIMATE;

  return {
    multiNode: tier !== LicenseTier.FREE,
    advancedPresets: tier !== LicenseTier.FREE,
    api: isPatreonProOrHigher || isCommercial,
    priorityQueue: isPatreonProOrHigher || isCommercial,
    cloudStorage: isCommercial,
    webhooks: isPatreonProOrHigher || isCommercial,
  };
}
