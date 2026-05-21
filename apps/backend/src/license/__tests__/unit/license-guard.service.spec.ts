import { ForbiddenException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { CloudAuthService } from '../../../cloud-auth/cloud-auth.service';
import { JobRepository } from '../../../common/repositories/job.repository';
import { NodeRepository } from '../../../common/repositories/node.repository';
import { LicenseGuardService } from '../../license-guard.service';

// LicenseTier removed from Prisma schema — use local string constants
const LicenseTier = {
  FREE: 'FREE',
  PATREON: 'PATREON',
  PATREON_SUPPORTER: 'PATREON_SUPPORTER',
  PATREON_PRO: 'PATREON_PRO',
  COMMERCIAL_ENTERPRISE: 'COMMERCIAL_ENTERPRISE',
} as const;

describe('LicenseGuardService', () => {
  let service: LicenseGuardService;

  const mockCloudAuth = {
    getStatus: jest.fn(),
  };
  const mockNodeRepo = {
    count: jest.fn(),
  };
  const mockJobRepo = {
    countWhere: jest.fn(),
  };

  // Convenience: set up cloud status + node/job counts in one call
  function setupMocks(
    status: {
      tier?: string | null;
      maxNodes?: number | null;
      maxConcurrentJobs?: number | null;
      gracePeriodExpired?: boolean;
    },
    nodeCount = 0,
    jobCount = 0
  ) {
    mockCloudAuth.getStatus.mockResolvedValue({
      tier: status.tier ?? null,
      maxNodes: status.maxNodes ?? null,
      maxConcurrentJobs: status.maxConcurrentJobs ?? null,
      gracePeriodExpired: status.gracePeriodExpired ?? false,
      gracePeriodExpiresAt: null,
    });
    mockNodeRepo.count.mockResolvedValue(nodeCount);
    mockJobRepo.countWhere.mockResolvedValue(jobCount);
  }

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LicenseGuardService,
        { provide: CloudAuthService, useValue: mockCloudAuth },
        { provide: NodeRepository, useValue: mockNodeRepo },
        { provide: JobRepository, useValue: mockJobRepo },
      ],
    }).compile();

    service = module.get<LicenseGuardService>(LicenseGuardService);
    jest.clearAllMocks();
  });

  describe('getCapabilities', () => {
    it('should return FREE tier defaults when no cloud auth status', async () => {
      setupMocks({ tier: null, maxNodes: null, maxConcurrentJobs: null });

      const result = await service.getCapabilities();

      expect(result.tier).toBe(LicenseTier.FREE);
      expect(result.maxNodes).toBe(1);
      expect(result.maxConcurrentJobs).toBe(2);
      expect(result.canAddNode).toBe(true);
      expect(result.canStartJob).toBe(true);
      expect(result.features.multiNode).toBe(false);
    });

    it('should return zero limits when grace period is expired', async () => {
      setupMocks({
        tier: LicenseTier.PATREON_PRO,
        maxNodes: 5,
        maxConcurrentJobs: 10,
        gracePeriodExpired: true,
      });

      const result = await service.getCapabilities();

      expect(result.maxNodes).toBe(0);
      expect(result.maxConcurrentJobs).toBe(0);
      expect(result.canAddNode).toBe(false);
      expect(result.canStartJob).toBe(false);
    });

    it('should return active license capabilities', async () => {
      setupMocks({ tier: LicenseTier.PATREON_PRO, maxNodes: 5, maxConcurrentJobs: 10 }, 3, 7);

      const result = await service.getCapabilities();

      expect(result.tier).toBe(LicenseTier.PATREON_PRO);
      expect(result.maxNodes).toBe(5);
      expect(result.currentNodes).toBe(3);
      expect(result.canAddNode).toBe(true);
      expect(result.canStartJob).toBe(true);
    });

    it('should set canAddNode=false when at node limit', async () => {
      setupMocks({ tier: null, maxNodes: null, maxConcurrentJobs: null }, 1, 0);

      const result = await service.getCapabilities();

      expect(result.canAddNode).toBe(false);
    });

    it('should set canStartJob=false when at job limit', async () => {
      setupMocks({ tier: null, maxNodes: null, maxConcurrentJobs: null }, 0, 2);

      const result = await service.getCapabilities();

      expect(result.canStartJob).toBe(false);
    });

    it('should handle active cloud auth with maxNodes set', async () => {
      setupMocks({ tier: LicenseTier.PATREON_SUPPORTER, maxNodes: 2, maxConcurrentJobs: 3 });

      const result = await service.getCapabilities();

      expect(result.tier).toBe(LicenseTier.PATREON_SUPPORTER);
      expect(result.maxNodes).toBe(2);
    });
  });

  describe('assertCanAddNode', () => {
    it('should not throw when under node limit', async () => {
      setupMocks({ tier: null, maxNodes: null, maxConcurrentJobs: null }, 0, 0);

      await expect(service.assertCanAddNode()).resolves.not.toThrow();
    });

    it('should throw ForbiddenException when at node limit', async () => {
      setupMocks({ tier: null, maxNodes: null, maxConcurrentJobs: null }, 1, 0);

      await expect(service.assertCanAddNode()).rejects.toThrow(ForbiddenException);
    });

    it('should include upgrade URL in error response', async () => {
      setupMocks({ tier: null, maxNodes: null, maxConcurrentJobs: null }, 1, 0);

      try {
        await service.assertCanAddNode();
        fail('Should have thrown');
      } catch (error: unknown) {
        expect(error).toBeInstanceOf(ForbiddenException);
        const response = (error as ForbiddenException).getResponse();
        expect(response).toHaveProperty('upgradeUrl');
        expect(response).toHaveProperty('error', 'NODE_LIMIT_REACHED');
      }
    });
  });

  describe('assertCanStartJob', () => {
    it('should not throw when under job limit', async () => {
      setupMocks({ tier: null, maxNodes: null, maxConcurrentJobs: null }, 0, 1);

      await expect(service.assertCanStartJob()).resolves.not.toThrow();
    });

    it('should throw ForbiddenException when at job limit', async () => {
      setupMocks({ tier: null, maxNodes: null, maxConcurrentJobs: null }, 0, 2);

      await expect(service.assertCanStartJob()).rejects.toThrow(ForbiddenException);
    });
  });

  describe('assertFeatureEnabled', () => {
    it('should not throw when feature is enabled', async () => {
      // 'PRO' tier satisfies isProOrHigher check in defaultFeatures
      setupMocks({ tier: 'COMMERCIAL_STARTER', maxNodes: 15, maxConcurrentJobs: 30 });

      await expect(service.assertFeatureEnabled('api')).resolves.not.toThrow();
    });

    it('should throw ForbiddenException when feature is disabled', async () => {
      setupMocks({ tier: null, maxNodes: null, maxConcurrentJobs: null });

      await expect(service.assertFeatureEnabled('api')).rejects.toThrow(ForbiddenException);
    });

    it('should include feature name in error message', async () => {
      setupMocks({ tier: null, maxNodes: null, maxConcurrentJobs: null });

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
      setupMocks({ tier: 'COMMERCIAL_STARTER', maxNodes: 15, maxConcurrentJobs: 30 });

      const result = await service.isFeatureEnabled('api');
      expect(result).toBe(true);
    });

    it('should return false for disabled feature', async () => {
      setupMocks({ tier: null, maxNodes: null, maxConcurrentJobs: null });

      const result = await service.isFeatureEnabled('cloudStorage');
      expect(result).toBe(false);
    });
  });

  describe('getUpgradeRecommendation', () => {
    it('should not recommend upgrade for COMMERCIAL_ENTERPRISE', async () => {
      setupMocks({
        tier: LicenseTier.COMMERCIAL_ENTERPRISE,
        maxNodes: 999,
        maxConcurrentJobs: 999,
      });

      const result = await service.getUpgradeRecommendation();
      expect(result.shouldUpgrade).toBe(false);
    });

    it('should recommend upgrade when node usage >= 80%', async () => {
      setupMocks({ tier: null, maxNodes: null, maxConcurrentJobs: null }, 1, 0);

      const result = await service.getUpgradeRecommendation();
      expect(result.shouldUpgrade).toBe(true);
      expect(result.reason).toContain('nodes');
    });

    it('should recommend upgrade when job usage >= 80%', async () => {
      setupMocks({ tier: null, maxNodes: null, maxConcurrentJobs: null }, 0, 2);

      const result = await service.getUpgradeRecommendation();
      expect(result.shouldUpgrade).toBe(true);
      expect(result.reason).toContain('concurrent jobs');
    });

    it('should not recommend upgrade when usage is low', async () => {
      setupMocks({ tier: LicenseTier.PATREON_PRO, maxNodes: 5, maxConcurrentJobs: 10 }, 1, 1);

      const result = await service.getUpgradeRecommendation();
      expect(result.shouldUpgrade).toBe(false);
    });
  });
});
