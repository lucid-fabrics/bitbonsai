import { Test, type TestingModule } from '@nestjs/testing';
import { JobStage, PolicyPreset, TargetCodec } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { PolicyRepository } from '../../repositories/policy.repository';

const mockPolicy = {
  id: 'policy-1',
  name: 'Default HEVC',
  preset: PolicyPreset.BALANCED_HEVC,
  targetCodec: TargetCodec.HEVC,
  targetQuality: 28,
  deviceProfiles: { web: true },
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
  },
};

describe('PolicyRepository (policies module)', () => {
  let repository: PolicyRepository;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [PolicyRepository, { provide: PrismaService, useValue: mockPrismaService }],
    }).compile();

    repository = module.get<PolicyRepository>(PolicyRepository);
  });

  it('should be defined', () => {
    expect(repository).toBeInstanceOf(PolicyRepository);
  });

  describe('create', () => {
    it('should create a policy with all fields', async () => {
      mockPrismaService.policy.create.mockResolvedValue(mockPolicy);

      const result = await repository.create({
        name: 'Default HEVC',
        preset: PolicyPreset.BALANCED_HEVC,
        targetCodec: TargetCodec.HEVC,
        targetQuality: 28,
        deviceProfiles: { web: true },
        advancedSettings: { ffmpegFlags: [] },
        atomicReplace: true,
        verifyOutput: true,
        skipSeeding: false,
        allowSameCodec: false,
        minSavingsPercent: 0,
        libraryId: null,
      });

      expect(result).toEqual(mockPolicy);
      expect(mockPrismaService.policy.create).toHaveBeenCalledWith({
        data: {
          name: 'Default HEVC',
          preset: PolicyPreset.BALANCED_HEVC,
          targetCodec: TargetCodec.HEVC,
          targetQuality: 28,
          deviceProfiles: { web: true },
          advancedSettings: { ffmpegFlags: [] },
          atomicReplace: true,
          verifyOutput: true,
          skipSeeding: false,
          allowSameCodec: false,
          minSavingsPercent: 0,
          libraryId: null,
        },
      });
    });

    it('should cast preset and targetCodec as enums', async () => {
      mockPrismaService.policy.create.mockResolvedValue(mockPolicy);

      await repository.create({
        name: 'AV1',
        preset: 'QUALITY_AV1' as PolicyPreset,
        targetCodec: 'AV1' as TargetCodec,
        targetQuality: 24,
        deviceProfiles: {},
        advancedSettings: {},
        atomicReplace: false,
        verifyOutput: false,
        skipSeeding: true,
        allowSameCodec: true,
        minSavingsPercent: 10,
      });

      expect(mockPrismaService.policy.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            preset: 'QUALITY_AV1',
            targetCodec: 'AV1',
          }),
        })
      );
    });

    it('should propagate errors', async () => {
      mockPrismaService.policy.create.mockRejectedValue(new Error('DB error'));

      await expect(
        repository.create({
          name: 'Fail',
          preset: PolicyPreset.BALANCED_HEVC,
          targetCodec: TargetCodec.HEVC,
          targetQuality: 28,
          deviceProfiles: {},
          advancedSettings: {},
          atomicReplace: true,
          verifyOutput: true,
          skipSeeding: false,
          allowSameCodec: false,
          minSavingsPercent: 0,
        })
      ).rejects.toThrow('DB error');
    });
  });

  describe('findAll', () => {
    it('should return all policies ordered by createdAt desc', async () => {
      const policies = [mockPolicy, { ...mockPolicy, id: 'policy-2' }];
      mockPrismaService.policy.findMany.mockResolvedValue(policies);

      const result = await repository.findAll();

      expect(result).toEqual(policies);
      expect(mockPrismaService.policy.findMany).toHaveBeenCalledWith({
        orderBy: { createdAt: 'desc' },
      });
    });

    it('should return empty array when no policies', async () => {
      mockPrismaService.policy.findMany.mockResolvedValue([]);

      const result = await repository.findAll();

      expect(result).toEqual([]);
    });
  });

  describe('findById', () => {
    it('should return policy when found', async () => {
      mockPrismaService.policy.findUnique.mockResolvedValue(mockPolicy);

      const result = await repository.findById('policy-1');

      expect(result).toEqual(mockPolicy);
      expect(mockPrismaService.policy.findUnique).toHaveBeenCalledWith({
        where: { id: 'policy-1' },
      });
    });

    it('should return null when not found', async () => {
      mockPrismaService.policy.findUnique.mockResolvedValue(null);

      const result = await repository.findById('ghost');

      expect(result).toBeNull();
    });
  });

  describe('findByIdWithStats', () => {
    it('should return policy with library and job count', async () => {
      const withStats = {
        ...mockPolicy,
        library: { id: 'lib-1', name: 'Movies' },
        _count: { jobs: 3 },
      };
      mockPrismaService.policy.findUnique.mockResolvedValue(withStats);

      const result = await repository.findByIdWithStats('policy-1');

      expect(result).toEqual(withStats);
      expect(mockPrismaService.policy.findUnique).toHaveBeenCalledWith({
        where: { id: 'policy-1' },
        include: {
          library: { select: { id: true, name: true } },
          _count: {
            select: {
              jobs: { where: { stage: JobStage.COMPLETED } },
            },
          },
        },
      });
    });

    it('should return null when policy not found', async () => {
      mockPrismaService.policy.findUnique.mockResolvedValue(null);

      const result = await repository.findByIdWithStats('ghost');

      expect(result).toBeNull();
    });
  });

  describe('update', () => {
    it('should update a policy with partial data', async () => {
      const updated = { ...mockPolicy, name: 'Renamed' };
      mockPrismaService.policy.update.mockResolvedValue(updated);

      const result = await repository.update('policy-1', { name: 'Renamed' });

      expect(result).toEqual(updated);
      expect(mockPrismaService.policy.update).toHaveBeenCalledWith({
        where: { id: 'policy-1' },
        data: expect.objectContaining({ name: 'Renamed' }),
      });
    });

    it('should propagate errors when policy not found', async () => {
      mockPrismaService.policy.update.mockRejectedValue(new Error('Record not found'));

      await expect(repository.update('ghost', { name: 'X' })).rejects.toThrow('Record not found');
    });
  });

  describe('delete', () => {
    it('should delete the policy and return void', async () => {
      mockPrismaService.policy.delete.mockResolvedValue(mockPolicy);

      const result = await repository.delete('policy-1');

      expect(result).toBeUndefined();
      expect(mockPrismaService.policy.delete).toHaveBeenCalledWith({
        where: { id: 'policy-1' },
      });
    });

    it('should propagate errors when policy not found', async () => {
      mockPrismaService.policy.delete.mockRejectedValue(new Error('Record to delete not found'));

      await expect(repository.delete('ghost')).rejects.toThrow('Record to delete not found');
    });
  });
});
