import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { LicenseStatus, LicenseTier } from '@prisma/client';
import { LicenseRepository } from '../../../common/repositories/license.repository';
import type { CreateLicenseDto } from '../../dto/create-license.dto';
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
        _count: { nodes: 0 },
      };

      mockLicenseRepository.findUnique.mockResolvedValue(mockLicense);

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

      expect(mockLicenseRepository.findUnique).toHaveBeenCalledWith({
        where: { key: 'FRE-test123' },
        select: expect.any(Object),
      });
    });

    it('should throw NotFoundException when license does not exist', async () => {
      mockLicenseRepository.findUnique.mockResolvedValue(null);

      await expect(service.validateLicense('INVALID-KEY')).rejects.toThrow(NotFoundException);
      await expect(service.validateLicense('INVALID-KEY')).rejects.toThrow('License not found');
    });

    it('should throw BadRequestException when license status is not ACTIVE', async () => {
      const mockLicense = {
        id: 'license-123',
        status: LicenseStatus.REVOKED,
        validUntil: null,
        maxNodes: 1,
        maxConcurrentJobs: 2,
        features: {},
        _count: { nodes: 0 },
      };

      mockLicenseRepository.findUnique.mockResolvedValue(mockLicense);

      await expect(service.validateLicense('REV-test123')).rejects.toThrow(BadRequestException);
      await expect(service.validateLicense('REV-test123')).rejects.toThrow('License is not active');
    });

    it('should throw BadRequestException when license has expired', async () => {
      const mockLicense = {
        id: 'license-123',
        status: LicenseStatus.ACTIVE,
        validUntil: new Date('2024-01-01'), // past date
        maxNodes: 1,
        maxConcurrentJobs: 2,
        features: {},
        _count: { nodes: 0 },
      };

      mockLicenseRepository.findUnique.mockResolvedValue(mockLicense);

      await expect(service.validateLicense('EXP-test123')).rejects.toThrow(BadRequestException);
      await expect(service.validateLicense('EXP-test123')).rejects.toThrow('License has expired');
    });

    it('should not throw when validUntil is in the future', async () => {
      const mockLicense = {
        id: 'license-123',
        tier: LicenseTier.FREE,
        status: LicenseStatus.ACTIVE,
        validUntil: new Date(Date.now() + 86400000 * 30), // 30 days from now
        maxNodes: 1,
        maxConcurrentJobs: 2,
        features: {},
        email: 'test@example.com',
        createdAt: new Date(),
        updatedAt: new Date(),
        _count: { nodes: 0 },
      };

      mockLicenseRepository.findUnique.mockResolvedValue(mockLicense);

      const result = await service.validateLicense('FRE-future');
      expect(result.canAddNode).toBe(true);
    });

    it('should set canAddNode to false when active nodes equals maxNodes', async () => {
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
        _count: { nodes: 1 },
      };

      mockLicenseRepository.findUnique.mockResolvedValue(mockLicense);

      const result = await service.validateLicense('FRE-test123');

      expect(result.canAddNode).toBe(false);
      expect(result.activeNodes).toBe(1);
    });

    it('should set canAddNode to true when active nodes is below maxNodes', async () => {
      const mockLicense = {
        id: 'license-123',
        tier: LicenseTier.PATREON,
        status: LicenseStatus.ACTIVE,
        validUntil: null,
        maxNodes: 2,
        maxConcurrentJobs: 3,
        features: {},
        email: 'test@example.com',
        createdAt: new Date(),
        updatedAt: new Date(),
        _count: { nodes: 1 },
      };

      mockLicenseRepository.findUnique.mockResolvedValue(mockLicense);

      const result = await service.validateLicense('PAT-test123');

      expect(result.canAddNode).toBe(true);
      expect(result.activeNodes).toBe(1);
    });
  });

  describe('createLicense', () => {
    it('should create a FREE tier license with correct node/job limits and features', async () => {
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

      mockLicenseRepository.createLicense.mockResolvedValue(mockCreatedLicense);

      const result = await service.createLicense(createDto);

      expect(result).toEqual(mockCreatedLicense);
      expect(mockLicenseRepository.createLicense).toHaveBeenCalledWith(
        expect.objectContaining({
          tier: LicenseTier.FREE,
          email: 'free@example.com',
          maxNodes: 1,
          maxConcurrentJobs: 2,
          status: LicenseStatus.ACTIVE,
        })
      );
    });

    it('should create a PATREON tier license with multiNode and advancedPresets features', async () => {
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
        maxConcurrentJobs: 3,
        features: {
          multiNode: true,
          advancedPresets: true,
          api: false,
          priorityQueue: false,
          cloudStorage: false,
          webhooks: false,
        },
        validUntil: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockLicenseRepository.createLicense.mockResolvedValue(mockCreatedLicense);

      const result = await service.createLicense(createDto);

      expect(result.features).toEqual(
        expect.objectContaining({
          multiNode: true,
          advancedPresets: true,
        })
      );
      expect(result.maxNodes).toBe(2);
    });

    it('should create a COMMERCIAL_PRO license with all features enabled', async () => {
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
        validUntil: new Date('2026-12-31T23:59:59.999Z'),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockLicenseRepository.createLicense.mockResolvedValue(mockCreatedLicense);

      const result = await service.createLicense(createDto);

      expect(result.features).toEqual(
        expect.objectContaining({
          priorityQueue: true,
          cloudStorage: true,
          webhooks: true,
        })
      );
      expect(result.maxNodes).toBe(50);
      expect(result.maxConcurrentJobs).toBe(100);
    });

    it('should generate a license key with tier prefix', async () => {
      const createDto: CreateLicenseDto = {
        tier: LicenseTier.FREE,
        email: 'test@example.com',
      };

      mockLicenseRepository.createLicense.mockResolvedValue({
        id: 'license-1',
        key: 'FRE-generatedkey',
        tier: LicenseTier.FREE,
        status: LicenseStatus.ACTIVE,
        email: 'test@example.com',
        maxNodes: 1,
        maxConcurrentJobs: 2,
        features: {},
        validUntil: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await service.createLicense(createDto);

      expect(mockLicenseRepository.createLicense).toHaveBeenCalledWith(
        expect.objectContaining({
          key: expect.stringMatching(/^FRE-/),
        })
      );
    });

    it('should set validUntil to null when not provided', async () => {
      const createDto: CreateLicenseDto = {
        tier: LicenseTier.FREE,
        email: 'test@example.com',
      };

      mockLicenseRepository.createLicense.mockResolvedValue({
        id: 'license-1',
        key: 'FRE-abc',
        tier: LicenseTier.FREE,
        status: LicenseStatus.ACTIVE,
        email: 'test@example.com',
        maxNodes: 1,
        maxConcurrentJobs: 2,
        features: {},
        validUntil: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await service.createLicense(createDto);

      expect(mockLicenseRepository.createLicense).toHaveBeenCalledWith(
        expect.objectContaining({
          validUntil: null,
        })
      );
    });

    it('should convert validUntil string to Date when provided', async () => {
      const createDto: CreateLicenseDto = {
        tier: LicenseTier.FREE,
        email: 'test@example.com',
        validUntil: '2026-06-30T00:00:00.000Z',
      };

      mockLicenseRepository.createLicense.mockResolvedValue({
        id: 'license-1',
        key: 'FRE-abc',
        tier: LicenseTier.FREE,
        status: LicenseStatus.ACTIVE,
        email: 'test@example.com',
        maxNodes: 1,
        maxConcurrentJobs: 2,
        features: {},
        validUntil: new Date('2026-06-30T00:00:00.000Z'),
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await service.createLicense(createDto);

      expect(mockLicenseRepository.createLicense).toHaveBeenCalledWith(
        expect.objectContaining({
          validUntil: new Date('2026-06-30T00:00:00.000Z'),
        })
      );
    });
  });

  describe('checkCanAddNode', () => {
    it('should return true when node count is below maxNodes', async () => {
      mockLicenseRepository.findUnique.mockResolvedValue({
        maxNodes: 5,
        _count: { nodes: 3 },
      });

      const result = await service.checkCanAddNode('license-123');

      expect(result).toBe(true);
    });

    it('should return false when node count equals maxNodes', async () => {
      mockLicenseRepository.findUnique.mockResolvedValue({
        maxNodes: 1,
        _count: { nodes: 1 },
      });

      const result = await service.checkCanAddNode('license-123');

      expect(result).toBe(false);
    });

    it('should return false when node count exceeds maxNodes', async () => {
      mockLicenseRepository.findUnique.mockResolvedValue({
        maxNodes: 2,
        _count: { nodes: 3 },
      });

      const result = await service.checkCanAddNode('license-123');

      expect(result).toBe(false);
    });

    it('should throw NotFoundException when license does not exist', async () => {
      mockLicenseRepository.findUnique.mockResolvedValue(null);

      await expect(service.checkCanAddNode('invalid-id')).rejects.toThrow(NotFoundException);
      await expect(service.checkCanAddNode('invalid-id')).rejects.toThrow('License not found');
    });

    it('should call findUnique with correct licenseId', async () => {
      mockLicenseRepository.findUnique.mockResolvedValue({
        maxNodes: 5,
        _count: { nodes: 0 },
      });

      await service.checkCanAddNode('license-abc');

      expect(mockLicenseRepository.findUnique).toHaveBeenCalledWith({
        where: { id: 'license-abc' },
        select: expect.any(Object),
      });
    });
  });
});
