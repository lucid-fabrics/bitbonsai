import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { LicenseStatus, LicenseTier } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { LicenseService } from '../license.service';

describe('LicenseService', () => {
  let service: LicenseService;
  let prismaMock: any;

  beforeEach(async () => {
    prismaMock = {
      license: {
        findUnique: jest.fn(),
        create: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [LicenseService, { provide: PrismaService, useValue: prismaMock }],
    }).compile();

    service = module.get<LicenseService>(LicenseService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('validateLicense', () => {
    it('should return license details for valid active license', async () => {
      const mockLicense = {
        id: 'license-1',
        tier: LicenseTier.FREE,
        status: LicenseStatus.ACTIVE,
        validUntil: new Date(Date.now() + 86400000),
        maxNodes: 1,
        maxConcurrentJobs: 2,
        features: { multiNode: false, advancedPresets: false },
        email: 'test@example.com',
        createdAt: new Date(),
        updatedAt: new Date(),
        _count: { nodes: 0 },
      };

      prismaMock.license.findUnique.mockResolvedValue(mockLicense);

      const result = await service.validateLicense('FREE-abc123');

      expect(result.id).toBe('license-1');
      expect(result.tier).toBe(LicenseTier.FREE);
      expect(result.canAddNode).toBe(true);
      expect(result.activeNodes).toBe(0);
    });

    it('should throw NotFoundException when license not found', async () => {
      prismaMock.license.findUnique.mockResolvedValue(null);

      await expect(service.validateLicense('INVALID')).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException when license has expired', async () => {
      const mockLicense = {
        id: 'license-1',
        tier: LicenseTier.FREE,
        status: LicenseStatus.ACTIVE,
        validUntil: new Date(Date.now() - 86400000),
        maxNodes: 1,
        maxConcurrentJobs: 2,
        features: {},
        email: 'test@example.com',
        createdAt: new Date(),
        updatedAt: new Date(),
        _count: { nodes: 0 },
      };

      prismaMock.license.findUnique.mockResolvedValue(mockLicense);

      await expect(service.validateLicense('FREE-abc123')).rejects.toThrow(BadRequestException);
    });

    it('should indicate cannot add node when at limit', async () => {
      const mockLicense = {
        id: 'license-1',
        tier: LicenseTier.FREE,
        status: LicenseStatus.ACTIVE,
        validUntil: new Date(Date.now() + 86400000),
        maxNodes: 1,
        maxConcurrentJobs: 2,
        features: {},
        email: 'test@example.com',
        createdAt: new Date(),
        updatedAt: new Date(),
        _count: { nodes: 1 },
      };

      prismaMock.license.findUnique.mockResolvedValue(mockLicense);

      const result = await service.validateLicense('FREE-abc123');

      expect(result.canAddNode).toBe(false);
      expect(result.activeNodes).toBe(1);
    });
  });

  describe('createLicense', () => {
    it('should create a FREE tier license', async () => {
      const createData = {
        tier: LicenseTier.FREE,
        email: 'test@example.com',
      };

      const mockLicense = {
        id: 'license-1',
        key: 'FRE-',
        tier: LicenseTier.FREE,
        status: LicenseStatus.ACTIVE,
        email: 'test@example.com',
        maxNodes: 1,
        maxConcurrentJobs: 2,
        features: { multiNode: false, advancedPresets: false },
        validUntil: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      prismaMock.license.create.mockResolvedValue(mockLicense);

      const result = await service.createLicense(createData);

      expect(result).toBeDefined();
      expect(prismaMock.license.create).toHaveBeenCalled();
    });

    it('should create a PATREON tier license with correct config', async () => {
      const createData = {
        tier: LicenseTier.PATREON_PLUS,
        email: 'patreon@example.com',
      };

      const mockLicense = {
        id: 'license-1',
        key: 'PAT-',
        tier: LicenseTier.PATREON_PLUS,
        status: LicenseStatus.ACTIVE,
        email: 'patreon@example.com',
        maxNodes: 3,
        maxConcurrentJobs: 5,
        features: { multiNode: true, advancedPresets: true },
        validUntil: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      prismaMock.license.create.mockResolvedValue(mockLicense);

      const result = await service.createLicense(createData);

      expect(result.maxNodes).toBe(3);
      expect(result.maxConcurrentJobs).toBe(5);
    });

    it('should create a COMMERCIAL tier license with all features', async () => {
      const createData = {
        tier: LicenseTier.COMMERCIAL_PRO,
        email: 'business@example.com',
      };

      const mockLicense = {
        id: 'license-1',
        key: 'COM-',
        tier: LicenseTier.COMMERCIAL_PRO,
        status: LicenseStatus.ACTIVE,
        email: 'business@example.com',
        maxNodes: 50,
        maxConcurrentJobs: 100,
        features: {
          multiNode: true,
          advancedPresets: true,
          api: true,
          priorityQueue: true,
          cloudStorage: true,
          webhooks: true,
        },
        validUntil: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      prismaMock.license.create.mockResolvedValue(mockLicense);

      const result = await service.createLicense(createData);

      expect(result.maxNodes).toBe(50);
      expect(result.maxConcurrentJobs).toBe(100);
    });
  });

  describe('checkCanAddNode', () => {
    it('should return true when under node limit', async () => {
      const mockLicense = {
        maxNodes: 5,
        _count: { nodes: 2 },
      };

      prismaMock.license.findUnique.mockResolvedValue(mockLicense);

      const result = await service.checkCanAddNode('license-1');

      expect(result).toBe(true);
    });

    it('should return false when at node limit', async () => {
      const mockLicense = {
        maxNodes: 5,
        _count: { nodes: 5 },
      };

      prismaMock.license.findUnique.mockResolvedValue(mockLicense);

      const result = await service.checkCanAddNode('license-1');

      expect(result).toBe(false);
    });

    it('should throw NotFoundException when license does not exist', async () => {
      prismaMock.license.findUnique.mockResolvedValue(null);

      await expect(service.checkCanAddNode('invalid-id')).rejects.toThrow(NotFoundException);
    });
  });
});
