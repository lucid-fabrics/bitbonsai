import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { LicenseStatus, LicenseTier } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateLicenseDto } from './dto/create-license.dto';
import { LicenseService } from './license.service';

describe('LicenseService', () => {
  let service: LicenseService;
  let prisma: PrismaService;

  const mockPrismaService = {
    license: {
      findUnique: jest.fn(),
      create: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LicenseService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
      ],
    }).compile();

    service = module.get<LicenseService>(LicenseService);
    prisma = module.get<PrismaService>(PrismaService);

    jest.clearAllMocks();
  });

  describe('validateLicense', () => {
    it('should return valid license details when license is active and not expired', async () => {
      const mockLicense = {
        id: 'license-123',
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
        _count: {
          nodes: 0,
        },
      };

      mockPrismaService.license.findUnique.mockResolvedValue(mockLicense);

      const result = await service.validateLicense('FRE-test123');

      expect(result).toEqual({
        id: 'license-123',
        key: 'FRE-test123',
        tier: LicenseTier.FREE,
        status: LicenseStatus.ACTIVE,
        validUntil: null,
        maxNodes: 1,
        maxConcurrentJobs: 2,
        features: mockLicense.features,
        email: 'test@example.com',
        createdAt: mockLicense.createdAt,
        updatedAt: mockLicense.updatedAt,
        canAddNode: true,
        activeNodes: 0,
      });

      expect(mockPrismaService.license.findUnique).toHaveBeenCalledWith({
        where: { key: 'FRE-test123' },
        select: expect.any(Object),
      });
    });

    it('should throw NotFoundException when license does not exist', async () => {
      mockPrismaService.license.findUnique.mockResolvedValue(null);

      await expect(service.validateLicense('INVALID-KEY')).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException when license is not active', async () => {
      const mockLicense = {
        id: 'license-123',
        status: LicenseStatus.REVOKED,
        validUntil: null,
        maxNodes: 1,
        maxConcurrentJobs: 2,
        features: {},
        _count: { nodes: 0 },
      };

      mockPrismaService.license.findUnique.mockResolvedValue(mockLicense);

      await expect(service.validateLicense('REV-test123')).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when license has expired', async () => {
      const expiredDate = new Date('2024-01-01');
      const mockLicense = {
        id: 'license-123',
        status: LicenseStatus.ACTIVE,
        validUntil: expiredDate,
        maxNodes: 1,
        maxConcurrentJobs: 2,
        features: {},
        _count: { nodes: 0 },
      };

      mockPrismaService.license.findUnique.mockResolvedValue(mockLicense);

      await expect(service.validateLicense('EXP-test123')).rejects.toThrow(BadRequestException);
    });

    it('should set canAddNode to false when max nodes reached', async () => {
      const mockLicense = {
        id: 'license-123',
        tier: LicenseTier.FREE,
        status: LicenseStatus.ACTIVE,
        validUntil: null,
        maxNodes: 1,
        maxConcurrentJobs: 2,
        features: {},
        email: 'test@example.com',
        createdAt: new Date(),
        updatedAt: new Date(),
        _count: {
          nodes: 1,
        },
      };

      mockPrismaService.license.findUnique.mockResolvedValue(mockLicense);

      const result = await service.validateLicense('FRE-test123');

      expect(result.canAddNode).toBe(false);
      expect(result.activeNodes).toBe(1);
    });
  });

  describe('createLicense', () => {
    it('should create a FREE tier license with correct configuration', async () => {
      const createDto: CreateLicenseDto = {
        tier: LicenseTier.FREE,
        email: 'free@example.com',
      };

      const mockCreatedLicense = {
        id: 'license-456',
        key: 'FRE-abcd1234',
        tier: LicenseTier.FREE,
        status: LicenseStatus.ACTIVE,
        email: 'free@example.com',
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
        validUntil: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPrismaService.license.create.mockResolvedValue(mockCreatedLicense);

      const result = await service.createLicense(createDto);

      expect(result).toEqual(mockCreatedLicense);
      expect(mockPrismaService.license.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tier: LicenseTier.FREE,
          email: 'free@example.com',
          maxNodes: 1,
          maxConcurrentJobs: 2,
          status: LicenseStatus.ACTIVE,
        }),
      });
    });

    it('should create a PATREON tier license with advanced features', async () => {
      const createDto: CreateLicenseDto = {
        tier: LicenseTier.PATREON,
        email: 'patreon@example.com',
      };

      const mockCreatedLicense = {
        id: 'license-789',
        key: 'PAT-xyz9876',
        tier: LicenseTier.PATREON,
        status: LicenseStatus.ACTIVE,
        email: 'patreon@example.com',
        maxNodes: 2,
        maxConcurrentJobs: 5,
        features: {
          multiNode: true,
          advancedPresets: true,
          api: true,
          priorityQueue: false,
          cloudStorage: false,
          webhooks: false,
        },
        validUntil: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPrismaService.license.create.mockResolvedValue(mockCreatedLicense);

      const result = await service.createLicense(createDto);

      expect(result.features).toEqual(
        expect.objectContaining({
          multiNode: true,
          advancedPresets: true,
          api: true,
        })
      );
      expect(result.maxNodes).toBe(2);
      expect(result.maxConcurrentJobs).toBe(5);
    });

    it('should create a COMMERCIAL_PRO license with all features', async () => {
      const createDto: CreateLicenseDto = {
        tier: LicenseTier.COMMERCIAL_PRO,
        email: 'enterprise@example.com',
        validUntil: '2026-12-31T23:59:59.999Z',
      };

      const mockCreatedLicense = {
        id: 'license-999',
        key: 'COM-pro12345',
        tier: LicenseTier.COMMERCIAL_PRO,
        status: LicenseStatus.ACTIVE,
        email: 'enterprise@example.com',
        maxNodes: 20,
        maxConcurrentJobs: 50,
        features: {
          multiNode: true,
          advancedPresets: true,
          api: true,
          priorityQueue: true,
          cloudStorage: true,
          webhooks: true,
        },
        validUntil: new Date('2026-12-31T23:59:59.999Z'),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPrismaService.license.create.mockResolvedValue(mockCreatedLicense);

      const result = await service.createLicense(createDto);

      expect(result.features).toEqual(
        expect.objectContaining({
          priorityQueue: true,
          cloudStorage: true,
          webhooks: true,
        })
      );
      expect(result.maxNodes).toBe(20);
    });
  });

  describe('checkCanAddNode', () => {
    it('should return true when node count is below max', async () => {
      const mockLicense = {
        maxNodes: 5,
        _count: {
          nodes: 3,
        },
      };

      mockPrismaService.license.findUnique.mockResolvedValue(mockLicense);

      const result = await service.checkCanAddNode('license-123');

      expect(result).toBe(true);
    });

    it('should return false when node count equals max', async () => {
      const mockLicense = {
        maxNodes: 1,
        _count: {
          nodes: 1,
        },
      };

      mockPrismaService.license.findUnique.mockResolvedValue(mockLicense);

      const result = await service.checkCanAddNode('license-123');

      expect(result).toBe(false);
    });

    it('should throw NotFoundException when license does not exist', async () => {
      mockPrismaService.license.findUnique.mockResolvedValue(null);

      await expect(service.checkCanAddNode('invalid-id')).rejects.toThrow(NotFoundException);
    });
  });
});
