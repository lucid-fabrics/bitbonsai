import { ForbiddenException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { LicenseTier } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { LicenseGuardService } from '../../license-guard.service';

describe('LicenseGuardService', () => {
  let service: LicenseGuardService;

  const mockPrismaService = {
    license: {
      findFirst: jest.fn(),
    },
    node: {
      count: jest.fn(),
    },
    job: {
      count: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LicenseGuardService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
      ],
    }).compile();

    service = module.get<LicenseGuardService>(LicenseGuardService);
    jest.clearAllMocks();
  });

  describe('getCapabilities', () => {
    it('should return FREE tier defaults when no license exists', async () => {
      mockPrismaService.license.findFirst.mockResolvedValue(null);
      mockPrismaService.node.count.mockResolvedValue(0);
      mockPrismaService.job.count.mockResolvedValue(0);

      const result = await service.getCapabilities();

      expect(result.tier).toBe(LicenseTier.FREE);
      expect(result.maxNodes).toBe(1);
      expect(result.maxConcurrentJobs).toBe(2);
      expect(result.canAddNode).toBe(true);
      expect(result.canStartJob).toBe(true);
      expect(result.features.multiNode).toBe(false);
    });

    it('should return FREE tier when license is expired', async () => {
      mockPrismaService.license.findFirst.mockResolvedValue({
        tier: LicenseTier.PATREON_PRO,
        maxNodes: 5,
        maxConcurrentJobs: 10,
        features: { multiNode: true },
        validUntil: new Date('2020-01-01'),
      });
      mockPrismaService.node.count.mockResolvedValue(0);
      mockPrismaService.job.count.mockResolvedValue(0);

      const result = await service.getCapabilities();

      expect(result.tier).toBe(LicenseTier.FREE);
      expect(result.maxNodes).toBe(1);
    });

    it('should return active license capabilities', async () => {
      const features = {
        multiNode: true,
        advancedPresets: true,
        api: true,
        priorityQueue: true,
        cloudStorage: false,
        webhooks: true,
      };
      mockPrismaService.license.findFirst.mockResolvedValue({
        tier: LicenseTier.PATREON_PRO,
        maxNodes: 5,
        maxConcurrentJobs: 10,
        features,
        validUntil: new Date('2099-01-01'),
      });
      mockPrismaService.node.count.mockResolvedValue(3);
      mockPrismaService.job.count.mockResolvedValue(7);

      const result = await service.getCapabilities();

      expect(result.tier).toBe(LicenseTier.PATREON_PRO);
      expect(result.maxNodes).toBe(5);
      expect(result.currentNodes).toBe(3);
      expect(result.canAddNode).toBe(true);
      expect(result.canStartJob).toBe(true);
    });

    it('should set canAddNode=false when at node limit', async () => {
      mockPrismaService.license.findFirst.mockResolvedValue(null);
      mockPrismaService.node.count.mockResolvedValue(1);
      mockPrismaService.job.count.mockResolvedValue(0);

      const result = await service.getCapabilities();

      expect(result.canAddNode).toBe(false);
    });

    it('should set canStartJob=false when at job limit', async () => {
      mockPrismaService.license.findFirst.mockResolvedValue(null);
      mockPrismaService.node.count.mockResolvedValue(0);
      mockPrismaService.job.count.mockResolvedValue(2);

      const result = await service.getCapabilities();

      expect(result.canStartJob).toBe(false);
    });

    it('should handle license with null validUntil (no expiration)', async () => {
      mockPrismaService.license.findFirst.mockResolvedValue({
        tier: LicenseTier.PATREON_SUPPORTER,
        maxNodes: 2,
        maxConcurrentJobs: 3,
        features: { multiNode: true },
        validUntil: null,
      });
      mockPrismaService.node.count.mockResolvedValue(0);
      mockPrismaService.job.count.mockResolvedValue(0);

      const result = await service.getCapabilities();

      expect(result.tier).toBe(LicenseTier.PATREON_SUPPORTER);
      expect(result.maxNodes).toBe(2);
    });
  });

  describe('assertCanAddNode', () => {
    it('should not throw when under node limit', async () => {
      mockPrismaService.license.findFirst.mockResolvedValue(null);
      mockPrismaService.node.count.mockResolvedValue(0);
      mockPrismaService.job.count.mockResolvedValue(0);

      await expect(service.assertCanAddNode()).resolves.not.toThrow();
    });

    it('should throw ForbiddenException when at node limit', async () => {
      mockPrismaService.license.findFirst.mockResolvedValue(null);
      mockPrismaService.node.count.mockResolvedValue(1);
      mockPrismaService.job.count.mockResolvedValue(0);

      await expect(service.assertCanAddNode()).rejects.toThrow(ForbiddenException);
    });

    it('should include upgrade URL in error response', async () => {
      mockPrismaService.license.findFirst.mockResolvedValue(null);
      mockPrismaService.node.count.mockResolvedValue(1);
      mockPrismaService.job.count.mockResolvedValue(0);

      try {
        await service.assertCanAddNode();
        fail('Should have thrown');
      } catch (error: unknown) {
        expect(error).toBeInstanceOf(ForbiddenException);
        const response = (error as ForbiddenException).getResponse();
        expect(response).toHaveProperty('upgradeUrl', '/settings?tab=license');
        expect(response).toHaveProperty('error', 'NODE_LIMIT_REACHED');
      }
    });
  });

  describe('assertCanStartJob', () => {
    it('should not throw when under job limit', async () => {
      mockPrismaService.license.findFirst.mockResolvedValue(null);
      mockPrismaService.node.count.mockResolvedValue(0);
      mockPrismaService.job.count.mockResolvedValue(1);

      await expect(service.assertCanStartJob()).resolves.not.toThrow();
    });

    it('should throw ForbiddenException when at job limit', async () => {
      mockPrismaService.license.findFirst.mockResolvedValue(null);
      mockPrismaService.node.count.mockResolvedValue(0);
      mockPrismaService.job.count.mockResolvedValue(2);

      await expect(service.assertCanStartJob()).rejects.toThrow(ForbiddenException);
    });
  });

  describe('assertFeatureEnabled', () => {
    it('should not throw when feature is enabled', async () => {
      mockPrismaService.license.findFirst.mockResolvedValue({
        tier: LicenseTier.PATREON_PRO,
        maxNodes: 5,
        maxConcurrentJobs: 10,
        features: { multiNode: true, api: true },
        validUntil: null,
      });
      mockPrismaService.node.count.mockResolvedValue(0);
      mockPrismaService.job.count.mockResolvedValue(0);

      await expect(service.assertFeatureEnabled('api')).resolves.not.toThrow();
    });

    it('should throw ForbiddenException when feature is disabled', async () => {
      mockPrismaService.license.findFirst.mockResolvedValue(null);
      mockPrismaService.node.count.mockResolvedValue(0);
      mockPrismaService.job.count.mockResolvedValue(0);

      await expect(service.assertFeatureEnabled('api')).rejects.toThrow(ForbiddenException);
    });

    it('should include feature name in error message', async () => {
      mockPrismaService.license.findFirst.mockResolvedValue(null);
      mockPrismaService.node.count.mockResolvedValue(0);
      mockPrismaService.job.count.mockResolvedValue(0);

      try {
        await service.assertFeatureEnabled('cloudStorage');
        fail('Should have thrown');
      } catch (error: unknown) {
        const response = (error as ForbiddenException).getResponse();
        expect(response).toHaveProperty('feature', 'cloudStorage');
        expect((response as Record<string, string>).message).toContain('Cloud Storage');
      }
    });
  });

  describe('isFeatureEnabled', () => {
    it('should return true for enabled feature', async () => {
      mockPrismaService.license.findFirst.mockResolvedValue({
        tier: LicenseTier.PATREON_PRO,
        maxNodes: 5,
        maxConcurrentJobs: 10,
        features: { multiNode: true, webhooks: true },
        validUntil: null,
      });
      mockPrismaService.node.count.mockResolvedValue(0);
      mockPrismaService.job.count.mockResolvedValue(0);

      const result = await service.isFeatureEnabled('webhooks');
      expect(result).toBe(true);
    });

    it('should return false for disabled feature', async () => {
      mockPrismaService.license.findFirst.mockResolvedValue(null);
      mockPrismaService.node.count.mockResolvedValue(0);
      mockPrismaService.job.count.mockResolvedValue(0);

      const result = await service.isFeatureEnabled('cloudStorage');
      expect(result).toBe(false);
    });
  });

  describe('getUpgradeRecommendation', () => {
    it('should not recommend upgrade for COMMERCIAL_ENTERPRISE', async () => {
      mockPrismaService.license.findFirst.mockResolvedValue({
        tier: LicenseTier.COMMERCIAL_ENTERPRISE,
        maxNodes: 999,
        maxConcurrentJobs: 999,
        features: {},
        validUntil: null,
      });
      mockPrismaService.node.count.mockResolvedValue(0);
      mockPrismaService.job.count.mockResolvedValue(0);

      const result = await service.getUpgradeRecommendation();
      expect(result.shouldUpgrade).toBe(false);
    });

    it('should recommend upgrade when node usage >= 80%', async () => {
      mockPrismaService.license.findFirst.mockResolvedValue(null);
      mockPrismaService.node.count.mockResolvedValue(1); // 1/1 = 100%
      mockPrismaService.job.count.mockResolvedValue(0);

      const result = await service.getUpgradeRecommendation();
      expect(result.shouldUpgrade).toBe(true);
      expect(result.recommendedTier).toBe(LicenseTier.PATREON_SUPPORTER);
      expect(result.reason).toContain('nodes');
    });

    it('should recommend upgrade when job usage >= 80%', async () => {
      mockPrismaService.license.findFirst.mockResolvedValue(null);
      mockPrismaService.node.count.mockResolvedValue(0);
      mockPrismaService.job.count.mockResolvedValue(2); // 2/2 = 100%

      const result = await service.getUpgradeRecommendation();
      expect(result.shouldUpgrade).toBe(true);
      expect(result.reason).toContain('concurrent jobs');
    });

    it('should not recommend upgrade when usage is low', async () => {
      mockPrismaService.license.findFirst.mockResolvedValue({
        tier: LicenseTier.PATREON_PRO,
        maxNodes: 5,
        maxConcurrentJobs: 10,
        features: {},
        validUntil: null,
      });
      mockPrismaService.node.count.mockResolvedValue(1); // 1/5 = 20%
      mockPrismaService.job.count.mockResolvedValue(1); // 1/10 = 10%

      const result = await service.getUpgradeRecommendation();
      expect(result.shouldUpgrade).toBe(false);
    });
  });
});
