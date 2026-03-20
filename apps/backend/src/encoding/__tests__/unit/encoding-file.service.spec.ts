import * as fs from 'node:fs';
import * as path from 'node:path';
import { Test, type TestingModule } from '@nestjs/testing';
import { JobRepository } from '../../../common/repositories/job.repository';
import { SettingsRepository } from '../../../common/repositories/settings.repository';
import { FileRelocatorService } from '../../../core/services/file-relocator.service';
import { LibrariesService } from '../../../libraries/libraries.service';
import { NodesService } from '../../../nodes/nodes.service';
import { QueueService } from '../../../queue/queue.service';
import { createMockJob, createMockPolicy } from '../../../testing/mock-factories';
import { EncodingFileService } from '../../encoding-file.service';
import { EncodingFileReplacementService } from '../../encoding-file-replacement.service';
import { EncodingOutputVerificationService } from '../../encoding-output-verification.service';
import { FfmpegService } from '../../ffmpeg.service';
import { QualityMetricsService } from '../../quality-metrics.service';
import { SystemResourceService } from '../../system-resource.service';

jest.mock('node:fs', () => ({
  promises: {
    access: jest.fn(),
    stat: jest.fn(),
    statfs: jest.fn(),
  },
  constants: { R_OK: 4 },
  existsSync: jest.fn(),
  statSync: jest.fn(),
  unlinkSync: jest.fn(),
  renameSync: jest.fn(),
  copyFileSync: jest.fn(),
}));
jest.mock('node:path', () => {
  const actual = jest.requireActual<typeof path>('node:path');
  return {
    ...actual,
    dirname: jest.fn((p: string) => actual.dirname(p)),
    basename: jest.fn((p: string) => actual.basename(p)),
    join: jest.fn((...args: string[]) => actual.join(...args)),
  };
});

describe('EncodingFileService', () => {
  let service: EncodingFileService;
  let module: TestingModule;
  let ffmpegService: jest.Mocked<FfmpegService>;
  let _queueService: jest.Mocked<QueueService>;
  let librariesService: jest.Mocked<LibrariesService>;
  let _settingsRepository: jest.Mocked<SettingsRepository>;
  let _qualityMetricsService: jest.Mocked<QualityMetricsService>;
  let _systemResourceService: jest.Mocked<SystemResourceService>;

  const mockPolicy = createMockPolicy({
    id: 'policy-1',
    targetCodec: 'HEVC',
    targetQuality: 28,
    verifyOutput: true,
    atomicReplace: true,
    advancedSettings: { hwaccel: 'auto' },
  });

  const baseJob = {
    ...createMockJob({
      id: 'job-1',
      filePath: '/media/test.mkv',
      progress: 0,
      tempFilePath: null,
      resumeTimestamp: null,
      keepOriginalRequested: false,
      beforeSizeBytes: BigInt(2 * 1024 ** 3),
    }),
    policy: mockPolicy,
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    module = await Test.createTestingModule({
      providers: [
        EncodingFileService,
        {
          provide: JobRepository,
          useValue: { updateById: jest.fn().mockResolvedValue(undefined) },
        },
        {
          provide: SettingsRepository,
          useValue: { findFirst: jest.fn().mockResolvedValue({ qualityMetricsEnabled: false }) },
        },
        {
          provide: FfmpegService,
          useValue: {
            encode: jest.fn().mockResolvedValue(undefined),
            verifyFile: jest.fn().mockResolvedValue({ isValid: true, error: undefined }),
            getVideoDuration: jest.fn().mockResolvedValue(3600),
          },
        },
        {
          provide: LibrariesService,
          useValue: {
            findOne: jest.fn().mockResolvedValue({ totalSizeBytes: BigInt(10 * 1024 ** 3) }),
            update: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: FileRelocatorService,
          useValue: { relocate: jest.fn().mockResolvedValue(undefined) },
        },
        {
          provide: SystemResourceService,
          useValue: { getEncodingTempPath: jest.fn().mockReturnValue(null) },
        },
        {
          provide: QueueService,
          useValue: { update: jest.fn().mockResolvedValue(undefined) },
        },
        {
          provide: QualityMetricsService,
          useValue: {
            calculateAllQualityMetrics: jest.fn().mockResolvedValue({
              vmaf: 95,
              psnr: 40,
              ssim: 0.98,
              calculatedAt: new Date(),
            }),
          },
        },
        {
          provide: NodesService,
          useValue: { getCurrentNode: jest.fn().mockResolvedValue({ id: 'node-1' }) },
        },
        EncodingFileReplacementService,
        EncodingOutputVerificationService,
      ],
    }).compile();

    service = module.get(EncodingFileService);
    ffmpegService = module.get(FfmpegService);
    _queueService = module.get(QueueService);
    librariesService = module.get(LibrariesService);
    _settingsRepository = module.get(SettingsRepository);
    _qualityMetricsService = module.get(QualityMetricsService);
    _systemResourceService = module.get(SystemResourceService);

    // Default fs mocks
    (fs.statSync as jest.Mock).mockReturnValue({ size: 2 * 1024 ** 3, mtimeMs: 1000 });
    (fs.existsSync as jest.Mock).mockReturnValue(false);
    (fs.unlinkSync as jest.Mock).mockReturnValue(undefined);
    (fs.renameSync as jest.Mock).mockReturnValue(undefined);
    (fs.copyFileSync as jest.Mock).mockReturnValue(undefined);
    (fs.promises.statfs as jest.Mock).mockResolvedValue({
      bavail: 1000000,
      bsize: 4096,
    });
  });

  afterEach(async () => {
    await module.close();
  });

  // ─── checkTempFileWithRetry ────────────────────────────────────────────────

  describe('checkTempFileWithRetry', () => {
    it('returns false immediately when tempFilePath is null', async () => {
      const result = await service.checkTempFileWithRetry(null);
      expect(result).toBe(false);
    });

    it('returns true when temp file exists on first attempt', async () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      const result = await service.checkTempFileWithRetry('/tmp/test.tmp');
      expect(result).toBe(true);
    });

    it('returns false after exhausting all retries without finding temp file', async () => {
      jest.spyOn(service, 'sleep').mockResolvedValue(undefined);
      (fs.existsSync as jest.Mock).mockReturnValue(false);

      const result = await service.checkTempFileWithRetry('/tmp/missing.tmp');
      expect(result).toBe(false);
    });

    it('returns true when file is found on a later attempt', async () => {
      jest.spyOn(service, 'sleep').mockResolvedValue(undefined);

      let calls = 0;
      (fs.existsSync as jest.Mock).mockImplementation(() => {
        calls++;
        return calls >= 3; // found on 3rd attempt
      });

      const result = await service.checkTempFileWithRetry('/tmp/late.tmp');
      expect(result).toBe(true);
    });

    it('handles fs.existsSync throwing and continues retrying', async () => {
      jest.spyOn(service, 'sleep').mockResolvedValue(undefined);

      let calls = 0;
      (fs.existsSync as jest.Mock).mockImplementation(() => {
        calls++;
        if (calls < 3) throw new Error('ESTALE');
        return true;
      });

      const result = await service.checkTempFileWithRetry('/tmp/nfs.tmp');
      expect(result).toBe(true);
    });
  });

  // ─── calculateSavings ─────────────────────────────────────────────────────

  describe('calculateSavings', () => {
    it('calculates positive savings correctly', () => {
      const result = service.calculateSavings(BigInt(1000), BigInt(750));
      expect(result.savedBytes).toBe(BigInt(250));
      expect(result.savedPercent).toBeCloseTo(25.0);
    });

    it('returns zero savings when sizes are equal', () => {
      const result = service.calculateSavings(BigInt(1000), BigInt(1000));
      expect(result.savedBytes).toBe(BigInt(0));
      expect(result.savedPercent).toBe(0);
    });

    it('returns negative savings when encoded file is larger', () => {
      const result = service.calculateSavings(BigInt(1000), BigInt(1200));
      expect(result.savedBytes).toBe(BigInt(-200));
      expect(result.savedPercent).toBeLessThan(0);
    });
  });

  // ─── getAdaptiveDurationTolerance ─────────────────────────────────────────

  describe('getAdaptiveDurationTolerance', () => {
    it('returns 5% for videos under 5 minutes', () => {
      expect(service.getAdaptiveDurationTolerance(60)).toBe(5.0);
      expect(service.getAdaptiveDurationTolerance(299)).toBe(5.0);
    });

    it('returns 3% for videos between 5 and 30 minutes', () => {
      expect(service.getAdaptiveDurationTolerance(300)).toBe(3.0);
      expect(service.getAdaptiveDurationTolerance(1799)).toBe(3.0);
    });

    it('returns 2% for videos between 30 min and 1 hour', () => {
      expect(service.getAdaptiveDurationTolerance(1800)).toBe(2.0);
      expect(service.getAdaptiveDurationTolerance(3599)).toBe(2.0);
    });

    it('returns 1.5% for videos between 1 and 2 hours', () => {
      expect(service.getAdaptiveDurationTolerance(3600)).toBe(1.5);
      expect(service.getAdaptiveDurationTolerance(7199)).toBe(1.5);
    });

    it('returns 1% for videos 2 hours or longer', () => {
      expect(service.getAdaptiveDurationTolerance(7200)).toBe(1.0);
      expect(service.getAdaptiveDurationTolerance(10800)).toBe(1.0);
    });
  });

  // ─── validateOutputDuration ────────────────────────────────────────────────

  describe('validateOutputDuration', () => {
    beforeEach(() => {
      jest.spyOn(service.outputVerification, 'sleep').mockResolvedValue(undefined);
    });

    it('resolves when output duration matches original within tolerance', async () => {
      ffmpegService.getVideoDuration.mockResolvedValue(3600.5);
      await expect(
        service.validateOutputDuration('/tmp/out.mkv', 3600, '/media/orig.mkv')
      ).resolves.toBeUndefined();
    });

    it('skips validation for sub-second clips', async () => {
      await expect(
        service.validateOutputDuration('/tmp/out.mkv', 0.5, '/media/orig.mkv')
      ).resolves.toBeUndefined();
      expect(ffmpegService.getVideoDuration).not.toHaveBeenCalled();
    });

    it('throws when output duration is 3600 fallback and original is not', async () => {
      ffmpegService.getVideoDuration.mockResolvedValue(3600);
      await expect(
        service.validateOutputDuration('/tmp/out.mkv', 1200, '/media/orig.mkv')
      ).rejects.toThrow('Cannot determine output file duration');
    });

    it('throws when duration mismatch exceeds absolute tolerance for short clips', async () => {
      // 30s clip, output is 28s — 2s diff exceeds ±1s absolute tolerance
      ffmpegService.getVideoDuration.mockResolvedValue(28);
      await expect(
        service.validateOutputDuration('/tmp/out.mkv', 30, '/media/orig.mkv')
      ).rejects.toThrow('duration mismatch');
    });

    it('throws when duration mismatch exceeds percentage tolerance for long clips', async () => {
      // 3700s clip (>1hr), output is 3500s — diff ~5.4% exceeds 1.5% tolerance
      ffmpegService.getVideoDuration.mockResolvedValue(3500);
      await expect(
        service.validateOutputDuration('/tmp/out.mkv', 3700, '/media/orig.mkv')
      ).rejects.toThrow('duration mismatch');
    });

    it('logs a warning but does not throw when original duration is exactly 3600', async () => {
      const logWarnSpy = jest.spyOn(service.outputVerification.logger, 'warn');
      ffmpegService.getVideoDuration.mockResolvedValue(3600.2);
      await expect(
        service.validateOutputDuration('/tmp/out.mkv', 3600, '/media/orig.mkv')
      ).resolves.toBeUndefined();
      expect(logWarnSpy).toHaveBeenCalledWith(expect.stringContaining('3600s (ffprobe fallback'));
    });
  });

  // ─── validateOutputSize ────────────────────────────────────────────────────

  describe('validateOutputSize', () => {
    it('passes for normal-sized output', () => {
      expect(() =>
        service.validateOutputSize(
          BigInt(2 * 1024 ** 3),
          BigInt(1 * 1024 ** 3),
          3600,
          '/media/test.mkv'
        )
      ).not.toThrow();
    });

    it('throws when output is smaller than minimum bitrate floor', () => {
      // Duration 3600s, min bitrate 200kbps → min size = 200*1000*3600/8 = 90_000_000 bytes
      expect(() =>
        service.validateOutputSize(
          BigInt(2 * 1024 ** 3),
          BigInt(1000), // 1 KB — way too small
          3600,
          '/media/test.mkv'
        )
      ).toThrow('suspiciously small');
    });

    it('throws on extreme compression (>95% reduction, large original, small output)', () => {
      // afterSize must be above the bitrate floor (200kbps * 3600s / 8 = 90_000_000 bytes)
      // but still trigger the >95% + <100MB + original>1GB check
      const originalSize = BigInt(4 * 1024 ** 3); // 4 GB
      const afterSize = BigInt(90 * 1024 * 1024); // 90 MB — 97.8% reduction (bigint: 97 > 95), above bitrate floor
      expect(() =>
        service.validateOutputSize(originalSize, afterSize, 3600, '/media/test.mkv')
      ).toThrow('Extreme compression');
    });

    it('warns but does not throw for high compression on smaller originals', () => {
      const logWarnSpy = jest.spyOn(service.logger, 'warn');
      // 91% reduction, original under 1 GB — warning only (not blocked)
      // afterSize must be above bitrate floor: 200kbps * 3600s / 8 = 90_000_000 bytes
      const originalSize = BigInt(1024 * 1024 * 1024); // exactly 1 GB (not > 1 GB)
      const afterSize = BigInt(92 * 1024 * 1024); // 92 MB — 91% reduction, above floor
      expect(() =>
        service.validateOutputSize(originalSize, afterSize, 3600, '/media/test.mkv')
      ).not.toThrow();
      expect(logWarnSpy).toHaveBeenCalledWith(expect.stringContaining('High compression'));
    });
  });

  // ─── verifyDiskSpaceForReplacement ────────────────────────────────────────

  describe('verifyDiskSpaceForReplacement', () => {
    it('resolves when there is sufficient disk space', async () => {
      (fs.promises.statfs as jest.Mock).mockResolvedValue({
        bavail: 10_000_000,
        bsize: 4096, // ~40 GB
      });

      await expect(
        service.verifyDiskSpaceForReplacement(
          '/media/orig.mkv',
          '/tmp/out.mkv',
          BigInt(1 * 1024 ** 3),
          BigInt(800 * 1024 ** 2)
        )
      ).resolves.toBeUndefined();
    });

    it('throws when disk space is insufficient for atomic replacement', async () => {
      (fs.promises.statfs as jest.Mock).mockResolvedValue({
        bavail: 1,
        bsize: 4096,
      });

      await expect(
        service.verifyDiskSpaceForReplacement(
          '/media/orig.mkv',
          '/tmp/out.mkv',
          BigInt(5 * 1024 ** 3),
          BigInt(3 * 1024 ** 3)
        )
      ).rejects.toThrow('Insufficient disk space');
    });

    it('logs warning and resolves when statfs fails with non-disk error', async () => {
      const logWarnSpy = jest.spyOn(service.fileReplacement.logger, 'warn');
      (fs.promises.statfs as jest.Mock).mockRejectedValue(new Error('ENOSYS'));

      await expect(
        service.verifyDiskSpaceForReplacement(
          '/media/orig.mkv',
          '/tmp/out.mkv',
          BigInt(1 * 1024 ** 3),
          BigInt(800 * 1024 ** 2)
        )
      ).resolves.toBeUndefined();

      expect(logWarnSpy).toHaveBeenCalledWith(expect.stringContaining('Could not check disk'));
    });
  });

  // ─── crossFsSafeRenameSync ────────────────────────────────────────────────

  describe('crossFsSafeRenameSync', () => {
    it('uses fast rename when source and dest are on same filesystem', () => {
      (fs.renameSync as jest.Mock).mockReturnValue(undefined);

      service.crossFsSafeRenameSync('/src/file.mkv', '/dst/file.mkv');

      expect(fs.renameSync).toHaveBeenCalledWith('/src/file.mkv', '/dst/file.mkv');
      expect(fs.copyFileSync).not.toHaveBeenCalled();
    });

    it('falls back to copy+delete on EXDEV error', () => {
      const exdevError = Object.assign(new Error('EXDEV'), { code: 'EXDEV' });
      (fs.renameSync as jest.Mock).mockImplementation(() => {
        throw exdevError;
      });
      (fs.statSync as jest.Mock).mockReturnValue({ size: 1000 });
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.statSync as jest.Mock)
        .mockReturnValueOnce({ size: 1000 }) // source stats
        .mockReturnValueOnce({ size: 1000 }); // dest stats (matching)

      service.crossFsSafeRenameSync('/src/file.mkv', '/dst/file.mkv');

      expect(fs.copyFileSync).toHaveBeenCalledWith('/src/file.mkv', '/dst/file.mkv');
      expect(fs.unlinkSync).toHaveBeenCalledWith('/src/file.mkv');
    });

    it('throws on EXDEV when copy fails with size mismatch', () => {
      const exdevError = Object.assign(new Error('EXDEV'), { code: 'EXDEV' });
      (fs.renameSync as jest.Mock).mockImplementation(() => {
        throw exdevError;
      });
      (fs.statSync as jest.Mock)
        .mockReturnValueOnce({ size: 1000 }) // source stats before copy
        .mockReturnValueOnce({ size: 500 }); // dest stats — size mismatch
      (fs.existsSync as jest.Mock).mockReturnValue(true);

      expect(() => service.crossFsSafeRenameSync('/src/file.mkv', '/dst/file.mkv')).toThrow(
        'Cross-filesystem move failed'
      );
    });

    it('re-throws non-EXDEV rename errors', () => {
      const permError = Object.assign(new Error('EACCES'), { code: 'EACCES' });
      (fs.renameSync as jest.Mock).mockImplementation(() => {
        throw permError;
      });

      expect(() => service.crossFsSafeRenameSync('/src/file.mkv', '/dst/file.mkv')).toThrow(
        'EACCES'
      );
      expect(fs.copyFileSync).not.toHaveBeenCalled();
    });
  });

  // ─── updateLibraryStats ───────────────────────────────────────────────────

  describe('updateLibraryStats', () => {
    it('updates library total size after encoding', async () => {
      librariesService.findOne.mockResolvedValue({
        totalSizeBytes: BigInt(10 * 1024 ** 3),
      } as never);

      await service.updateLibraryStats('lib-1', BigInt(500 * 1024 ** 2));

      expect(librariesService.update).toHaveBeenCalledWith(
        'lib-1',
        expect.objectContaining({ totalSizeBytes: expect.any(BigInt) })
      );
    });

    it('does not throw when librariesService.findOne fails', async () => {
      librariesService.findOne.mockRejectedValue(new Error('Library not found'));

      await expect(service.updateLibraryStats('lib-missing', BigInt(100))).resolves.toBeUndefined();
    });
  });

  // ─── performEncoding ──────────────────────────────────────────────────────

  describe('performEncoding', () => {
    it('throws when policy is null', async () => {
      await expect(
        service.performEncoding(baseJob, '/tmp/out.mkv', null as never, undefined)
      ).rejects.toThrow('Policy is required');
    });

    it('extracts hwaccel from advancedSettings and passes to ffmpeg', async () => {
      const policy = { ...mockPolicy, advancedSettings: { hwaccel: 'nvenc' } };
      await service.performEncoding(baseJob, '/tmp/out.mkv', policy, undefined);

      expect(ffmpegService.encode).toHaveBeenCalledWith(
        baseJob.id,
        expect.objectContaining({ hwAccel: 'nvenc' })
      );
    });

    it('defaults hwaccel to "auto" when not in advancedSettings', async () => {
      const policy = { ...mockPolicy, advancedSettings: null };
      await service.performEncoding(baseJob, '/tmp/out.mkv', policy, undefined);

      expect(ffmpegService.encode).toHaveBeenCalledWith(
        baseJob.id,
        expect.objectContaining({ hwAccel: 'auto' })
      );
    });

    it('passes startedFromSeconds to ffmpeg for true resume', async () => {
      await service.performEncoding(baseJob, '/tmp/out.mkv', mockPolicy, 1800);

      expect(ffmpegService.encode).toHaveBeenCalledWith(
        baseJob.id,
        expect.objectContaining({ startedFromSeconds: 1800 })
      );
    });
  });

  // ─── verifyEncodedFile ────────────────────────────────────────────────────

  describe('verifyEncodedFile', () => {
    beforeEach(() => {
      jest.spyOn(service.outputVerification, 'sleep').mockResolvedValue(undefined);
    });

    it('resolves on first successful verification', async () => {
      ffmpegService.verifyFile.mockResolvedValue({ isValid: true, error: undefined });

      await expect(service.verifyEncodedFile('/tmp/out.mkv')).resolves.toBeUndefined();
      expect(ffmpegService.verifyFile).toHaveBeenCalledTimes(1);
    });

    it('retries and succeeds on second attempt', async () => {
      ffmpegService.verifyFile
        .mockResolvedValueOnce({ isValid: false, error: 'not ready' })
        .mockResolvedValue({ isValid: true, error: undefined });

      await expect(service.verifyEncodedFile('/tmp/out.mkv')).resolves.toBeUndefined();
      expect(ffmpegService.verifyFile).toHaveBeenCalledTimes(2);
    });

    it('throws after exhausting all retries', async () => {
      ffmpegService.verifyFile.mockResolvedValue({ isValid: false, error: 'corrupt' });

      await expect(service.verifyEncodedFile('/tmp/out.mkv')).rejects.toThrow(
        'Verification failed after 10 attempts'
      );
    });
  });
});
