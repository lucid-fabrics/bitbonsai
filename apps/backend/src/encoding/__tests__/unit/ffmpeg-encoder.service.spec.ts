import * as fsModule from 'node:fs';
import { Test, type TestingModule } from '@nestjs/testing';
import { FfmpegEncoderService } from '../../ffmpeg/ffmpeg-encoder.service';
import { FfmpegHealthMonitor } from '../../ffmpeg/ffmpeg-health-monitor.service';
import { FfmpegProcessManager } from '../../ffmpeg/ffmpeg-process-manager.service';
import { FfmpegProgressTracker } from '../../ffmpeg/ffmpeg-progress-tracker.service';
import { FfmpegFlagBuilderService } from '../../ffmpeg-flag-builder.service';
import { FfprobeService } from '../../ffprobe.service';
import { HardwareAccelerationService } from '../../hardware-acceleration.service';
import { DiskSpaceGuardService } from '../../services/disk-space-guard.service';
import { NfsHealthService } from '../../services/nfs-health.service';
import { TempFileGuardService } from '../../services/temp-file-guard.service';

jest.mock('node:fs', () => ({
  existsSync: jest.fn(),
  promises: { unlink: jest.fn() },
}));

const mockExistsSync = (fsModule as jest.Mocked<typeof fsModule>).existsSync as jest.Mock;

const makeJob = (overrides: Record<string, unknown> = {}) => ({
  id: 'job-1',
  filePath: '/mnt/media/movie.mkv',
  fileLabel: 'movie.mkv',
  targetCodec: 'HEVC',
  targetQuality: 28,
  sourceCodec: 'H.264',
  sourceContainer: 'mkv',
  tempFilePath: null,
  resumeFromSeconds: null,
  ...overrides,
});

const makePolicy = (overrides: Record<string, unknown> = {}) => ({
  id: 'policy-1',
  targetCodec: 'HEVC',
  targetQuality: 28,
  advancedSettings: null,
  ...overrides,
});

describe('FfmpegEncoderService', () => {
  let service: FfmpegEncoderService;
  let processManager: jest.Mocked<FfmpegProcessManager>;
  let flagBuilder: jest.Mocked<FfmpegFlagBuilderService>;
  let ffprobe: jest.Mocked<FfprobeService>;
  let nfsHealth: jest.Mocked<NfsHealthService>;
  let diskSpaceGuard: jest.Mocked<DiskSpaceGuardService>;
  let tempFileGuard: jest.Mocked<TempFileGuardService>;
  let progressTracker: jest.Mocked<FfmpegProgressTracker>;
  let healthMonitor: jest.Mocked<FfmpegHealthMonitor>;
  let hardwareAcceleration: jest.Mocked<HardwareAccelerationService>;

  beforeEach(async () => {
    processManager = {
      activeEncodings: new Map(),
      spawnFfmpegProcess: jest.fn(),
      getNiceValue: jest.fn().mockReturnValue(0),
      createActiveEncoding: jest.fn(),
      killProcess: jest.fn().mockResolvedValue(true),
      hasActiveProcess: jest.fn().mockReturnValue(false),
      getLastStderr: jest.fn().mockReturnValue(null),
    } as unknown as jest.Mocked<FfmpegProcessManager>;

    flagBuilder = {
      buildFfmpegCommand: jest.fn().mockReturnValue(['-i', 'input.mkv', 'output.mkv']),
    } as unknown as jest.Mocked<FfmpegFlagBuilderService>;

    ffprobe = {
      getVideoDuration: jest.fn().mockResolvedValue(120),
      getVideoInfo: jest.fn().mockResolvedValue({ codec: 'H.264', container: 'mkv' }),
      getVideoInfoCached: jest.fn().mockResolvedValue({ codec: 'H.264', container: 'mkv' }),
      cleanupCodecCache: jest.fn(),
      clearCache: jest.fn(),
    } as unknown as jest.Mocked<FfprobeService>;

    nfsHealth = {
      checkNfsHealth: jest.fn().mockResolvedValue({ isHealthy: true }),
    } as unknown as jest.Mocked<NfsHealthService>;

    diskSpaceGuard = {
      checkDiskSpace: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<DiskSpaceGuardService>;

    tempFileGuard = {
      guardTempFile: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<TempFileGuardService>;

    progressTracker = {
      parseProgress: jest.fn().mockReturnValue(null),
      formatSecondsToTimestamp: jest.fn().mockReturnValue('00:02:00'),
      clearAllTrackers: jest.fn(),
    } as unknown as jest.Mocked<FfmpegProgressTracker>;

    healthMonitor = {
      validateFilePath: jest.fn(),
      verifyFile: jest.fn().mockResolvedValue({ isValid: true }),
    } as unknown as jest.Mocked<FfmpegHealthMonitor>;

    hardwareAcceleration = {
      detectHardwareAcceleration: jest.fn().mockResolvedValue({ type: 'none', encoder: 'libx265' }),
      selectCodecForPolicy: jest.fn().mockReturnValue('libx265'),
    } as unknown as jest.Mocked<HardwareAccelerationService>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FfmpegEncoderService,
        { provide: FfmpegProcessManager, useValue: processManager },
        { provide: FfmpegFlagBuilderService, useValue: flagBuilder },
        { provide: FfprobeService, useValue: ffprobe },
        { provide: NfsHealthService, useValue: nfsHealth },
        { provide: DiskSpaceGuardService, useValue: diskSpaceGuard },
        { provide: TempFileGuardService, useValue: tempFileGuard },
        { provide: FfmpegProgressTracker, useValue: progressTracker },
        { provide: FfmpegHealthMonitor, useValue: healthMonitor },
        { provide: HardwareAccelerationService, useValue: hardwareAcceleration },
      ],
    }).compile();

    service = module.get(FfmpegEncoderService);
  });

  describe('delegation - ffprobe helpers', () => {
    it('getVideoDuration delegates to FfprobeService', async () => {
      const result = await service.getVideoDuration('/mnt/media/movie.mkv');
      expect(ffprobe.getVideoDuration).toHaveBeenCalledWith('/mnt/media/movie.mkv');
      expect(result).toBe(120);
    });

    it('getVideoInfo delegates to FfprobeService', async () => {
      const result = await service.getVideoInfo('/mnt/media/movie.mkv');
      expect(ffprobe.getVideoInfo).toHaveBeenCalledWith('/mnt/media/movie.mkv');
      expect(result).toEqual({ codec: 'H.264', container: 'mkv' });
    });

    it('getVideoInfoCached delegates to FfprobeService', async () => {
      await service.getVideoInfoCached('/mnt/media/movie.mkv');
      expect(ffprobe.getVideoInfoCached).toHaveBeenCalledWith('/mnt/media/movie.mkv');
    });

    it('cleanupFfprobeCodecCache delegates to FfprobeService', () => {
      service.cleanupFfprobeCodecCache();
      expect(ffprobe.cleanupCodecCache).toHaveBeenCalledTimes(1);
    });

    it('clearFfprobeCache delegates to FfprobeService', () => {
      service.clearFfprobeCache();
      expect(ffprobe.clearCache).toHaveBeenCalledTimes(1);
    });
  });

  describe('delegation - progress helpers', () => {
    it('parseProgress delegates to FfmpegProgressTracker', () => {
      service.parseProgress('frame=100 fps=25 time=00:00:04');
      expect(progressTracker.parseProgress).toHaveBeenCalledWith('frame=100 fps=25 time=00:00:04');
    });

    it('formatSecondsToTimestamp delegates to FfmpegProgressTracker', () => {
      const result = service.formatSecondsToTimestamp(120);
      expect(progressTracker.formatSecondsToTimestamp).toHaveBeenCalledWith(120);
      expect(result).toBe('00:02:00');
    });

    it('clearAllProgressTrackers delegates to FfmpegProgressTracker', () => {
      service.clearAllProgressTrackers();
      expect(progressTracker.clearAllTrackers).toHaveBeenCalledTimes(1);
    });
  });

  describe('delegation - hardware acceleration', () => {
    it('detectHardwareAcceleration delegates to HardwareAccelerationService', async () => {
      const result = await service.detectHardwareAcceleration();
      expect(hardwareAcceleration.detectHardwareAcceleration).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ type: 'none', encoder: 'libx265' });
    });

    it('selectCodecForPolicy delegates to HardwareAccelerationService', () => {
      const result = service.selectCodecForPolicy('HEVC', 'none');
      expect(hardwareAcceleration.selectCodecForPolicy).toHaveBeenCalledWith('HEVC', 'none');
      expect(result).toBe('libx265');
    });
  });

  describe('delegation - file validation', () => {
    it('validateFilePath delegates to FfmpegHealthMonitor', () => {
      service.validateFilePath('/mnt/media/movie.mkv', '/mnt/media');
      expect(healthMonitor.validateFilePath).toHaveBeenCalledWith(
        '/mnt/media/movie.mkv',
        '/mnt/media'
      );
    });

    it('verifyFile delegates to FfmpegHealthMonitor', async () => {
      const result = await service.verifyFile('/mnt/media/movie.mkv');
      expect(healthMonitor.verifyFile).toHaveBeenCalledWith('/mnt/media/movie.mkv');
      expect(result).toEqual({ isValid: true });
    });

    it('verifyFile returns error when file is invalid', async () => {
      healthMonitor.verifyFile.mockResolvedValue({ isValid: false, error: 'corrupt container' });
      const result = await service.verifyFile('/mnt/media/bad.mkv');
      expect(result).toEqual({ isValid: false, error: 'corrupt container' });
    });
  });

  describe('delegation - buildFfmpegCommand', () => {
    it('delegates to FfmpegFlagBuilderService', () => {
      const job = makeJob() as never;
      const policy = makePolicy() as never;
      const hwaccel = { type: 'none', encoder: 'libx265' } as never;

      service.buildFfmpegCommand(job, policy, hwaccel, '/tmp/out.mkv');

      expect(flagBuilder.buildFfmpegCommand).toHaveBeenCalledWith(
        job,
        policy,
        hwaccel,
        '/tmp/out.mkv'
      );
    });
  });

  describe('encodeFile', () => {
    it('throws when source file does not exist', async () => {
      mockExistsSync.mockReturnValue(false);
      const job = makeJob() as never;
      const policy = makePolicy() as never;

      await expect(service.encodeFile(job, policy)).rejects.toThrow('File not found');
    });

    it('rejects security validation failures before encoding', async () => {
      const job = makeJob({
        library: { id: 'lib-1', name: 'Movies', path: '/mnt/other' },
      }) as never;
      const policy = makePolicy() as never;
      healthMonitor.validateFilePath.mockImplementation(() => {
        throw new Error('path traversal detected');
      });

      await expect(service.encodeFile(job, policy)).rejects.toThrow('Security validation failed');
      expect(ffprobe.getVideoDuration).not.toHaveBeenCalled();
    });
  });
});
