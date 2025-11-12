import { LicenseTier } from '../models/license.model';

/**
 * Business Object for license display logic
 * Following SRP: Separates license presentation logic from components
 */
export class LicenseBo {
  /**
   * Get CSS class for license tier badge
   * @param tier - License tier enum value
   * @returns CSS class string
   */
  static getTierBadgeClass(tier: LicenseTier): string {
    switch (tier) {
      case LicenseTier.FREE:
        return 'tier-badge tier-free';
      case LicenseTier.PATREON:
        return 'tier-badge tier-patreon';
      case LicenseTier.COMMERCIAL_PRO:
        return 'tier-badge tier-commercial';
      default:
        return 'tier-badge';
    }
  }

  /**
   * Get display name for license tier
   * @param tier - License tier enum value
   * @returns Human-readable tier name
   */
  static getTierDisplayName(tier: LicenseTier): string {
    switch (tier) {
      case LicenseTier.FREE:
        return 'Free';
      case LicenseTier.PATREON:
        return 'Patreon Supporter';
      case LicenseTier.COMMERCIAL_PRO:
        return 'Commercial Pro';
      default:
        return tier;
    }
  }

  /**
   * Mask license key for display
   * @param revealed - Whether key should be revealed
   * @returns Masked or full license key display string
   */
  static formatLicenseKeyDisplay(licenseKey: string, revealed: boolean): string {
    return revealed ? licenseKey : '****-****-****-****';
  }

  /**
   * Mask API key for display
   * @param revealed - Whether key should be revealed
   * @returns Masked or full API key display string
   */
  static formatApiKeyDisplay(apiKey: string, revealed: boolean): string {
    return revealed ? apiKey : '**********************';
  }
}
