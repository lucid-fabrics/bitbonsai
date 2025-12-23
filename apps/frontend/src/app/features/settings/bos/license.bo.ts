import { LicenseTier } from '../models/license.model';

/**
 * Business Object for license display logic
 * Following SRP: Separates license presentation logic from components
 */
export class LicenseBo {
  /**
   * Get CSS class for license tier badge
   */
  static getTierBadgeClass(tier: LicenseTier): string {
    switch (tier) {
      case LicenseTier.FREE:
        return 'tier-badge tier-free';
      case LicenseTier.PATREON:
      case LicenseTier.PATREON_SUPPORTER:
        return 'tier-badge tier-patreon';
      case LicenseTier.PATREON_PLUS:
        return 'tier-badge tier-patreon-plus';
      case LicenseTier.PATREON_PRO:
        return 'tier-badge tier-patreon-pro';
      case LicenseTier.PATREON_ULTIMATE:
        return 'tier-badge tier-patreon-ultimate';
      case LicenseTier.COMMERCIAL_STARTER:
        return 'tier-badge tier-commercial-starter';
      case LicenseTier.COMMERCIAL_PRO:
        return 'tier-badge tier-commercial-pro';
      case LicenseTier.COMMERCIAL_ENTERPRISE:
        return 'tier-badge tier-commercial-enterprise';
      default:
        return 'tier-badge';
    }
  }

  /**
   * Get display name for license tier
   */
  static getTierDisplayName(tier: LicenseTier): string {
    switch (tier) {
      case LicenseTier.FREE:
        return 'Free';
      case LicenseTier.PATREON:
      case LicenseTier.PATREON_SUPPORTER:
        return 'Supporter';
      case LicenseTier.PATREON_PLUS:
        return 'Plus';
      case LicenseTier.PATREON_PRO:
        return 'Pro';
      case LicenseTier.PATREON_ULTIMATE:
        return 'Ultimate';
      case LicenseTier.COMMERCIAL_STARTER:
        return 'Commercial Starter';
      case LicenseTier.COMMERCIAL_PRO:
        return 'Commercial Pro';
      case LicenseTier.COMMERCIAL_ENTERPRISE:
        return 'Enterprise';
      default:
        return tier;
    }
  }

  /**
   * Get tier price for display
   */
  static getTierPrice(tier: LicenseTier): string {
    switch (tier) {
      case LicenseTier.FREE:
        return 'Free';
      case LicenseTier.PATREON:
      case LicenseTier.PATREON_SUPPORTER:
        return '$3/mo';
      case LicenseTier.PATREON_PLUS:
        return '$5/mo';
      case LicenseTier.PATREON_PRO:
        return '$10/mo';
      case LicenseTier.PATREON_ULTIMATE:
        return '$20/mo';
      case LicenseTier.COMMERCIAL_STARTER:
        return '$49/mo';
      case LicenseTier.COMMERCIAL_PRO:
        return '$149/mo';
      case LicenseTier.COMMERCIAL_ENTERPRISE:
        return 'Contact';
      default:
        return '';
    }
  }

  /**
   * Check if tier is a Patreon tier
   */
  static isPatreonTier(tier: LicenseTier): boolean {
    return tier.startsWith('PATREON');
  }

  /**
   * Check if tier is a commercial tier
   */
  static isCommercialTier(tier: LicenseTier): boolean {
    return tier.startsWith('COMMERCIAL');
  }

  /**
   * Get tier order for comparison (higher = better)
   */
  static getTierOrder(tier: LicenseTier): number {
    const order: Record<LicenseTier, number> = {
      [LicenseTier.FREE]: 0,
      [LicenseTier.PATREON]: 1,
      [LicenseTier.PATREON_SUPPORTER]: 1,
      [LicenseTier.PATREON_PLUS]: 2,
      [LicenseTier.PATREON_PRO]: 3,
      [LicenseTier.PATREON_ULTIMATE]: 4,
      [LicenseTier.COMMERCIAL_STARTER]: 5,
      [LicenseTier.COMMERCIAL_PRO]: 6,
      [LicenseTier.COMMERCIAL_ENTERPRISE]: 7,
    };
    return order[tier] ?? 0;
  }

  /**
   * Check if targetTier is an upgrade from currentTier
   */
  static isUpgrade(currentTier: LicenseTier, targetTier: LicenseTier): boolean {
    return LicenseBo.getTierOrder(targetTier) > LicenseBo.getTierOrder(currentTier);
  }

  /**
   * Get tier icon class
   */
  static getTierIcon(tier: LicenseTier): string {
    switch (tier) {
      case LicenseTier.FREE:
        return 'fa fa-gift';
      case LicenseTier.PATREON:
      case LicenseTier.PATREON_SUPPORTER:
      case LicenseTier.PATREON_PLUS:
      case LicenseTier.PATREON_PRO:
      case LicenseTier.PATREON_ULTIMATE:
        return 'fab fa-patreon';
      case LicenseTier.COMMERCIAL_STARTER:
      case LicenseTier.COMMERCIAL_PRO:
        return 'fa fa-building';
      case LicenseTier.COMMERCIAL_ENTERPRISE:
        return 'fa fa-crown';
      default:
        return 'fa fa-key';
    }
  }

  /**
   * Mask license key for display
   */
  static formatLicenseKeyDisplay(licenseKey: string, revealed: boolean): string {
    return revealed ? licenseKey : '****-****-****-****';
  }

  /**
   * Mask API key for display
   */
  static formatApiKeyDisplay(apiKey: string, revealed: boolean): string {
    return revealed ? apiKey : '**********************';
  }
}
