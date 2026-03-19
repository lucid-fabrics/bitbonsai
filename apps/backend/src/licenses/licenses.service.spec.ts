import { HttpService } from '@nestjs/axios';
import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { of, throwError } from 'rxjs';
import { LicenseRepository } from '../common/repositories/license.repository';
import { LicensesService } from './licenses.service';

describe('LicensesService', () => {
  let service: LicensesService;
  let mockLicenseRepository: jest.Mocked<LicenseRepository>;
  let mockHttpService: any;
  let mockConfigService: jest.Mocked<ConfigService>;

  beforeEach(async () => {
    mockLicenseRepository = {
      upsertByEmail: jest.fn().mockResolvedValue(undefined),
    } as any;

    mockHttpService = {
      post: jest.fn(),
    };

    mockConfigService = {
      get: jest.fn().mockReturnValue('https://api.bitbonsai.app'),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LicensesService,
        { provide: LicenseRepository, useValue: mockLicenseRepository },
        { provide: HttpService, useValue: mockHttpService },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<LicensesService>(LicensesService);
  });

  describe('activateLicense', () => {
    const validDto = { email: 'user@example.com', licenseKey: 'VALID-KEY-1234' };

    it('should activate license when verification succeeds', async () => {
      const verifyResponse = {
        valid: true,
        license: {
          email: 'user@example.com',
          tier: 'PATREON_SUPPORTER',
          maxNodes: 3,
          maxConcurrentJobs: 2,
          expiresAt: null,
        },
      };
      mockHttpService.post.mockReturnValue(of({ data: verifyResponse }));

      const result = await service.activateLicense(validDto);

      expect(result.email).toBe('user@example.com');
      expect(result.maxNodes).toBe(3);
      expect(result.maxConcurrentJobs).toBe(2);
      expect(mockLicenseRepository.upsertByEmail).toHaveBeenCalled();
    });

    it('should throw BadRequestException when license is invalid', async () => {
      mockHttpService.post.mockReturnValue(
        of({ data: { valid: false, error: 'License not found' } })
      );

      await expect(service.activateLicense(validDto)).rejects.toThrow(BadRequestException);
    });

    it('should throw ServiceUnavailableException on connection refused', async () => {
      mockHttpService.post.mockReturnValue(throwError(() => ({ code: 'ECONNREFUSED' })));

      await expect(service.activateLicense(validDto)).rejects.toThrow(ServiceUnavailableException);
    });

    it('should throw ServiceUnavailableException on timeout', async () => {
      mockHttpService.post.mockReturnValue(throwError(() => ({ code: 'ECONNABORTED' })));

      await expect(service.activateLicense(validDto)).rejects.toThrow(ServiceUnavailableException);
    });

    it('should correctly map expiresAt date when provided', async () => {
      const expiresAt = '2027-01-01T00:00:00.000Z';
      mockHttpService.post.mockReturnValue(
        of({
          data: {
            valid: true,
            license: {
              email: 'user@example.com',
              tier: 'FREE',
              maxNodes: 1,
              maxConcurrentJobs: 1,
              expiresAt,
            },
          },
        })
      );

      const result = await service.activateLicense(validDto);
      expect(result.expiresAt).toEqual(new Date(expiresAt));
    });
  });

  describe('lookupLicenseByEmail', () => {
    it('should return lookup response when email found', async () => {
      const lookupResponse = {
        found: true,
        license: {
          tier: 'PATREON_SUPPORTER',
          maxNodes: 3,
          maxConcurrentJobs: 2,
          maskedKey: 'XXXX-XXXX-1234',
          expiresAt: null,
        },
      };
      mockHttpService.post.mockReturnValue(of({ data: lookupResponse }));

      const result = await service.lookupLicenseByEmail('user@example.com');
      expect(result.found).toBe(true);
      expect(result.license?.maskedKey).toBe('XXXX-XXXX-1234');
    });

    it('should throw ServiceUnavailableException when service unreachable', async () => {
      mockHttpService.post.mockReturnValue(throwError(() => ({ code: 'ENOTFOUND' })));

      await expect(service.lookupLicenseByEmail('user@example.com')).rejects.toThrow(
        ServiceUnavailableException
      );
    });
  });
});
