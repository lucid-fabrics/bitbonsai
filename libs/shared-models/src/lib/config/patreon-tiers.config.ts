import { LicenseTier } from '../enums/license-tier.enum';

/**
 * Patreon Tier Configuration
 *
 * Centralized source of truth for Patreon tier mapping.
 * Used by both backend OAuth flow and license-API webhooks.
 *
 * CRITICAL: Keep amounts synchronized with Patreon campaign tiers:
 * https://www.patreon.com/bitbonsai/membership
 */

export interface PatreonTierConfig {
  /** Patreon tier title (case-insensitive match) */
  tierName: string;
  /** Pledge amount in cents */
  amountCents: number;
  /** BitBonsai license tier */
  licenseTier: LicenseTier;
  /** Display name for UI */
  displayName: string;
  /** Maximum nodes allowed */
  maxNodes: number;
  /** Maximum concurrent jobs */
  maxConcurrentJobs: number;
  /** Feature flags */
  features: {
    multiNode: boolean;
    advancedPresets: boolean;
    api: boolean;
    webhooks: boolean;
    priorityQueue: boolean;
  };
}

/**
 * Official Patreon tier configuration
 *
 * IMPORTANT: Amounts must match Patreon campaign exactly
 * Update this when Patreon tier pricing changes
 */
export const PATREON_TIERS: PatreonTierConfig[] = [
  {
    tierName: 'Supporter',
    amountCents: 500, // $5/month
    licenseTier: LicenseTier.PATREON_SUPPORTER,
    displayName: 'Patreon Supporter',
    maxNodes: 2,
    maxConcurrentJobs: 3,
    features: {
      multiNode: true,
      advancedPresets: true,
      api: false,
      webhooks: false,
      priorityQueue: false,
    },
  },
  {
    tierName: 'Plus',
    amountCents: 1000, // $10/month
    licenseTier: LicenseTier.PATREON_PLUS,
    displayName: 'Patreon Plus',
    maxNodes: 3,
    maxConcurrentJobs: 5,
    features: {
      multiNode: true,
      advancedPresets: true,
      api: false,
      webhooks: false,
      priorityQueue: false,
    },
  },
  {
    tierName: 'Pro',
    amountCents: 1500, // $15/month
    licenseTier: LicenseTier.PATREON_PRO,
    displayName: 'Patreon Pro',
    maxNodes: 5,
    maxConcurrentJobs: 10,
    features: {
      multiNode: true,
      advancedPresets: true,
      api: true,
      webhooks: true,
      priorityQueue: true,
    },
  },
  {
    tierName: 'Ultimate',
    amountCents: 2500, // $25/month
    licenseTier: LicenseTier.PATREON_ULTIMATE,
    displayName: 'Patreon Ultimate',
    maxNodes: 10,
    maxConcurrentJobs: 20,
    features: {
      multiNode: true,
      advancedPresets: true,
      api: true,
      webhooks: true,
      priorityQueue: true,
    },
  },
];

/**
 * Map Patreon tier name to license tier
 * Case-insensitive lookup
 */
export const PATREON_TIER_NAME_MAP: Record<string, LicenseTier> = {
  supporter: LicenseTier.PATREON_SUPPORTER,
  plus: LicenseTier.PATREON_PLUS,
  pro: LicenseTier.PATREON_PRO,
  ultimate: LicenseTier.PATREON_ULTIMATE,
};

/**
 * Map pledge amount (cents) to license tier
 * Finds highest tier that pledge amount qualifies for
 */
export function getLicenseTierFromPledgeAmount(amountCents: number): LicenseTier {
  // Sort tiers by amount descending
  const sortedTiers = [...PATREON_TIERS].sort((a, b) => b.amountCents - a.amountCents);

  // Find highest tier that amount qualifies for
  for (const tier of sortedTiers) {
    if (amountCents >= tier.amountCents) {
      return tier.licenseTier;
    }
  }

  // Below minimum tier amount - return FREE
  return LicenseTier.FREE;
}

/**
 * Get tier configuration by license tier
 */
export function getPatreonTierConfig(licenseTier: LicenseTier): PatreonTierConfig | null {
  return PATREON_TIERS.find((t) => t.licenseTier === licenseTier) || null;
}

/**
 * Get tier configuration by tier name (case-insensitive)
 */
export function getPatreonTierByName(tierName: string): PatreonTierConfig | null {
  const normalized = tierName.toLowerCase();
  return PATREON_TIERS.find((t) => t.tierName.toLowerCase() === normalized) || null;
}

/**
 * Determine license tier from Patreon webhook payload
 *
 * Strategy:
 * 1. Try matching tier title from included tiers
 * 2. Fall back to pledge amount
 */
export function determineLicenseTierFromWebhook(params: {
  entitledTierTitles: string[];
  pledgeAmountCents: number;
}): LicenseTier {
  const { entitledTierTitles, pledgeAmountCents } = params;

  // Try tier name match first
  for (const title of entitledTierTitles) {
    const tier = getPatreonTierByName(title);
    if (tier) {
      return tier.licenseTier;
    }
  }

  // Fall back to amount-based mapping
  return getLicenseTierFromPledgeAmount(pledgeAmountCents);
}
