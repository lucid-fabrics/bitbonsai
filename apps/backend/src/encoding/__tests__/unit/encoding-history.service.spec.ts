import { Test, type TestingModule } from '@nestjs/testing';
import { AccelerationType } from '@prisma/client';
import { JobRepository } from '../../../common/repositories/job.repository';
import { EncodingHistoryService } from '../../encoding-history.service';

describe('EncodingHistoryService', () => {
  let service: EncodingHistoryService;
  let mockJobRepository: jest.Mocked<JobRepository>;

  const mockJobRepositoryInstance = {
    findMany: jest.fn(),
    findManyWithInclude: jest.fn(),
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    count: jest.fn(),
    aggregate: jest.fn(),
    groupBy: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    mockJobRepository = mockJobRepositoryInstance as unknown as jest.Mocked<JobRepository>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EncodingHistoryService,
        {
          provide: JobRepository,
          useValue: mockJobRepository,
        },
      ],
    }).compile();

    service = module.get<EncodingHistoryService>(EncodingHistoryService);
  });

  describe('constructor', () => {
    it('should be defined', () => {
      expect(service).toBeDefined();
    });
  });

  describe('loadHistoricalData', () => {
    it('should load historical data from completed jobs', async () => {
      const mockJobs = [
        {
          targetCodec: 'HEVC',
          beforeSizeBytes: BigInt(1024 * 1024 * 100), // 100MB
          startedAt: new Date('2024-01-01T10:00:00Z'),
          completedAt: new Date('2024-01-01T10:01:40Z'), // 100 seconds
          node: { acceleration: AccelerationType.NVIDIA },
        },
        {
          targetCodec: 'HEVC',
          beforeSizeBytes: BigInt(1024 * 1024 * 200), // 200MB
          startedAt: new Date('2024-01-01T11:00:00Z'),
          completedAt: new Date('2024-01-01T11:03:20Z'), // 200 seconds
          node: { acceleration: AccelerationType.NVIDIA },
        },
      ];

      mockJobRepository.findManyWithInclude.mockResolvedValue(mockJobs);

      await service.loadHistoricalData();

      const profiles = service.getSpeedProfiles();
      expect(profiles.length).toBe(1);
      expect(profiles[0].codec).toBe('HEVC');
      expect(profiles[0].accelerationType).toBe(AccelerationType.NVIDIA);
      expect(profiles[0].sampleCount).toBe(2);
      // Average: (100MB/100s + 200MB/200s) / 2 = 1MB/s
      expect(profiles[0].avgBytesPerSecond).toBeGreaterThan(0);
    });

    it('should handle empty job list', async () => {
      mockJobRepository.findManyWithInclude.mockResolvedValue([]);

      await service.loadHistoricalData();

      const profiles = service.getSpeedProfiles();
      expect(profiles.length).toBe(0);
    });

    it('should skip jobs with missing timing data', async () => {
      const mockJobs = [
        {
          targetCodec: 'HEVC',
          beforeSizeBytes: BigInt(1024 * 1024 * 100),
          startedAt: null, // Missing start time
          completedAt: new Date('2024-01-01T10:01:40Z'),
          node: { acceleration: AccelerationType.NVIDIA },
        },
        {
          targetCodec: 'HEVC',
          beforeSizeBytes: BigInt(1024 * 1024 * 100),
          startedAt: new Date('2024-01-01T10:00:00Z'),
          completedAt: null, // Missing completion time
          node: { acceleration: AccelerationType.NVIDIA },
        },
      ];

      mockJobRepository.findManyWithInclude.mockResolvedValue(mockJobs);

      await service.loadHistoricalData();

      const profiles = service.getSpeedProfiles();
      expect(profiles.length).toBe(0);
    });

    it('should skip jobs with missing node acceleration', async () => {
      const mockJobs = [
        {
          targetCodec: 'HEVC',
          beforeSizeBytes: BigInt(1024 * 1024 * 100),
          startedAt: new Date('2024-01-01T10:00:00Z'),
          completedAt: new Date('2024-01-01T10:01:40Z'),
          node: null, // Missing node
        },
      ];

      mockJobRepository.findManyWithInclude.mockResolvedValue(mockJobs);

      await service.loadHistoricalData();

      const profiles = service.getSpeedProfiles();
      expect(profiles.length).toBe(0);
    });

    it('should group jobs by codec and acceleration type', async () => {
      const mockJobs = [
        {
          targetCodec: 'HEVC',
          beforeSizeBytes: BigInt(1024 * 1024 * 100),
          startedAt: new Date('2024-01-01T10:00:00Z'),
          completedAt: new Date('2024-01-01T10:01:40Z'),
          node: { acceleration: AccelerationType.NVIDIA },
        },
        {
          targetCodec: 'HEVC',
          beforeSizeBytes: BigInt(1024 * 1024 * 100),
          startedAt: new Date('2024-01-01T11:00:00Z'),
          completedAt: new Date('2024-01-01T11:03:20Z'),
          node: { acceleration: AccelerationType.CPU },
        },
        {
          targetCodec: 'AV1',
          beforeSizeBytes: BigInt(1024 * 1024 * 100),
          startedAt: new Date('2024-01-01T12:00:00Z'),
          completedAt: new Date('2024-01-01T12:05:00Z'),
          node: { acceleration: AccelerationType.NVIDIA },
        },
      ];

      mockJobRepository.findManyWithInclude.mockResolvedValue(mockJobs);

      await service.loadHistoricalData();

      const profiles = service.getSpeedProfiles();
      expect(profiles.length).toBe(3);

      const hevcNvidia = profiles.find(
        (p) => p.codec === 'HEVC' && p.accelerationType === AccelerationType.NVIDIA
      );
      const hevcCpu = profiles.find(
        (p) => p.codec === 'HEVC' && p.accelerationType === AccelerationType.CPU
      );
      const av1Nvidia = profiles.find(
        (p) => p.codec === 'AV1' && p.accelerationType === AccelerationType.NVIDIA
      );

      expect(hevcNvidia).not.toBeUndefined();
      expect(hevcNvidia?.sampleCount).toBe(1);
      expect(hevcCpu).not.toBeUndefined();
      expect(hevcCpu?.sampleCount).toBe(1);
      expect(av1Nvidia).not.toBeUndefined();
      expect(av1Nvidia?.sampleCount).toBe(1);
    });

    it('should handle database errors gracefully', async () => {
      mockJobRepository.findManyWithInclude.mockRejectedValue(new Error('Database error'));

      // Should not throw
      await expect(service.loadHistoricalData()).resolves.not.toThrow();

      const profiles = service.getSpeedProfiles();
      expect(profiles.length).toBe(0);
    });
  });

  describe('calculateETA', () => {
    beforeEach(async () => {
      // Load some test data first
      const mockJobs = [
        {
          targetCodec: 'HEVC',
          beforeSizeBytes: BigInt(1024 * 1024 * 1000), // 1GB
          startedAt: new Date('2024-01-01T10:00:00Z'),
          completedAt: new Date('2024-01-01T10:16:40Z'), // 1000 seconds = ~1MB/s
          node: { acceleration: AccelerationType.NVIDIA },
        },
      ];
      // Add 10 more samples for high confidence
      for (let i = 0; i < 10; i++) {
        mockJobs.push({
          targetCodec: 'HEVC',
          beforeSizeBytes: BigInt(1024 * 1024 * 1000),
          startedAt: new Date('2024-01-01T10:00:00Z'),
          completedAt: new Date('2024-01-01T10:16:40Z'),
          node: { acceleration: AccelerationType.NVIDIA },
        });
      }

      mockJobRepository.findManyWithInclude.mockResolvedValue(mockJobs);
      await service.loadHistoricalData();
    });

    it('should calculate ETA using current FPS when available', () => {
      const result = service.calculateETA(
        'HEVC',
        AccelerationType.NVIDIA,
        1024 * 1024 * 100, // 100MB remaining
        30 // 30 FPS
      );

      expect(result.basedOn).toBe('current_speed');
      expect(result.confidence).toBe('high');
      expect(result.etaSeconds).toBeGreaterThan(0);
    });

    it('should calculate ETA using historical data', () => {
      const result = service.calculateETA(
        'HEVC',
        AccelerationType.NVIDIA,
        1024 * 1024 * 100 // 100MB remaining
      );

      expect(result.basedOn).toBe('historical');
      expect(result.confidence).toBe('high');
      expect(result.sampleCount).toBe(11);
      // With ~1MB/s speed, 100MB should take ~100 seconds
      expect(result.etaSeconds).toBeGreaterThan(50);
      expect(result.etaSeconds).toBeLessThan(200);
    });

    it('should use fallback estimate when no historical data', () => {
      const result = service.calculateETA(
        'VP9', // No historical data for VP9
        AccelerationType.CPU,
        1024 * 1024 * 100 // 100MB remaining
      );

      expect(result.basedOn).toBe('estimate');
      expect(result.confidence).toBe('low');
      expect(result.sampleCount).toBe(0);
      expect(result.etaSeconds).toBeGreaterThan(0);
    });

    it('should return medium confidence with few samples', async () => {
      // Reset and load only 5 samples
      const mockJobs = [];
      for (let i = 0; i < 5; i++) {
        mockJobs.push({
          targetCodec: 'AV1',
          beforeSizeBytes: BigInt(1024 * 1024 * 1000),
          startedAt: new Date('2024-01-01T10:00:00Z'),
          completedAt: new Date('2024-01-01T10:16:40Z'),
          node: { acceleration: AccelerationType.CPU },
        });
      }

      mockJobRepository.findManyWithInclude.mockResolvedValue(mockJobs);
      await service.loadHistoricalData();

      const result = service.calculateETA('AV1', AccelerationType.CPU, 1024 * 1024 * 100);

      expect(result.basedOn).toBe('historical');
      expect(result.confidence).toBe('medium');
      expect(result.sampleCount).toBe(5);
    });

    it('should return low confidence with very few samples', async () => {
      // Reset and load only 2 samples
      const mockJobs = [];
      for (let i = 0; i < 2; i++) {
        mockJobs.push({
          targetCodec: 'H264',
          beforeSizeBytes: BigInt(1024 * 1024 * 1000),
          startedAt: new Date('2024-01-01T10:00:00Z'),
          completedAt: new Date('2024-01-01T10:16:40Z'),
          node: { acceleration: AccelerationType.INTEL_QSV },
        });
      }

      mockJobRepository.findManyWithInclude.mockResolvedValue(mockJobs);
      await service.loadHistoricalData();

      const result = service.calculateETA('H264', AccelerationType.INTEL_QSV, 1024 * 1024 * 100);

      expect(result.basedOn).toBe('historical');
      expect(result.confidence).toBe('low');
      expect(result.sampleCount).toBe(2);
    });
  });

  describe('updateSpeedProfile', () => {
    it('should create new profile when none exists', async () => {
      await service.updateSpeedProfile(
        'HEVC',
        AccelerationType.NVIDIA,
        100, // 100 seconds
        1024 * 1024 * 100 // 100MB = 1MB/s
      );

      const profiles = service.getSpeedProfiles();
      expect(profiles.length).toBe(1);
      expect(profiles[0].codec).toBe('HEVC');
      expect(profiles[0].accelerationType).toBe(AccelerationType.NVIDIA);
      expect(profiles[0].sampleCount).toBe(1);
      expect(profiles[0].avgBytesPerSecond).toBe(1024 * 1024); // 1MB/s
    });

    it('should update existing profile with rolling average', async () => {
      // First update
      await service.updateSpeedProfile('HEVC', AccelerationType.NVIDIA, 100, 1024 * 1024 * 100);

      // Second update with different speed
      await service.updateSpeedProfile(
        'HEVC',
        AccelerationType.NVIDIA,
        50, // Faster encoding
        1024 * 1024 * 100 // Same size = 2MB/s
      );

      const profiles = service.getSpeedProfiles();
      expect(profiles.length).toBe(1);
      expect(profiles[0].sampleCount).toBe(2);
      // Rolling average should be between 1MB/s and 2MB/s
      expect(profiles[0].avgBytesPerSecond).toBeGreaterThan(1024 * 1024);
      expect(profiles[0].avgBytesPerSecond).toBeLessThan(2 * 1024 * 1024);
    });

    it('should ignore updates with zero duration', async () => {
      await service.updateSpeedProfile('HEVC', AccelerationType.NVIDIA, 0, 1024 * 1024 * 100);

      const profiles = service.getSpeedProfiles();
      expect(profiles.length).toBe(0);
    });

    it('should ignore updates with zero size', async () => {
      await service.updateSpeedProfile('HEVC', AccelerationType.NVIDIA, 100, 0);

      const profiles = service.getSpeedProfiles();
      expect(profiles.length).toBe(0);
    });

    it('should ignore updates with negative values', async () => {
      await service.updateSpeedProfile('HEVC', AccelerationType.NVIDIA, -100, 1024 * 1024 * 100);
      await service.updateSpeedProfile('HEVC', AccelerationType.NVIDIA, 100, -1024 * 1024 * 100);

      const profiles = service.getSpeedProfiles();
      expect(profiles.length).toBe(0);
    });
  });

  describe('getSpeedProfiles', () => {
    it('should return empty array when no profiles', () => {
      const profiles = service.getSpeedProfiles();
      expect(profiles).toEqual([]);
    });

    it('should return all profiles', async () => {
      await service.updateSpeedProfile('HEVC', AccelerationType.NVIDIA, 100, 1024 * 1024 * 100);
      await service.updateSpeedProfile('AV1', AccelerationType.CPU, 200, 1024 * 1024 * 100);
      await service.updateSpeedProfile('H264', AccelerationType.INTEL_QSV, 50, 1024 * 1024 * 100);

      const profiles = service.getSpeedProfiles();
      expect(profiles.length).toBe(3);
    });
  });

  describe('formatDuration (via calculateETA)', () => {
    beforeEach(async () => {
      mockJobRepository.findManyWithInclude.mockResolvedValue([]);
      await service.loadHistoricalData();
    });

    it('should format seconds correctly', () => {
      // Small file that will take ~30 seconds
      const result = service.calculateETA('HEVC', AccelerationType.NVIDIA, 30 * 5 * 1024 * 1024);

      expect(result.etaFormatted).toMatch(/\d+s$/);
    });

    it('should format minutes correctly', () => {
      // Larger file that will take ~5 minutes
      const result = service.calculateETA('HEVC', AccelerationType.NVIDIA, 300 * 5 * 1024 * 1024);

      expect(result.etaFormatted).toMatch(/\d+m \d+s$/);
    });

    it('should format hours correctly', () => {
      // Large file that will take ~2 hours (use CPU for slower encoding)
      // HEVC CPU fallback is ~5MB/s, so 36GB should take ~2 hours
      const result = service.calculateETA('HEVC', AccelerationType.CPU, 36 * 1024 * 1024 * 1024);

      expect(result.etaFormatted).toMatch(/\d+h \d+m$/);
    });
  });

  describe('fallback speed estimates', () => {
    beforeEach(async () => {
      mockJobRepository.findManyWithInclude.mockResolvedValue([]);
      await service.loadHistoricalData();
    });

    it('should provide faster estimates for GPU acceleration', () => {
      const cpuResult = service.calculateETA('HEVC', AccelerationType.CPU, 1024 * 1024 * 1000);
      const nvidiaResult = service.calculateETA(
        'HEVC',
        AccelerationType.NVIDIA,
        1024 * 1024 * 1000
      );

      // NVIDIA should be faster (lower ETA)
      expect(nvidiaResult.etaSeconds).toBeLessThan(cpuResult.etaSeconds);
    });

    it('should provide slower estimates for AV1 vs HEVC', () => {
      const hevcResult = service.calculateETA('HEVC', AccelerationType.CPU, 1024 * 1024 * 1000);
      const av1Result = service.calculateETA('AV1', AccelerationType.CPU, 1024 * 1024 * 1000);

      // AV1 should be slower (higher ETA)
      expect(av1Result.etaSeconds).toBeGreaterThan(hevcResult.etaSeconds);
    });
  });
});
