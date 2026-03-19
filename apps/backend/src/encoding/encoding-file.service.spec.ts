import { Test, TestingModule } from '@nestjs/testing';
import { JobRepository } from '../common/repositories/job.repository';
import { SettingsRepository } from '../common/repositories/settings.repository';
import { FileRelocatorService } from '../core/services/file-relocator.service';
import { LibrariesService } from '../libraries/libraries.service';
import { QueueService } from '../queue/queue.service';
import { EncodingFileService } from './encoding-file.service';
import { FfmpegService } from './ffmpeg.service';
import { QualityMetricsService } from './quality-metrics.service';
import { SystemResourceService } from './system-resource.service';

describe('EncodingFileService', () => {
  let service: EncodingFileService;
  let mockFfmpegService: jest.Mocked<FfmpegService>;
  let mockSystemResourceService: jest.Mocked<SystemResourceService>;
  let mockQueueService: jest.Mocked<QueueService>;
  let mockLibrariesService: jest.Mocked<LibrariesService>;

  beforeEach(async () => {
    mockFfmpegService = {
      getVideoDuration: jest.fn(),
      verifyFile: jest.fn(),
      encode: jest.fn(),
    } as any;

    mockSystemResourceService = {
      getEncodingTempPath: jest.fn().mockReturnValue(null),
    } as any;

    mockQueueService = {
      update: jest.fn().mockResolvedValue(undefined),
    } as any;

    mockLibrariesService = {
      findOne: jest.fn(),
      update: jest.fn().mockResolvedValue(undefined),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EncodingFileService,
        {
          provide: JobRepository,
          useValue: {
            findById: jest.fn(),
            updateById: jest.fn(),
          },
        },
        {
          provide: SettingsRepository,
          useValue: {
            findFirst: jest.fn().mockResolvedValue(null),
          },
        },
        { provide: FfmpegService, useValue: mockFfmpegService },
        { provide: LibrariesService, useValue: mockLibrariesService },
        { provide: FileRelocatorService, useValue: {} },
        { provide: SystemResourceService, useValue: mockSystemResourceService },
        { provide: QueueService, useValue: mockQueueService },
        { provide: QualityMetricsService, useValue: {} },
      ],
    }).compile();

    service = module.get<EncodingFileService>(EncodingFileService);
  });

  describe('calculateSavings', () => {
    it('should calculate savings correctly', () => {
      const result = service.calculateSavings(BigInt(1_000_000), BigInt(600_000));
      expect(result.savedBytes).toBe(BigInt(400_000));
      expect(result.savedPercent).toBeCloseTo(40);
    });

    it('should handle negative savings (file grew)', () => {
      const result = service.calculateSavings(BigInt(500_000), BigInt(600_000));
      expect(result.savedBytes).toBe(BigInt(-100_000));
      expect(result.savedPercent).toBeLessThan(0);
    });
  });

  describe('getAdaptiveDurationTolerance', () => {
    it('should return 5.0% for videos under 5 minutes', () => {
      expect(service.getAdaptiveDurationTolerance(60)).toBe(5.0);
    });

    it('should return 3.0% for videos between 5 and 30 minutes', () => {
      expect(service.getAdaptiveDurationTolerance(600)).toBe(3.0);
    });

    it('should return 1.0% for videos over 2 hours', () => {
      expect(service.getAdaptiveDurationTolerance(8000)).toBe(1.0);
    });
  });

  describe('validateOutputSize', () => {
    it('should throw when output is suspiciously small', () => {
      expect(() =>
        service.validateOutputSize(
          BigInt(2_000_000_000), // 2GB original
          BigInt(1_000), // 1KB output - way too small
          3600, // 1 hour video
          '/media/movie.mkv'
        )
      ).toThrow('suspiciously small');
    });

    it('should throw for extreme compression (>95% with large file)', () => {
      expect(() =>
        service.validateOutputSize(
          BigInt(3_000_000_000), // 3GB original
          BigInt(95_000_000), // 95MB output (96.8% reduction, above min 90MB threshold)
          3600,
          '/media/movie.mkv'
        )
      ).toThrow('Extreme compression');
    });

    it('should pass for normal compression', () => {
      expect(() =>
        service.validateOutputSize(
          BigInt(2_000_000_000), // 2GB original
          BigInt(1_000_000_000), // 1GB output (50% reduction)
          3600,
          '/media/movie.mkv'
        )
      ).not.toThrow();
    });
  });

  describe('validateOutputDuration', () => {
    it('should pass for matching durations within tolerance', async () => {
      mockFfmpegService.getVideoDuration.mockResolvedValue(3600);
      jest.spyOn(service, 'sleep').mockResolvedValue(undefined);

      await expect(
        service.validateOutputDuration('/output.mkv', 3600, '/input.mkv')
      ).resolves.not.toThrow();
    });

    it('should throw for sub-second clips (skip validation)', async () => {
      // Sub-second clips should pass without calling getVideoDuration
      jest.spyOn(service, 'sleep').mockResolvedValue(undefined);

      await expect(
        service.validateOutputDuration('/output.mkv', 0.5, '/input.mkv')
      ).resolves.not.toThrow();
      expect(mockFfmpegService.getVideoDuration).not.toHaveBeenCalled();
    });

    it('should throw when output duration is significantly shorter', async () => {
      // original = 3600s, output = 1800s (50% truncated)
      mockFfmpegService.getVideoDuration.mockResolvedValue(1800);
      jest.spyOn(service, 'sleep').mockResolvedValue(undefined);

      await expect(
        service.validateOutputDuration('/output.mkv', 3600, '/input.mkv')
      ).rejects.toThrow('duration mismatch');
    });
  });

  describe('checkTempFileWithRetry', () => {
    it('should return false when no tempFilePath provided', async () => {
      const result = await service.checkTempFileWithRetry(null);
      expect(result).toBe(false);
    });
  });

  describe('sleep', () => {
    it('should resolve after specified delay', async () => {
      const start = Date.now();
      await service.sleep(50);
      const elapsed = Date.now() - start;
      expect(elapsed).toBeGreaterThanOrEqual(40);
    });
  });
});
