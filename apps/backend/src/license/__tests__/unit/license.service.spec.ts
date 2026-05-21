import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { LicenseRepository } from '../../../common/repositories/license.repository';
import { LicenseService } from '../../license.service';

describe('LicenseService', () => {
  let service: LicenseService;

  const mockLicenseRepository = {
    findUnique: jest.fn(),
    createLicense: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LicenseService,
        {
          provide: LicenseRepository,
          useValue: mockLicenseRepository,
        },
      ],
    }).compile();

    service = module.get<LicenseService>(LicenseService);

    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('validateLicense', () => {
    it('should always throw NotFoundException (validation no longer supported)', async () => {
      await expect(service.validateLicense('ANY-KEY')).rejects.toThrow(NotFoundException);
      await expect(service.validateLicense('ANY-KEY')).rejects.toThrow(
        'License validation is no longer supported'
      );
    });
  });

  describe('createLicense', () => {
    it('should always throw BadRequestException (creation no longer supported)', async () => {
      await expect(
        service.createLicense({ tier: 'FREE', email: 'test@example.com' } as never)
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.createLicense({ tier: 'FREE', email: 'test@example.com' } as never)
      ).rejects.toThrow('License creation is no longer supported');
    });
  });

  describe('checkCanAddNode', () => {
    it('should always return true (guard handled via LicenseGuardService + Settings)', async () => {
      const result = await service.checkCanAddNode('license-123');
      expect(result).toBe(true);
    });

    it('should return true regardless of licenseId', async () => {
      expect(await service.checkCanAddNode('any-id')).toBe(true);
      expect(await service.checkCanAddNode('another-id')).toBe(true);
      expect(mockLicenseRepository.findUnique).not.toHaveBeenCalled();
    });
  });
});
