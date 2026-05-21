import { LicenseTier } from '../models/license.model';

export class LicenseBo {
  static getTierBadgeClass(tier: LicenseTier): string {
    switch (tier) {
      case LicenseTier.FREE:
        return 'tier-badge tier-free';
      case LicenseTier.SUPPORTER:
        return 'tier-badge tier-supporter';
      case LicenseTier.PLUS:
        return 'tier-badge tier-plus';
      case LicenseTier.PRO:
        return 'tier-badge tier-pro';
      case LicenseTier.ULTIMATE:
        return 'tier-badge tier-ultimate';
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

  static getTierDisplayName(tier: LicenseTier): string {
    switch (tier) {
      case LicenseTier.FREE:
        return 'Free';
      case LicenseTier.SUPPORTER:
        return 'Supporter';
      case LicenseTier.PLUS:
        return 'Plus';
      case LicenseTier.PRO:
        return 'Pro';
      case LicenseTier.ULTIMATE:
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

  static getTierPrice(tier: LicenseTier): string {
    switch (tier) {
      case LicenseTier.FREE:
        return 'Free';
      case LicenseTier.SUPPORTER:
        return '$3/mo';
      case LicenseTier.PLUS:
        return '$5/mo';
      case LicenseTier.PRO:
        return '$10/mo';
      case LicenseTier.ULTIMATE:
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

  static isCommercialTier(tier: LicenseTier): boolean {
    return tier.startsWith('COMMERCIAL');
  }

  static getTierOrder(tier: LicenseTier): number {
    const order: Record<LicenseTier, number> = {
      [LicenseTier.FREE]: 0,
      [LicenseTier.SUPPORTER]: 1,
      [LicenseTier.PLUS]: 2,
      [LicenseTier.PRO]: 3,
      [LicenseTier.ULTIMATE]: 4,
      [LicenseTier.COMMERCIAL_STARTER]: 5,
      [LicenseTier.COMMERCIAL_PRO]: 6,
      [LicenseTier.COMMERCIAL_ENTERPRISE]: 7,
    };
    return order[tier] ?? 0;
  }

  static isUpgrade(currentTier: LicenseTier, targetTier: LicenseTier): boolean {
    return LicenseBo.getTierOrder(targetTier) > LicenseBo.getTierOrder(currentTier);
  }

  static getTierIcon(tier: LicenseTier): string {
    switch (tier) {
      case LicenseTier.FREE:
        return 'fa fa-gift';
      case LicenseTier.SUPPORTER:
        return 'fa fa-heart';
      case LicenseTier.PLUS:
        return 'fa fa-star';
      case LicenseTier.PRO:
        return 'fa fa-bolt';
      case LicenseTier.ULTIMATE:
        return 'fa fa-rocket';
      case LicenseTier.COMMERCIAL_STARTER:
      case LicenseTier.COMMERCIAL_PRO:
        return 'fa fa-building';
      case LicenseTier.COMMERCIAL_ENTERPRISE:
        return 'fa fa-crown';
      default:
        return 'fa fa-key';
    }
  }

  static formatLicenseKeyDisplay(licenseKey: string, revealed: boolean): string {
    return revealed ? licenseKey : '****-****-****-****';
  }

  static formatApiKeyDisplay(apiKey: string, revealed: boolean): string {
    return revealed ? apiKey : '**********************';
  }
}
