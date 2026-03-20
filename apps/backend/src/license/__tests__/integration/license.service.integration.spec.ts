import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { LicenseStatus, LicenseTier } from '@prisma/client';
import { LicenseRepository } from '../../../common/repositories/license.repository';
import { LicenseService } from '../../license.service';

describe('LicenseService Integration Tests', () => {
  let module: TestingModule;
  let service: LicenseService;

  const mockLicenseRepository = {
    findUnique: jest.fn(),
    createLicense: jest.fn(),
  };

  beforeEach(async () => {
    module = await Test.createTestingModule({
      providers: [LicenseService, { provide: LicenseRepository, useValue: mockLicenseRepository }],
    }).compile();

    service = module.get<LicenseService>(LicenseService);
    jest.clearAllMocks();
  });

  afterAll(async () => {
    await module.close();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('validateLicense', () => {
    it('should return license with canAddNode=true when below node limit', async () => {
      mockLicenseRepository.findUnique.mockResolvedValue({
        id: 'lic-1',
        tier: LicenseTier.FREE,
        status: LicenseStatus.ACTIVE,
        validUntil: null,
        maxNodes: 1,
        maxConcurrentJobs: 2,
        features: {
          multiNode: false,
          advancedPresets: false,
          api: false,
          priorityQueue: false,
          cloudStorage: false,
          webhooks: false,
        },
        email: 'test@example.com',
        createdAt: new Date('2025-01-01'),
        updatedAt: new Date('2025-01-01'),
        _count: { nodes: 0 },
      });

      const result = await service.validateLicense('FRE-abc123');

      expect(result.key).toBe('FRE-abc123');
      expect(result.tier).toBe(LicenseTier.FREE);
      expect(result.status).toBe(LicenseStatus.ACTIVE);
      expect(result.canAddNode).toBe(true);
      expect(result.activeNodes).toBe(0);
      expect(result.maxNodes).toBe(1);
      expect(result.maxConcurrentJobs).toBe(2);
    });

    it('should return canAddNode=false when at node limit', async () => {
      mockLicenseRepository.findUnique.mockResolvedValue({
        id: 'lic-2',
        tier: LicenseTier.FREE,
        status: LicenseStatus.ACTIVE,
        validUntil: null,
        maxNodes: 1,
        maxConcurrentJobs: 2,
        features: {},
        email: 'test@example.com',
        createdAt: new Date(),
        updatedAt: new Date(),
        _count: { nodes: 1 },
      });

      const result = await service.validateLicense('FRE-full');

      expect(result.canAddNode).toBe(false);
      expect(result.activeNodes).toBe(1);
    });

    it('should throw NotFoundException for unknown key', async () => {
      mockLicenseRepository.findUnique.mockResolvedValue(null);

      await expect(service.validateLicense('UNKNOWN-KEY')).rejects.toThrow(NotFoundException);
      await expect(service.validateLicense('UNKNOWN-KEY')).rejects.toThrow('License not found');
    });

    it('should throw BadRequestException for revoked license', async () => {
      mockLicenseRepository.findUnique.mockResolvedValue({
        id: 'lic-3',
        status: LicenseStatus.REVOKED,
        validUntil: null,
        maxNodes: 1,
        maxConcurrentJobs: 2,
        features: {},
        _count: { nodes: 0 },
      });

      await expect(service.validateLicense('REV-key')).rejects.toThrow(BadRequestException);
      await expect(service.validateLicense('REV-key')).rejects.toThrow('License is not active');
    });

    it('should throw BadRequestException for expired license', async () => {
      mockLicenseRepository.findUnique.mockResolvedValue({
        id: 'lic-4',
        status: LicenseStatus.ACTIVE,
        validUntil: new Date('2020-01-01'),
        maxNodes: 1,
        maxConcurrentJobs: 2,
        features: {},
        _count: { nodes: 0 },
      });

      await expect(service.validateLicense('EXP-key')).rejects.toThrow(BadRequestException);
      await expect(service.validateLicense('EXP-key')).rejects.toThrow('License has expired');
    });
  });

  describe('createLicense', () => {
    it('should create FREE tier license with maxNodes=1 and no premium features', async () => {
      const created = {
        id: 'lic-new',
        key: 'FRE-xyz',
        tier: LicenseTier.FREE,
        status: LicenseStatus.ACTIVE,
        email: 'a@b.com',
        maxNodes: 1,
        maxConcurrentJobs: 2,
        features: {},
        validUntil: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      mockLicenseRepository.createLicense.mockResolvedValue(created);

      const result = await service.createLicense({ tier: LicenseTier.FREE, email: 'a@b.com' });

      expect(result).toEqual(created);
      expect(mockLicenseRepository.createLicense).toHaveBeenCalledWith(
        expect.objectContaining({
          tier: LicenseTier.FREE,
          email: 'a@b.com',
          maxNodes: 1,
          maxConcurrentJobs: 2,
          status: LicenseStatus.ACTIVE,
          features: expect.objectContaining({ multiNode: false, cloudStorage: false }),
        })
      );
    });

    it('should create PATREON_PRO license with api and webhooks enabled', async () => {
      const created = {
        id: 'lic-pro',
        key: 'PAT-pro',
        tier: LicenseTier.PATREON_PRO,
        status: LicenseStatus.ACTIVE,
        email: 'pro@test.com',
        maxNodes: 5,
        maxConcurrentJobs: 10,
        features: {},
        validUntil: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      mockLicenseRepository.createLicense.mockResolvedValue(created);

      await service.createLicense({ tier: LicenseTier.PATREON_PRO, email: 'pro@test.com' });

      expect(mockLicenseRepository.createLicense).toHaveBeenCalledWith(
        expect.objectContaining({
          maxNodes: 5,
          maxConcurrentJobs: 10,
          features: expect.objectContaining({
            multiNode: true,
            api: true,
            priorityQueue: true,
            webhooks: true,
            cloudStorage: false,
          }),
        })
      );
    });

    it('should create COMMERCIAL_ENTERPRISE license with all features and maxNodes=999', async () => {
      const created = {
        id: 'lic-ent',
        key: 'COM-ent',
        tier: LicenseTier.COMMERCIAL_ENTERPRISE,
        status: LicenseStatus.ACTIVE,
        email: 'ent@corp.com',
        maxNodes: 999,
        maxConcurrentJobs: 999,
        features: {},
        validUntil: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      mockLicenseRepository.createLicense.mockResolvedValue(created);

      await service.createLicense({
        tier: LicenseTier.COMMERCIAL_ENTERPRISE,
        email: 'ent@corp.com',
      });

      expect(mockLicenseRepository.createLicense).toHaveBeenCalledWith(
        expect.objectContaining({
          maxNodes: 999,
          maxConcurrentJobs: 999,
          features: expect.objectContaining({ cloudStorage: true, api: true }),
        })
      );
    });

    it('should generate key with tier prefix matching first 3 chars uppercased', async () => {
      mockLicenseRepository.createLicense.mockResolvedValue({
        id: 'lic-1',
        key: 'FRE-test',
        tier: LicenseTier.FREE,
        status: LicenseStatus.ACTIVE,
        email: 'x@y.com',
        maxNodes: 1,
        maxConcurrentJobs: 2,
        features: {},
        validUntil: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await service.createLicense({ tier: LicenseTier.FREE, email: 'x@y.com' });

      const callArg = mockLicenseRepository.createLicense.mock.calls[0][0];
      expect(callArg.key).toMatch(/^FRE-[a-f0-9]{10}$/);
    });

    it('should set validUntil as Date when provided as string', async () => {
      mockLicenseRepository.createLicense.mockResolvedValue({
        id: 'lic-2',
        key: 'FRE-exp',
        tier: LicenseTier.FREE,
        status: LicenseStatus.ACTIVE,
        email: 'x@y.com',
        maxNodes: 1,
        maxConcurrentJobs: 2,
        features: {},
        validUntil: new Date('2027-01-01'),
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await service.createLicense({
        tier: LicenseTier.FREE,
        email: 'x@y.com',
        validUntil: '2027-01-01T00:00:00.000Z',
      });

      expect(mockLicenseRepository.createLicense).toHaveBeenCalledWith(
        expect.objectContaining({ validUntil: new Date('2027-01-01T00:00:00.000Z') })
      );
    });
  });

  describe('checkCanAddNode', () => {
    it('should return true when current nodes < maxNodes', async () => {
      mockLicenseRepository.findUnique.mockResolvedValue({ maxNodes: 5, _count: { nodes: 2 } });

      const result = await service.checkCanAddNode('lic-123');

      expect(result).toBe(true);
      expect(mockLicenseRepository.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'lic-123' } })
      );
    });

    it('should return false when current nodes === maxNodes', async () => {
      mockLicenseRepository.findUnique.mockResolvedValue({ maxNodes: 1, _count: { nodes: 1 } });

      expect(await service.checkCanAddNode('lic-full')).toBe(false);
    });

    it('should throw NotFoundException when license does not exist', async () => {
      mockLicenseRepository.findUnique.mockResolvedValue(null);

      await expect(service.checkCanAddNode('missing-id')).rejects.toThrow(NotFoundException);
      await expect(service.checkCanAddNode('missing-id')).rejects.toThrow('License not found');
    });
  });
});
