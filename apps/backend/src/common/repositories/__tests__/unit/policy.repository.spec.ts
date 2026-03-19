import { Test, type TestingModule } from '@nestjs/testing';
import { PolicyPreset, TargetCodec } from '@prisma/client';
import { PrismaService } from '../../../../prisma/prisma.service';
import type { AdvancedSettings, DeviceProfiles } from '../../policy.repository';
import { PolicyRepository } from '../../policy.repository';

const mockPolicy = {
  id: 'policy-1',
  name: 'Default HEVC',
  preset: PolicyPreset.BALANCED_HEVC,
  targetCodec: TargetCodec.HEVC,
  targetQuality: 28,
  deviceProfiles: { web: true, appleTv: false },
  advancedSettings: { ffmpegFlags: [] },
  atomicReplace: true,
  verifyOutput: true,
  skipSeeding: false,
  allowSameCodec: false,
  minSavingsPercent: 0,
  libraryId: null,
  createdAt: new Date('2025-01-01'),
  updatedAt: new Date('2025-01-01'),
};

const mockPrismaService = {
  policy: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    count: jest.fn(),
  },
};

describe('PolicyRepository', () => {
  let repository: PolicyRepository;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PolicyRepository,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
      ],
    }).compile();

    repository = module.get<PolicyRepository>(PolicyRepository);
  });

  it('should be defined', () => {
    expect(repository).toBeInstanceOf(PolicyRepository);
  });

  describe('findById', () => {
    it('should return a policy when found', async () => {
      mockPrismaService.policy.findUnique.mockResolvedValue(mockPolicy);

      const result = await repository.findById('policy-1');

      expect(result).toEqual(mockPolicy);
      expect(mockPrismaService.policy.findUnique).toHaveBeenCalledWith({
        where: { id: 'policy-1' },
      });
    });

    it('should return null when policy does not exist', async () => {
      mockPrismaService.policy.findUnique.mockResolvedValue(null);

      const result = await repository.findById('nonexistent-id');

      expect(result).toBeNull();
      expect(mockPrismaService.policy.findUnique).toHaveBeenCalledWith({
        where: { id: 'nonexistent-id' },
      });
    });
  });

  describe('findByIdWithRelations', () => {
    it('should call findUnique with library and _count include', async () => {
      const policyWithRelations = {
        ...mockPolicy,
        library: { id: 'lib-1', name: 'Movies' },
        _count: { jobs: 5 },
      };
      mockPrismaService.policy.findUnique.mockResolvedValue(policyWithRelations);

      const result = await repository.findByIdWithRelations('policy-1');

      expect(result).toEqual(policyWithRelations);
      expect(mockPrismaService.policy.findUnique).toHaveBeenCalledWith({
        where: { id: 'policy-1' },
        include: {
          library: { select: { id: true, name: true } },
          _count: { select: { jobs: true } },
        },
      });
    });

    it('should return null when policy with relations does not exist', async () => {
      mockPrismaService.policy.findUnique.mockResolvedValue(null);

      const result = await repository.findByIdWithRelations('ghost-id');

      expect(result).toBeNull();
    });
  });

  describe('findAll', () => {
    it('should return all policies ordered by createdAt desc', async () => {
      const policies = [mockPolicy, { ...mockPolicy, id: 'policy-2', name: 'AV1 Fast' }];
      mockPrismaService.policy.findMany.mockResolvedValue(policies);

      const result = await repository.findAll();

      expect(result).toEqual(policies);
      expect(result).toHaveLength(2);
      expect(mockPrismaService.policy.findMany).toHaveBeenCalledWith({
        orderBy: { createdAt: 'desc' },
      });
    });

    it('should return empty array when no policies exist', async () => {
      mockPrismaService.policy.findMany.mockResolvedValue([]);

      const result = await repository.findAll();

      expect(result).toEqual([]);
    });
  });

  describe('findByLibraryId', () => {
    it('should filter policies by libraryId', async () => {
      mockPrismaService.policy.findMany.mockResolvedValue([mockPolicy]);

      const result = await repository.findByLibraryId('lib-1');

      expect(result).toEqual([mockPolicy]);
      expect(mockPrismaService.policy.findMany).toHaveBeenCalledWith({
        where: { libraryId: 'lib-1' },
        orderBy: { createdAt: 'desc' },
      });
    });
  });

  describe('findGlobal', () => {
    it('should return policies with null libraryId', async () => {
      mockPrismaService.policy.findMany.mockResolvedValue([mockPolicy]);

      const result = await repository.findGlobal();

      expect(result).toEqual([mockPolicy]);
      expect(mockPrismaService.policy.findMany).toHaveBeenCalledWith({
        where: { libraryId: null },
        orderBy: { createdAt: 'desc' },
      });
    });
  });

  describe('create', () => {
    it('should call prisma.policy.create with correct mapped data and return the created policy', async () => {
      mockPrismaService.policy.create.mockResolvedValue(mockPolicy);

      const deviceProfiles: DeviceProfiles = { web: true, appleTv: false };
      const advancedSettings: AdvancedSettings = { ffmpegFlags: [] };

      const result = await repository.create({
        name: 'Default HEVC',
        preset: PolicyPreset.BALANCED_HEVC,
        targetCodec: TargetCodec.HEVC,
        targetQuality: 28,
        deviceProfiles,
        advancedSettings,
      });

      expect(result).toEqual(mockPolicy);
      expect(mockPrismaService.policy.create).toHaveBeenCalledWith({
        data: {
          name: 'Default HEVC',
          preset: PolicyPreset.BALANCED_HEVC,
          targetCodec: TargetCodec.HEVC,
          targetQuality: 28,
          deviceProfiles,
          advancedSettings,
          atomicReplace: true,
          verifyOutput: true,
          skipSeeding: false,
          allowSameCodec: false,
          minSavingsPercent: 0,
          libraryId: undefined,
        },
      });
    });

    it('should pass optional fields through when provided', async () => {
      mockPrismaService.policy.create.mockResolvedValue(mockPolicy);

      await repository.create({
        name: 'Custom',
        preset: PolicyPreset.QUALITY_AV1,
        targetCodec: TargetCodec.AV1,
        targetQuality: 24,
        deviceProfiles: {},
        advancedSettings: {},
        atomicReplace: false,
        skipSeeding: true,
        allowSameCodec: true,
        minSavingsPercent: 10,
        libraryId: 'lib-1',
      });

      expect(mockPrismaService.policy.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          atomicReplace: false,
          skipSeeding: true,
          allowSameCodec: true,
          minSavingsPercent: 10,
          libraryId: 'lib-1',
        }),
      });
    });
  });

  describe('update', () => {
    it('should call prisma.policy.update with where and partial data', async () => {
      const updated = { ...mockPolicy, name: 'Renamed Policy' };
      mockPrismaService.policy.update.mockResolvedValue(updated);

      const result = await repository.update('policy-1', { name: 'Renamed Policy' });

      expect(result).toEqual(updated);
      expect(mockPrismaService.policy.update).toHaveBeenCalledWith({
        where: { id: 'policy-1' },
        data: { name: 'Renamed Policy' },
      });
    });

    it('should propagate prisma errors on update', async () => {
      mockPrismaService.policy.update.mockRejectedValue(new Error('Record not found'));

      await expect(repository.update('ghost-id', { name: 'X' })).rejects.toThrow(
        'Record not found'
      );
    });
  });

  describe('delete', () => {
    it('should call prisma.policy.delete with correct id and return deleted policy', async () => {
      mockPrismaService.policy.delete.mockResolvedValue(mockPolicy);

      const result = await repository.delete('policy-1');

      expect(result).toEqual(mockPolicy);
      expect(mockPrismaService.policy.delete).toHaveBeenCalledWith({
        where: { id: 'policy-1' },
      });
    });

    it('should propagate prisma errors when policy does not exist', async () => {
      mockPrismaService.policy.delete.mockRejectedValue(new Error('Record to delete not found'));

      await expect(repository.delete('nonexistent-id')).rejects.toThrow(
        'Record to delete not found'
      );
    });
  });

  describe('count', () => {
    it('should return total policy count', async () => {
      mockPrismaService.policy.count.mockResolvedValue(7);

      const result = await repository.count();

      expect(result).toBe(7);
      expect(mockPrismaService.policy.count).toHaveBeenCalledWith();
    });
  });

  describe('countByLibrary', () => {
    it('should return policy count filtered by libraryId', async () => {
      mockPrismaService.policy.count.mockResolvedValue(3);

      const result = await repository.countByLibrary('lib-1');

      expect(result).toBe(3);
      expect(mockPrismaService.policy.count).toHaveBeenCalledWith({
        where: { libraryId: 'lib-1' },
      });
    });
  });
});
