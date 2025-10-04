import { NotFoundException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { PolicyPreset, TargetCodec } from './dto/create-policy.dto';
import { PoliciesService } from './policies.service';

describe('PoliciesService', () => {
  let service: PoliciesService;
  let _prisma: PrismaService;

  const mockPrismaService = {
    policy: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PoliciesService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
      ],
    }).compile();

    service = module.get<PoliciesService>(PoliciesService);
    _prisma = module.get<PrismaService>(PrismaService);

    // Clear all mocks before each test
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('should create a balanced HEVC policy with default settings', async () => {
      const createDto = {
        name: 'Standard HEVC',
        preset: PolicyPreset.BALANCED_HEVC,
        targetCodec: TargetCodec.HEVC,
        targetQuality: 23,
      };

      const mockCreatedPolicy = {
        id: 'policy123',
        ...createDto,
        deviceProfiles: {
          appleTv: true,
          roku: true,
          web: true,
          chromecast: true,
          ps5: true,
          xbox: true,
        },
        advancedSettings: {
          ffmpegFlags: ['-preset', 'medium'],
          hwaccel: 'auto',
          audioCodec: 'copy',
          subtitleHandling: 'copy',
        },
        atomicReplace: true,
        verifyOutput: true,
        skipSeeding: true,
        libraryId: null,
        createdAt: new Date('2025-10-01T12:00:00Z'),
        updatedAt: new Date('2025-10-01T12:00:00Z'),
      };

      mockPrismaService.policy.create.mockResolvedValue(mockCreatedPolicy);

      const result = await service.create(createDto);

      expect(result).toEqual({
        id: 'policy123',
        name: 'Standard HEVC',
        preset: PolicyPreset.BALANCED_HEVC,
        targetCodec: TargetCodec.HEVC,
        targetQuality: 23,
        deviceProfiles: expect.objectContaining({ appleTv: true }),
        advancedSettings: expect.objectContaining({ hwaccel: 'auto' }),
        atomicReplace: true,
        verifyOutput: true,
        skipSeeding: true,
        libraryId: null,
        createdAt: '2025-10-01T12:00:00.000Z',
        updatedAt: '2025-10-01T12:00:00.000Z',
      });

      expect(mockPrismaService.policy.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          name: 'Standard HEVC',
          preset: PolicyPreset.BALANCED_HEVC,
          targetQuality: 23,
        }),
      });
    });

    it('should create a quality AV1 policy for archival content', async () => {
      const createDto = {
        name: 'Archival Quality AV1',
        preset: PolicyPreset.QUALITY_AV1,
        targetCodec: TargetCodec.AV1,
        targetQuality: 20,
        libraryId: 'lib456',
      };

      const mockCreatedPolicy = {
        id: 'policy789',
        ...createDto,
        deviceProfiles: {
          appleTv: true,
          roku: true,
          web: true,
          chromecast: true,
          ps5: true,
          xbox: true,
        },
        advancedSettings: {
          ffmpegFlags: ['-preset', 'medium'],
          hwaccel: 'auto',
          audioCodec: 'copy',
          subtitleHandling: 'copy',
        },
        atomicReplace: true,
        verifyOutput: true,
        skipSeeding: true,
        createdAt: new Date('2025-10-01T13:00:00Z'),
        updatedAt: new Date('2025-10-01T13:00:00Z'),
      };

      mockPrismaService.policy.create.mockResolvedValue(mockCreatedPolicy);

      const result = await service.create(createDto);

      expect(result.name).toBe('Archival Quality AV1');
      expect(result.targetCodec).toBe(TargetCodec.AV1);
      expect(result.targetQuality).toBe(20);
      expect(result.libraryId).toBe('lib456');
    });

    it('should create a custom policy with specific device profiles', async () => {
      const createDto = {
        name: 'Custom Mobile Policy',
        preset: PolicyPreset.CUSTOM,
        targetCodec: TargetCodec.H264,
        targetQuality: 28,
        deviceProfiles: {
          appleTv: false,
          roku: false,
          web: true,
          chromecast: true,
          ps5: false,
          xbox: false,
        },
        advancedSettings: {
          ffmpegFlags: ['-preset', 'veryfast'],
          hwaccel: 'nvidia',
          audioCodec: 'aac',
          subtitleHandling: 'burn',
        },
      };

      const mockCreatedPolicy = {
        id: 'policy999',
        ...createDto,
        atomicReplace: true,
        verifyOutput: true,
        skipSeeding: true,
        libraryId: null,
        createdAt: new Date('2025-10-01T14:00:00Z'),
        updatedAt: new Date('2025-10-01T14:00:00Z'),
      };

      mockPrismaService.policy.create.mockResolvedValue(mockCreatedPolicy);

      const result = await service.create(createDto);

      expect(result.deviceProfiles).toEqual({
        appleTv: false,
        roku: false,
        web: true,
        chromecast: true,
        ps5: false,
        xbox: false,
      });
      expect(result.advancedSettings).toEqual({
        ffmpegFlags: ['-preset', 'veryfast'],
        hwaccel: 'nvidia',
        audioCodec: 'aac',
        subtitleHandling: 'burn',
      });
    });
  });

  describe('findAll', () => {
    it('should return all policies ordered by creation date', async () => {
      const mockPolicies = [
        {
          id: 'policy1',
          name: 'Recent Policy',
          preset: PolicyPreset.FAST_HEVC,
          targetCodec: TargetCodec.HEVC,
          targetQuality: 26,
          deviceProfiles: {},
          advancedSettings: {},
          atomicReplace: true,
          verifyOutput: true,
          skipSeeding: true,
          libraryId: null,
          createdAt: new Date('2025-10-01T15:00:00Z'),
          updatedAt: new Date('2025-10-01T15:00:00Z'),
        },
        {
          id: 'policy2',
          name: 'Older Policy',
          preset: PolicyPreset.BALANCED_HEVC,
          targetCodec: TargetCodec.HEVC,
          targetQuality: 23,
          deviceProfiles: {},
          advancedSettings: {},
          atomicReplace: true,
          verifyOutput: true,
          skipSeeding: true,
          libraryId: null,
          createdAt: new Date('2025-09-30T10:00:00Z'),
          updatedAt: new Date('2025-09-30T10:00:00Z'),
        },
      ];

      mockPrismaService.policy.findMany.mockResolvedValue(mockPolicies);

      const result = await service.findAll();

      expect(result).toHaveLength(2);
      expect(result[0].name).toBe('Recent Policy');
      expect(result[1].name).toBe('Older Policy');
      expect(mockPrismaService.policy.findMany).toHaveBeenCalledWith({
        orderBy: { createdAt: 'desc' },
      });
    });

    it('should return empty array when no policies exist', async () => {
      mockPrismaService.policy.findMany.mockResolvedValue([]);

      const result = await service.findAll();

      expect(result).toEqual([]);
    });
  });

  describe('findOne', () => {
    it('should return policy with job statistics', async () => {
      const mockPolicy = {
        id: 'policy123',
        name: 'Active Policy',
        preset: PolicyPreset.BALANCED_HEVC,
        targetCodec: TargetCodec.HEVC,
        targetQuality: 23,
        deviceProfiles: {},
        advancedSettings: {},
        atomicReplace: true,
        verifyOutput: true,
        skipSeeding: true,
        library: {
          id: 'lib123',
          name: 'TV Shows',
        },
        _count: {
          jobs: 142,
        },
        createdAt: new Date('2025-10-01T10:00:00Z'),
        updatedAt: new Date('2025-10-01T12:00:00Z'),
      };

      mockPrismaService.policy.findUnique.mockResolvedValue(mockPolicy);

      const result = await service.findOne('policy123');

      expect(result.id).toBe('policy123');
      expect(result.library).toEqual({ id: 'lib123', name: 'TV Shows' });
      expect(result._count.jobs).toBe(142);
      expect(mockPrismaService.policy.findUnique).toHaveBeenCalledWith({
        where: { id: 'policy123' },
        include: expect.objectContaining({
          library: expect.anything(),
          _count: expect.anything(),
        }),
      });
    });

    it('should throw NotFoundException when policy does not exist', async () => {
      mockPrismaService.policy.findUnique.mockResolvedValue(null);

      await expect(service.findOne('nonexistent')).rejects.toThrow(NotFoundException);
      await expect(service.findOne('nonexistent')).rejects.toThrow(
        'Policy with ID "nonexistent" not found'
      );
    });
  });

  describe('update', () => {
    it('should update policy quality settings', async () => {
      const mockExistingPolicy = {
        id: 'policy123',
        name: 'Original Name',
        preset: PolicyPreset.BALANCED_HEVC,
        targetCodec: TargetCodec.HEVC,
        targetQuality: 23,
        deviceProfiles: {},
        advancedSettings: {},
        atomicReplace: true,
        verifyOutput: true,
        skipSeeding: true,
        library: null,
        _count: { jobs: 10 },
        createdAt: new Date('2025-10-01T10:00:00Z'),
        updatedAt: new Date('2025-10-01T12:00:00Z'),
      };

      const mockUpdatedPolicy = {
        ...mockExistingPolicy,
        targetQuality: 26,
        updatedAt: new Date('2025-10-01T16:00:00Z'),
      };

      mockPrismaService.policy.findUnique.mockResolvedValue(mockExistingPolicy);
      mockPrismaService.policy.update.mockResolvedValue(mockUpdatedPolicy);

      const result = await service.update('policy123', { targetQuality: 26 });

      expect(result.targetQuality).toBe(26);
      expect(mockPrismaService.policy.update).toHaveBeenCalledWith({
        where: { id: 'policy123' },
        data: expect.objectContaining({
          targetQuality: 26,
        }),
      });
    });

    it('should throw NotFoundException when updating non-existent policy', async () => {
      mockPrismaService.policy.findUnique.mockResolvedValue(null);

      await expect(service.update('nonexistent', { name: 'New Name' })).rejects.toThrow(
        NotFoundException
      );
    });
  });

  describe('remove', () => {
    it('should delete an existing policy', async () => {
      const mockPolicy = {
        id: 'policy123',
        name: 'To Delete',
        preset: PolicyPreset.BALANCED_HEVC,
        targetCodec: TargetCodec.HEVC,
        targetQuality: 23,
        deviceProfiles: {},
        advancedSettings: {},
        atomicReplace: true,
        verifyOutput: true,
        skipSeeding: true,
        library: null,
        _count: { jobs: 0 },
        createdAt: new Date('2025-10-01T10:00:00Z'),
        updatedAt: new Date('2025-10-01T12:00:00Z'),
      };

      mockPrismaService.policy.findUnique.mockResolvedValue(mockPolicy);
      mockPrismaService.policy.delete.mockResolvedValue(mockPolicy);

      await service.remove('policy123');

      expect(mockPrismaService.policy.delete).toHaveBeenCalledWith({
        where: { id: 'policy123' },
      });
    });

    it('should throw NotFoundException when deleting non-existent policy', async () => {
      mockPrismaService.policy.findUnique.mockResolvedValue(null);

      await expect(service.remove('nonexistent')).rejects.toThrow(NotFoundException);
    });
  });

  describe('getPresets', () => {
    it('should return all available presets with descriptions', () => {
      const presets = service.getPresets();

      expect(presets).toHaveLength(5);
      expect(presets).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            preset: PolicyPreset.BALANCED_HEVC,
            name: 'Balanced HEVC',
            defaultCodec: TargetCodec.HEVC,
            recommendedQuality: 23,
          }),
          expect.objectContaining({
            preset: PolicyPreset.FAST_HEVC,
            name: 'Fast HEVC',
            defaultCodec: TargetCodec.HEVC,
            recommendedQuality: 26,
          }),
          expect.objectContaining({
            preset: PolicyPreset.QUALITY_AV1,
            name: 'Quality AV1',
            defaultCodec: TargetCodec.AV1,
            recommendedQuality: 28,
          }),
          expect.objectContaining({
            preset: PolicyPreset.COPY_IF_COMPLIANT,
            name: 'Copy if Compliant',
            defaultCodec: TargetCodec.HEVC,
            recommendedQuality: 0,
          }),
          expect.objectContaining({
            preset: PolicyPreset.CUSTOM,
            name: 'Custom',
            defaultCodec: TargetCodec.HEVC,
            recommendedQuality: 23,
          }),
        ])
      );
    });

    it('should include descriptions for all presets', () => {
      const presets = service.getPresets();

      for (const preset of presets) {
        expect(preset.description).toBeDefined();
        expect(preset.description.length).toBeGreaterThan(10);
      }
    });
  });
});
