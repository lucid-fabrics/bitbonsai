import { LicenseTier } from '../models/license.model';
import { LicenseBo } from './license.bo';

describe('LicenseBo', () => {
  describe('getTierBadgeClass', () => {
    it('should return correct badge class for FREE', () => {
      expect(LicenseBo.getTierBadgeClass(LicenseTier.FREE)).toBe('tier-badge tier-free');
    });

    it('should return correct badge class for SUPPORTER', () => {
      expect(LicenseBo.getTierBadgeClass(LicenseTier.SUPPORTER)).toBe('tier-badge tier-supporter');
    });

    it('should return correct badge class for PRO', () => {
      expect(LicenseBo.getTierBadgeClass(LicenseTier.PRO)).toBe('tier-badge tier-pro');
    });

    it('should return correct badge class for COMMERCIAL_ENTERPRISE', () => {
      expect(LicenseBo.getTierBadgeClass(LicenseTier.COMMERCIAL_ENTERPRISE)).toBe(
        'tier-badge tier-commercial-enterprise'
      );
    });

    it('should return default badge class for unknown tier', () => {
      expect(LicenseBo.getTierBadgeClass('UNKNOWN' as LicenseTier)).toBe('tier-badge');
    });
  });

  describe('getTierDisplayName', () => {
    it('should return Free for FREE tier', () => {
      expect(LicenseBo.getTierDisplayName(LicenseTier.FREE)).toBe('Free');
    });

    it('should return Commercial Starter for COMMERCIAL_STARTER', () => {
      expect(LicenseBo.getTierDisplayName(LicenseTier.COMMERCIAL_STARTER)).toBe(
        'Commercial Starter'
      );
    });

    it('should return Enterprise for COMMERCIAL_ENTERPRISE', () => {
      expect(LicenseBo.getTierDisplayName(LicenseTier.COMMERCIAL_ENTERPRISE)).toBe('Enterprise');
    });

    it('should return the raw tier value for unknown tier', () => {
      expect(LicenseBo.getTierDisplayName('MYSTERY' as LicenseTier)).toBe('MYSTERY');
    });
  });

  describe('getTierPrice', () => {
    it('should return Free for FREE tier', () => {
      expect(LicenseBo.getTierPrice(LicenseTier.FREE)).toBe('Free');
    });

    it('should return $10/mo for PRO', () => {
      expect(LicenseBo.getTierPrice(LicenseTier.PRO)).toBe('$10/mo');
    });

    it('should return Contact for COMMERCIAL_ENTERPRISE', () => {
      expect(LicenseBo.getTierPrice(LicenseTier.COMMERCIAL_ENTERPRISE)).toBe('Contact');
    });

    it('should return empty string for unknown tier', () => {
      expect(LicenseBo.getTierPrice('NOPE' as LicenseTier)).toBe('');
    });
  });

  describe('isCommercialTier', () => {
    it('should return true for COMMERCIAL_STARTER', () => {
      expect(LicenseBo.isCommercialTier(LicenseTier.COMMERCIAL_STARTER)).toBe(true);
    });

    it('should return true for COMMERCIAL_PRO', () => {
      expect(LicenseBo.isCommercialTier(LicenseTier.COMMERCIAL_PRO)).toBe(true);
    });

    it('should return true for COMMERCIAL_ENTERPRISE', () => {
      expect(LicenseBo.isCommercialTier(LicenseTier.COMMERCIAL_ENTERPRISE)).toBe(true);
    });

    it('should return false for FREE', () => {
      expect(LicenseBo.isCommercialTier(LicenseTier.FREE)).toBe(false);
    });

    it('should return false for PRO', () => {
      expect(LicenseBo.isCommercialTier(LicenseTier.PRO)).toBe(false);
    });
  });

  describe('getTierOrder', () => {
    it('should return 0 for FREE', () => {
      expect(LicenseBo.getTierOrder(LicenseTier.FREE)).toBe(0);
    });

    it('should return 7 for COMMERCIAL_ENTERPRISE', () => {
      expect(LicenseBo.getTierOrder(LicenseTier.COMMERCIAL_ENTERPRISE)).toBe(7);
    });

    it('should maintain ascending order across tiers', () => {
      const free = LicenseBo.getTierOrder(LicenseTier.FREE);
      const supporter = LicenseBo.getTierOrder(LicenseTier.SUPPORTER);
      const pro = LicenseBo.getTierOrder(LicenseTier.PRO);
      const enterprise = LicenseBo.getTierOrder(LicenseTier.COMMERCIAL_ENTERPRISE);
      expect(free).toBeLessThan(supporter);
      expect(supporter).toBeLessThan(pro);
      expect(pro).toBeLessThan(enterprise);
    });
  });

  describe('isUpgrade', () => {
    it('should return true when upgrading from FREE to PRO', () => {
      expect(LicenseBo.isUpgrade(LicenseTier.FREE, LicenseTier.PRO)).toBe(true);
    });

    it('should return false when downgrading from PRO to FREE', () => {
      expect(LicenseBo.isUpgrade(LicenseTier.PRO, LicenseTier.FREE)).toBe(false);
    });

    it('should return false for same tier', () => {
      expect(LicenseBo.isUpgrade(LicenseTier.PLUS, LicenseTier.PLUS)).toBe(false);
    });
  });

  describe('getTierIcon', () => {
    it('should return gift icon for FREE', () => {
      expect(LicenseBo.getTierIcon(LicenseTier.FREE)).toBe('fa fa-gift');
    });

    it('should return crown icon for COMMERCIAL_ENTERPRISE', () => {
      expect(LicenseBo.getTierIcon(LicenseTier.COMMERCIAL_ENTERPRISE)).toBe('fa fa-crown');
    });

    it('should return building icon for COMMERCIAL_STARTER', () => {
      expect(LicenseBo.getTierIcon(LicenseTier.COMMERCIAL_STARTER)).toBe('fa fa-building');
    });

    it('should return default key icon for unknown tier', () => {
      expect(LicenseBo.getTierIcon('UNKNOWN' as LicenseTier)).toBe('fa fa-key');
    });
  });

  describe('formatLicenseKeyDisplay', () => {
    it('should return masked value when not revealed', () => {
      expect(LicenseBo.formatLicenseKeyDisplay('REAL-KEY-1234', false)).toBe('****-****-****-****');
    });

    it('should return actual key when revealed', () => {
      expect(LicenseBo.formatLicenseKeyDisplay('REAL-KEY-1234', true)).toBe('REAL-KEY-1234');
    });
  });

  describe('formatApiKeyDisplay', () => {
    it('should return masked value when not revealed', () => {
      expect(LicenseBo.formatApiKeyDisplay('my-secret-api-key', false)).toBe(
        '**********************'
      );
    });

    it('should return actual key when revealed', () => {
      expect(LicenseBo.formatApiKeyDisplay('my-secret-api-key', true)).toBe('my-secret-api-key');
    });
  });
});
