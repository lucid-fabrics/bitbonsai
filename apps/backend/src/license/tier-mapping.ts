/**
 * Maps external tier names (from licensing-service) to internal tier strings.
 *
 * The licensing-service uses simplified tier names (SUPPORTER, PLUS, etc.)
 * while BitBonsai uses prefixed names (PATREON_SUPPORTER, PATREON_PLUS, etc.)
 */
const EXTERNAL_TO_INTERNAL_TIER: Record<string, string> = {
  FREE: 'FREE',
  SUPPORTER: 'PATREON_SUPPORTER',
  PLUS: 'PATREON_PLUS',
  PRO: 'PATREON_PRO',
  ULTIMATE: 'PATREON_ULTIMATE',
  COMMERCIAL_STARTER: 'COMMERCIAL_STARTER',
  COMMERCIAL_PRO: 'COMMERCIAL_PRO',
  COMMERCIAL_ENTERPRISE: 'COMMERCIAL_ENTERPRISE',
  // Also support internal names being passed through
  PATREON: 'PATREON',
  PATREON_SUPPORTER: 'PATREON_SUPPORTER',
  PATREON_PLUS: 'PATREON_PLUS',
  PATREON_PRO: 'PATREON_PRO',
  PATREON_ULTIMATE: 'PATREON_ULTIMATE',
};

/**
 * Maps an external tier name to internal tier string.
 * Logs a warning for unknown tiers and falls back to FREE.
 */
export function mapExternalTier(
  externalTier: string,
  logger?: { warn: (msg: string) => void }
): string {
  const tier = EXTERNAL_TO_INTERNAL_TIER[externalTier?.toUpperCase()];
  if (!tier) {
    const msg = `Unknown license tier "${externalTier}" - defaulting to FREE`;
    if (logger) {
      logger.warn(msg);
    }
    return 'FREE';
  }
  return tier;
}

/**
 * Maps BitBonsai internal tier to external tier name (for API calls to licensing-service)
 */
export function mapInternalTierToExternal(internalTier: string): string {
  switch (internalTier) {
    case 'PATREON_SUPPORTER':
      return 'SUPPORTER';
    case 'PATREON_PLUS':
      return 'PLUS';
    case 'PATREON_PRO':
      return 'PRO';
    case 'PATREON_ULTIMATE':
      return 'ULTIMATE';
    default:
      return internalTier;
  }
}
