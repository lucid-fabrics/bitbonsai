import { Test, type TestingModule } from '@nestjs/testing';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { LicenseTier } from '@prisma/client';
import { LicenseGuardService } from '../../../license/license-guard.service';
import { LicensesController } from '../../licenses.controller';
import { LicensesService } from '../../licenses.service';

describe('LicensesController', () => {
  let controller: LicensesController;

  const mockCapabilities = {
    tier: LicenseTier.FREE,
    currentNodes: 1,
    maxNodes: 1,
    maxConcurrentJobs: 2,
    features: {
      multiNode: false,
      advancedPresets: false,
      api: false,
      priorityQueue: false,
      webhooks: false,
      cloudStorage: false,
    },
  };

  const mockLicenseGuardService = {
    getCapabilities: jest.fn(),
    getUpgradeRecommendation: jest.fn(),
  };

  const mockLicensesService = {
    activateLicense: jest.fn(),
    lookupLicenseByEmail: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      imports: [ThrottlerModule.forRoot([{ ttl: 60000, limit: 100 }])],
      controllers: [LicensesController],
      providers: [
        { provide: LicenseGuardService, useValue: mockLicenseGuardService },
        { provide: LicensesService, useValue: mockLicensesService },
      ],
    })
      .overrideGuard(ThrottlerGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<LicensesController>(LicensesController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getCurrentLicense', () => {
    it('should return LicenseDto built from capabilities for FREE tier', async () => {
      mockLicenseGuardService.getCapabilities.mockResolvedValue(mockCapabilities);

      const result = await controller.getCurrentLicense();

      expect(mockLicenseGuardService.getCapabilities).toHaveBeenCalledTimes(1);
      expect(result).toEqual({
        tier: LicenseTier.FREE,
        licenseKey: 'FREE-TIER',
        email: null,
        validUntil: 'Lifetime',
        maxNodes: 1,
        usedNodes: 1,
        maxConcurrentJobs: 2,
        features: [
          { name: 'Single Node', enabled: true },
          { name: 'Multi-Node', enabled: false },
          { name: 'Advanced Presets', enabled: false },
          { name: 'API Access', enabled: false },
          { name: 'Priority Queue', enabled: false },
          { name: 'Webhooks', enabled: false },
          { name: 'Cloud Storage', enabled: false },
        ],
      });
    });

    it('should return licenseKey as "ACTIVATED" for non-FREE tiers', async () => {
      const proCapabilities = {
        ...mockCapabilities,
        tier: LicenseTier.PATREON_PRO,
        features: {
          multiNode: true,
          advancedPresets: true,
          api: true,
          priorityQueue: true,
          webhooks: true,
          cloudStorage: false,
        },
      };
      mockLicenseGuardService.getCapabilities.mockResolvedValue(proCapabilities);

      const result = await controller.getCurrentLicense();

      expect(result.licenseKey).toBe('ACTIVATED');
      expect(result.tier).toBe(LicenseTier.PATREON_PRO);
    });

    it('should propagate service errors', async () => {
      mockLicenseGuardService.getCapabilities.mockRejectedValue(new Error('caps error'));
      await expect(controller.getCurrentLicense()).rejects.toThrow('caps error');
    });
  });

  describe('getCapabilities', () => {
    it('should merge capabilities and upgrade recommendation', async () => {
      const upgradeRec = { shouldUpgrade: false, reason: null };
      mockLicenseGuardService.getCapabilities.mockResolvedValue(mockCapabilities);
      mockLicenseGuardService.getUpgradeRecommendation.mockResolvedValue(upgradeRec);

      const result = await controller.getCapabilities();

      expect(mockLicenseGuardService.getCapabilities).toHaveBeenCalledTimes(1);
      expect(mockLicenseGuardService.getUpgradeRecommendation).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ ...mockCapabilities, ...upgradeRec });
    });

    it('should propagate capabilities errors', async () => {
      mockLicenseGuardService.getCapabilities.mockRejectedValue(new Error('service error'));
      await expect(controller.getCapabilities()).rejects.toThrow('service error');
    });

    it('should propagate upgrade recommendation errors', async () => {
      mockLicenseGuardService.getCapabilities.mockResolvedValue(mockCapabilities);
      mockLicenseGuardService.getUpgradeRecommendation.mockRejectedValue(
        new Error('upgrade error')
      );
      await expect(controller.getCapabilities()).rejects.toThrow('upgrade error');
    });
  });

  describe('getAvailableTiers', () => {
    it('should return all 8 license tiers', async () => {
      const result = await controller.getAvailableTiers();

      expect(result.tiers).toHaveLength(8);
    });

    it('should include FREE tier with correct values', async () => {
      const result = await controller.getAvailableTiers();

      const freeTier = result.tiers.find((t) => t.id === LicenseTier.FREE);
      expect(freeTier).toBeDefined();
      expect(freeTier?.price).toBe(0);
      expect(freeTier?.maxNodes).toBe(1);
      expect(freeTier?.maxConcurrentJobs).toBe(2);
    });

    it('should include COMMERCIAL_ENTERPRISE tier', async () => {
      const result = await controller.getAvailableTiers();

      const enterprise = result.tiers.find((t) => t.id === LicenseTier.COMMERCIAL_ENTERPRISE);
      expect(enterprise).toBeDefined();
      expect(enterprise?.maxNodes).toBe(999);
    });
  });

  describe('activateLicense', () => {
    it('should call licensesService.activateLicense and return masked LicenseDto', async () => {
      const activateDto = { licenseKey: 'BITBONSAI-PRO-ABCDEFGHIJKLMNO-1234' } as never;
      const activationResult = {
        tier: LicenseTier.PATREON_PRO,
        email: 'user@example.com',
        expiresAt: null,
        maxNodes: 5,
        maxConcurrentJobs: 10,
      };
      mockLicensesService.activateLicense.mockResolvedValue(activationResult);
      mockLicenseGuardService.getCapabilities.mockResolvedValue(mockCapabilities);

      const result = await controller.activateLicense(activateDto);

      expect(mockLicensesService.activateLicense).toHaveBeenCalledWith(activateDto);
      expect(mockLicenseGuardService.getCapabilities).toHaveBeenCalledTimes(1);
      expect(result.tier).toBe(LicenseTier.PATREON_PRO);
      expect(result.email).toBe('user@example.com');
      expect(result.validUntil).toBe('Lifetime');
      expect(result.maxNodes).toBe(5);
      expect(result.usedNodes).toBe(1);
      expect(result.maxConcurrentJobs).toBe(10);
      // Key should be masked (not the raw key)
      expect(result.licenseKey).not.toBe('BITBONSAI-PRO-ABCDEFGHIJKLMNO-1234');
    });

    it('should set validUntil to ISO date string when expiresAt is set', async () => {
      const expiresAt = new Date('2027-01-01T00:00:00.000Z');
      const activateDto = { licenseKey: 'BITBONSAI-PRO-ABCDEFGHIJKLMNO-1234' } as never;
      const activationResult = {
        tier: LicenseTier.PATREON_PRO,
        email: null,
        expiresAt,
        maxNodes: 5,
        maxConcurrentJobs: 10,
      };
      mockLicensesService.activateLicense.mockResolvedValue(activationResult);
      mockLicenseGuardService.getCapabilities.mockResolvedValue(mockCapabilities);

      const result = await controller.activateLicense(activateDto);

      expect(result.validUntil).toBe(expiresAt.toISOString());
    });

    it('should propagate service errors', async () => {
      mockLicensesService.activateLicense.mockRejectedValue(new Error('invalid key'));
      await expect(controller.activateLicense({ licenseKey: 'bad' } as never)).rejects.toThrow(
        'invalid key'
      );
    });
  });

  describe('lookupLicense', () => {
    it('should call licensesService.lookupLicenseByEmail with email from dto', async () => {
      const dto = { email: 'user@example.com' } as never;
      const lookupResult = { found: true, license: { tier: 'PATREON_PRO', maskedKey: '****' } };
      mockLicensesService.lookupLicenseByEmail.mockResolvedValue(lookupResult);

      const result = await controller.lookupLicense(dto);

      expect(mockLicensesService.lookupLicenseByEmail).toHaveBeenCalledWith('user@example.com');
      expect(result).toEqual(lookupResult);
    });

    it('should return found: false when no license associated with email', async () => {
      mockLicensesService.lookupLicenseByEmail.mockResolvedValue({ found: false });

      const result = await controller.lookupLicense({ email: 'unknown@example.com' } as never);

      expect(result).toEqual({ found: false });
    });

    it('should propagate service errors', async () => {
      mockLicensesService.lookupLicenseByEmail.mockRejectedValue(new Error('lookup error'));
      await expect(controller.lookupLicense({ email: 'x@y.com' } as never)).rejects.toThrow(
        'lookup error'
      );
    });
  });
});
