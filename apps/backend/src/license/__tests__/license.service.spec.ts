import { Test, TestingModule } from '@nestjs/testing';
import { LicenseRepository } from '../../common/repositories/license.repository';
import { LicenseService } from '../license.service';

// LicenseTier removed from Prisma — use local string constants
const LicenseTier = {
  FREE: 'FREE',
} as const;

describe('LicenseService', () => {
  let service: LicenseService;

  beforeEach(async () => {
    const licenseRepo = {
      findUnique: jest.fn(),
      createLicense: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [LicenseService, { provide: LicenseRepository, useValue: licenseRepo }],
    }).compile();

    service = module.get<LicenseService>(LicenseService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('validateLicense', () => {
    it('should always throw NotFoundException (no longer supported)', async () => {
      await expect(service.validateLicense('ANY-KEY')).rejects.toThrow(
        'License validation is no longer supported'
      );
    });
  });

  describe('createLicense', () => {
    it('should always throw BadRequestException (no longer supported)', async () => {
      await expect(
        service.createLicense({ tier: LicenseTier.FREE, email: 'test@example.com' } as never)
      ).rejects.toThrow('License creation is no longer supported');
    });
  });

  describe('checkCanAddNode', () => {
    it('should always return true (guard handled via LicenseGuardService)', async () => {
      const result = await service.checkCanAddNode('any-id');
      expect(result).toBe(true);
    });
  });
});
