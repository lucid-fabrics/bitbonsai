import { HttpService } from '@nestjs/axios';
import {
  BadRequestException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { LicenseStatus } from '@prisma/client';
import { of, throwError } from 'rxjs';
import { PrismaService } from '../../../prisma/prisma.service';
import { LicenseClientService } from '../../license-client.service';

// Mock tier-config and tier-mapping
jest.mock('../../tier-config', () => ({
  getTierFeatures: jest.fn().mockReturnValue({
    multiNode: true,
    advancedPresets: true,
    api: false,
    priorityQueue: false,
    cloudStorage: false,
    webhooks: false,
  }),
  TIER_LIMITS: {
    FREE: { maxNodes: 1, maxConcurrentJobs: 2 },
    PATREON_SUPPORTER: { maxNodes: 2, maxConcurrentJobs: 3 },
    PATREON_PLUS: { maxNodes: 3, maxConcurrentJobs: 5 },
    PATREON_PRO: { maxNodes: 5, maxConcurrentJobs: 10 },
  },
}));

jest.mock('../../tier-mapping', () => ({
  mapExternalTier: jest.fn().mockReturnValue('PATREON_SUPPORTER'),
}));

describe('LicenseClientService', () => {
  let service: LicenseClientService;

  const mockHttpService = {
    post: jest.fn(),
    get: jest.fn(),
  };

  const mockConfigService = {
    get: jest.fn(),
  };

  const mockPrismaService = {
    license: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  beforeEach(async () => {
    mockConfigService.get.mockImplementation((key: string) => {
      if (key === 'LICENSE_API_URL') return 'https://api.test.com';
      if (key === 'LICENSE_CACHE_TTL_HOURS') return 24;
      return undefined;
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LicenseClientService,
        { provide: HttpService, useValue: mockHttpService },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: PrismaService, useValue: mockPrismaService },
      ],
    }).compile();

    service = module.get<LicenseClientService>(LicenseClientService);
    jest.clearAllMocks();
  });

  describe('getLicenseKey', () => {
    it('should return license key from database', async () => {
      mockPrismaService.license.findFirst.mockResolvedValue({ key: 'BB-TEST-1234' });

      const result = await service.getLicenseKey();
      expect(result).toBe('BB-TEST-1234');
    });

    it('should return null when no license exists', async () => {
      mockPrismaService.license.findFirst.mockResolvedValue(null);

      const result = await service.getLicenseKey();
      expect(result).toBeNull();
    });
  });

  describe('setLicenseKey', () => {
    it('should update existing license', async () => {
      mockPrismaService.license.findUnique.mockResolvedValue({ key: 'BB-TEST-1234' });
      mockPrismaService.license.update.mockResolvedValue({});

      await service.setLicenseKey('BB-TEST-1234');

      expect(mockPrismaService.license.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { key: 'BB-TEST-1234' },
        })
      );
    });

    it('should throw when license does not exist', async () => {
      mockPrismaService.license.findUnique.mockResolvedValue(null);

      await expect(service.setLicenseKey('BB-NEW-KEY')).rejects.toThrow(
        'License must be validated via API before use'
      );
    });
  });

  describe('verifyLicense', () => {
    it('should return FREE license when no key configured', async () => {
      mockPrismaService.license.findFirst.mockResolvedValue(null);

      const result = await service.verifyLicense();

      expect(result.tier).toBe('FREE');
      expect(result.maxNodes).toBe(1);
      expect(result.maxConcurrentJobs).toBe(2);
    });

    it('should call API and cache result on first verification', async () => {
      mockPrismaService.license.findFirst.mockResolvedValue({ key: 'BB-TEST-1234' });
      mockHttpService.post.mockReturnValue(
        of({
          data: {
            key: 'BB-TEST-1234',
            email: 'test@test.com',
            tier: 'SUPPORTER',
            status: 'ACTIVE',
            maxNodes: 2,
            maxConcurrentJobs: 3,
            expiresAt: null,
          },
        })
      );

      const result = await service.verifyLicense();

      expect(result.tier).toBe('SUPPORTER');
      expect(result.key).not.toBe('BB-TEST-1234'); // Should be masked
      expect(result.key).toContain('****');
    });

    it('should return cached license within TTL', async () => {
      // First call - populate cache
      mockPrismaService.license.findFirst.mockResolvedValue({ key: 'BB-TEST-1234' });
      mockHttpService.post.mockReturnValue(
        of({
          data: {
            key: 'BB-TEST-1234',
            email: 'test@test.com',
            tier: 'SUPPORTER',
            status: 'ACTIVE',
            maxNodes: 2,
            maxConcurrentJobs: 3,
            expiresAt: null,
          },
        })
      );

      await service.verifyLicense();
      jest.clearAllMocks();

      // Second call - should use cache
      const result = await service.verifyLicense();

      expect(mockHttpService.post).not.toHaveBeenCalled();
      expect(result.tier).toBe('SUPPORTER');
    });

    it('should fall back to cached license when API fails', async () => {
      // First call - populate cache
      mockPrismaService.license.findFirst.mockResolvedValue({ key: 'BB-TEST-1234' });
      mockHttpService.post.mockReturnValue(
        of({
          data: {
            key: 'BB-TEST-1234',
            email: 'test@test.com',
            tier: 'SUPPORTER',
            status: 'ACTIVE',
            maxNodes: 2,
            maxConcurrentJobs: 3,
            expiresAt: null,
          },
        })
      );
      await service.verifyLicense();

      // Expire cache by setting lastVerification far in the past
      (service as any).lastVerification = new Date('2020-01-01');

      // Second call - API fails
      mockHttpService.post.mockReturnValue(throwError(() => new Error('Network error')));

      const result = await service.verifyLicense();
      expect(result.tier).toBe('SUPPORTER');
    });

    it('should fall back to local DB when API fails and no cache', async () => {
      mockPrismaService.license.findFirst
        .mockResolvedValueOnce({ key: 'BB-DB-KEY' }) // getLicenseKey
        .mockResolvedValueOnce({
          key: 'BB-DB-KEY',
          email: 'db@test.com',
          tier: 'PATREON_SUPPORTER',
          status: LicenseStatus.ACTIVE,
          maxNodes: 2,
          maxConcurrentJobs: 3,
          validUntil: null,
        });
      mockHttpService.post.mockReturnValue(throwError(() => new Error('Network error')));

      const result = await service.verifyLicense();

      expect(result.email).toBe('db@test.com');
      expect(result.key).toContain('****');
    });

    it('should throw UnauthorizedException when all fallbacks fail', async () => {
      mockPrismaService.license.findFirst
        .mockResolvedValueOnce({ key: 'BB-TEST' }) // getLicenseKey
        .mockResolvedValueOnce(null); // local DB fallback
      mockHttpService.post.mockReturnValue(throwError(() => new Error('Network error')));

      await expect(service.verifyLicense()).rejects.toThrow(UnauthorizedException);
    });

    it('should throw when API returns empty response', async () => {
      mockPrismaService.license.findFirst
        .mockResolvedValueOnce({ key: 'BB-TEST' })
        .mockResolvedValueOnce(null);
      mockHttpService.post.mockReturnValue(of({ data: null }));

      await expect(service.verifyLicense()).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('getCurrentLimits', () => {
    it('should return limits from verified license', async () => {
      mockPrismaService.license.findFirst.mockResolvedValue(null);

      const result = await service.getCurrentLimits();

      expect(result).toEqual({ maxNodes: 1, maxConcurrentJobs: 2 });
    });
  });

  describe('activateLicense', () => {
    it('should activate valid license and store in DB', async () => {
      mockHttpService.post.mockReturnValue(
        of({
          data: {
            valid: true,
            license: {
              tier: 'SUPPORTER',
              email: 'user@test.com',
              expiresAt: null,
            },
          },
        })
      );

      mockPrismaService.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => {
        const tx = {
          license: {
            findFirst: jest.fn().mockResolvedValue(null),
            create: jest.fn().mockResolvedValue({
              key: 'BB-ACTIVATE-KEY',
              email: 'user@test.com',
              tier: 'PATREON_SUPPORTER',
              status: LicenseStatus.ACTIVE,
              maxNodes: 2,
              maxConcurrentJobs: 3,
              validUntil: null,
            }),
            update: jest.fn(),
          },
        };
        return fn(tx);
      });

      const result = await service.activateLicense('BB-ACTIVATE-KEY', 'user@test.com');

      expect(result.email).toBe('user@test.com');
      expect(result.key).toContain('****');
    });

    it('should throw BadRequestException for invalid license key', async () => {
      mockHttpService.post.mockReturnValue(
        of({
          data: {
            valid: false,
            error: 'Invalid license key',
          },
        })
      );

      await expect(service.activateLicense('BAD-KEY')).rejects.toThrow(BadRequestException);
    });

    it('should throw ServiceUnavailableException on network error', async () => {
      const networkError = new Error('connect ECONNREFUSED') as Error & { code: string };
      networkError.code = 'ECONNREFUSED';
      mockHttpService.post.mockReturnValue(throwError(() => networkError));

      await expect(service.activateLicense('BB-KEY')).rejects.toThrow(ServiceUnavailableException);
    });

    it('should re-throw BadRequestException from validation', async () => {
      mockHttpService.post.mockReturnValue(
        throwError(() => new BadRequestException('Already activated'))
      );

      await expect(service.activateLicense('BB-KEY')).rejects.toThrow(BadRequestException);
    });
  });

  describe('lookupLicenseByEmail', () => {
    it('should return license when found', async () => {
      mockHttpService.post.mockReturnValue(
        of({
          data: {
            found: true,
            license: {
              tier: 'SUPPORTER',
              maxNodes: 2,
              maxConcurrentJobs: 3,
              maskedKey: '****1234',
              expiresAt: null,
            },
          },
        })
      );

      const result = await service.lookupLicenseByEmail('user@test.com');

      expect(result.found).toBe(true);
      expect(result.license).toBeDefined();
    });

    it('should return not found when email has no license', async () => {
      mockHttpService.post.mockReturnValue(of({ data: { found: false } }));

      const result = await service.lookupLicenseByEmail('nobody@test.com');

      expect(result.found).toBe(false);
    });

    it('should return not found on API error (graceful degradation)', async () => {
      mockHttpService.post.mockReturnValue(throwError(() => new Error('API error')));

      const result = await service.lookupLicenseByEmail('user@test.com');

      expect(result.found).toBe(false);
    });
  });
});
