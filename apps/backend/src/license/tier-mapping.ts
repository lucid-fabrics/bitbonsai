import { LicenseTier } from '@prisma/client';

/**
 * Maps external tier names (from licensing-service) to BitBonsai's internal LicenseTier enum.
 *
 * The licensing-service uses simplified tier names (SUPPORTER, PLUS, etc.)
 * while BitBonsai uses prefixed names (PATREON_SUPPORTER, PATREON_PLUS, etc.)
 */
const EXTERNAL_TO_INTERNAL_TIER: Record<string, LicenseTier> = {
  FREE: LicenseTier.FREE,
  SUPPORTER: LicenseTier.PATREON_SUPPORTER,
  PLUS: LicenseTier.PATREON_PLUS,
  PRO: LicenseTier.PATREON_PRO,
  ULTIMATE: LicenseTier.PATREON_ULTIMATE,
  COMMERCIAL_STARTER: LicenseTier.COMMERCIAL_STARTER,
  COMMERCIAL_PRO: LicenseTier.COMMERCIAL_PRO,
  COMMERCIAL_ENTERPRISE: LicenseTier.COMMERCIAL_ENTERPRISE,
  // Also support internal names being passed through
  PATREON: LicenseTier.PATREON,
  PATREON_SUPPORTER: LicenseTier.PATREON_SUPPORTER,
  PATREON_PLUS: LicenseTier.PATREON_PLUS,
  PATREON_PRO: LicenseTier.PATREON_PRO,
  PATREON_ULTIMATE: LicenseTier.PATREON_ULTIMATE,
};

/**
 * Maps an external tier name to BitBonsai's internal LicenseTier enum.
 * Logs a warning for unknown tiers and falls back to FREE.
 */
export function mapExternalTier(
  externalTier: string,
  logger?: { warn: (msg: string) => void }
): LicenseTier {
  const tier = EXTERNAL_TO_INTERNAL_TIER[externalTier?.toUpperCase()];
  if (!tier) {
    const msg = `Unknown license tier "${externalTier}" - defaulting to FREE`;
    if (logger) {
      logger.warn(msg);
    }
    return LicenseTier.FREE;
  }
  return tier;
}

/**
 * Maps BitBonsai internal tier to external tier name (for API calls to licensing-service)
 */
export function mapInternalTierToExternal(internalTier: LicenseTier): string {
  switch (internalTier) {
    case LicenseTier.PATREON_SUPPORTER:
      return 'SUPPORTER';
    case LicenseTier.PATREON_PLUS:
      return 'PLUS';
    case LicenseTier.PATREON_PRO:
      return 'PRO';
    case LicenseTier.PATREON_ULTIMATE:
      return 'ULTIMATE';
    default:
      return internalTier;
  }
}
