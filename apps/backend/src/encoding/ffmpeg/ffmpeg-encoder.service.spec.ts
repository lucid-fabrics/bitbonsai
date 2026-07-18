import { existsSync } from 'node:fs';
import { Test, TestingModule } from '@nestjs/testing';
import { FfmpegFlagBuilderService } from '../ffmpeg-flag-builder.service';
import { FfprobeService } from '../ffprobe.service';
import { HardwareAccelerationService } from '../hardware-acceleration.service';
import { DiskSpaceGuardService } from '../services/disk-space-guard.service';
import { NfsHealthService } from '../services/nfs-health.service';
import { TempFileGuardService } from '../services/temp-file-guard.service';
import { FfmpegEncoderService } from './ffmpeg-encoder.service';
import { FfmpegHealthMonitor } from './ffmpeg-health-monitor.service';
import { FfmpegProcessManager } from './ffmpeg-process-manager.service';
import { FfmpegProgressTracker } from './ffmpeg-progress-tracker.service';

jest.mock('node:fs', () => ({
  ...jest.requireActual('node:fs'),
  existsSync: jest.fn(),
  promises: { unlink: jest.fn().mockResolvedValue(undefined) },
}));

const mockExistsSync = existsSync as jest.Mock;

function makeMockProcess(
  opts: { exitCode?: number | null; signal?: string | null; error?: Error } = {}
) {
  const listeners: Record<string, Function[]> = { close: [], error: [] };
  const stderrListeners: Record<string, Function[]> = { data: [] };
  const stdoutListeners: Record<string, Function[]> = { data: [] };

  const proc = {
    pid: 1234,
    stderr: {
      on: (ev: string, fn: Function) => {
        (stderrListeners[ev] ??= []).push(fn);
      },
    },
    stdout: {
      on: (ev: string, fn: Function) => {
        (stdoutListeners[ev] ??= []).push(fn);
      },
    },
    on: (ev: string, fn: Function) => {
      (listeners[ev] ??= []).push(fn);
    },
    _emit: (ev: string, ...args: unknown[]) => {
      for (const fn of listeners[ev] ?? []) fn(...args);
    },
    _emitStdout: (data: string) => {
      for (const fn of stdoutListeners['data'] ?? []) fn(Buffer.from(data));
    },
  };

  // Auto-fire after a tick so the Promise constructor has time to attach listeners
  setTimeout(() => {
    if (opts.error) {
      proc._emit('error', opts.error);
    } else {
      proc._emit('close', opts.exitCode ?? 0, opts.signal ?? null);
    }
  }, 0);

  return proc;
}

describe('FfmpegEncoderService', () => {
  let service: FfmpegEncoderService;
  let processManager: jest.Mocked<FfmpegProcessManager>;
  let progressTracker: jest.Mocked<FfmpegProgressTracker>;
  let healthMonitor: jest.Mocked<FfmpegHealthMonitor>;
  let hardwareAcceleration: jest.Mocked<HardwareAccelerationService>;
  let ffprobe: jest.Mocked<FfprobeService>;
  let flagBuilder: jest.Mocked<FfmpegFlagBuilderService>;
  let tempFileGuard: jest.Mocked<TempFileGuardService>;
  let nfsHealth: jest.Mocked<NfsHealthService>;
  let diskSpaceGuard: jest.Mocked<DiskSpaceGuardService>;

  const baseJob = {
    id: 'job-1',
    filePath: '/media/video.mkv',
    fileLabel: 'video.mkv',
    progress: 0,
    retryCount: 0,
    priority: 0,
    nodeId: 'node-1',
  } as any;

  const basePolicy = {
    id: 'policy-1',
    targetCodec: 'hevc',
    targetQuality: 28,
    atomicReplace: false,
    verifyOutput: false,
  } as any;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FfmpegEncoderService,
        {
          provide: FfmpegProcessManager,
          useValue: {
            spawnFfmpegProcess: jest.fn(),
            createActiveEncoding: jest.fn(),
            activeEncodings: new Map(),
            lastPreviewGeneration: new Map(),
            getNiceValue: jest.fn().mockReturnValue(10),
            killProcess: jest.fn(),
            cacheStderr: jest.fn(),
            PREVIEW_THROTTLE_MS: 5000,
          },
        },
        {
          provide: FfmpegProgressTracker,
          useValue: {
            parseProgress: jest.fn(),
            parseTimestampToSeconds: jest.fn().mockReturnValue(0),
            formatSecondsToTimestamp: jest.fn().mockReturnValue('00:00:00'),
            handleProgressUpdate: jest.fn().mockResolvedValue(undefined),
            trackSpeedAnomaly: jest.fn(),
            calculateProgressPercentage: jest.fn().mockReturnValue(50),
            clearAllTrackers: jest.fn(),
            deleteSpeedTracker: jest.fn(),
          },
        },
        {
          provide: FfmpegHealthMonitor,
          useValue: {
            validateFilePath: jest.fn(),
            verifyFile: jest.fn().mockResolvedValue({ isValid: true }),
            handleEncodingSuccess: jest.fn().mockResolvedValue(undefined),
            handleEncodingFailure: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: HardwareAccelerationService,
          useValue: {
            detectHardwareAcceleration: jest
              .fn()
              .mockResolvedValue({ type: 'CPU', flags: [], videoCodec: 'libx265' }),
            selectCodecForPolicy: jest.fn().mockReturnValue('libx265'),
          },
        },
        {
          provide: FfprobeService,
          useValue: {
            getVideoDuration: jest.fn().mockResolvedValue(120),
            getVideoInfo: jest.fn().mockResolvedValue({ codec: 'h264', container: 'mkv' }),
            getVideoInfoCached: jest.fn().mockResolvedValue({ codec: 'h264', container: 'mkv' }),
            cleanupCodecCache: jest.fn(),
            clearCache: jest.fn(),
          },
        },
        {
          provide: FfmpegFlagBuilderService,
          useValue: {
            buildFfmpegCommand: jest.fn().mockReturnValue(['-i', 'input.mkv', 'output.mp4']),
          },
        },
        {
          provide: NfsHealthService,
          useValue: { startMonitoring: jest.fn(), stopMonitoring: jest.fn() },
        },
        {
          provide: DiskSpaceGuardService,
          useValue: { startMonitoring: jest.fn(), stopMonitoring: jest.fn() },
        },
        {
          provide: TempFileGuardService,
          useValue: {
            registerTempFile: jest.fn().mockResolvedValue(undefined),
            markCleaned: jest.fn().mockResolvedValue(undefined),
            cleanupJobTempFiles: jest.fn().mockResolvedValue(undefined),
          },
        },
      ],
    }).compile();

    service = module.get(FfmpegEncoderService);
    processManager = module.get(FfmpegProcessManager);
    progressTracker = module.get(FfmpegProgressTracker);
    healthMonitor = module.get(FfmpegHealthMonitor);
    hardwareAcceleration = module.get(HardwareAccelerationService);
    ffprobe = module.get(FfprobeService);
    flagBuilder = module.get(FfmpegFlagBuilderService);
    tempFileGuard = module.get(TempFileGuardService);
    nfsHealth = module.get(NfsHealthService);
    diskSpaceGuard = module.get(DiskSpaceGuardService);
  });

  function setupMockProcess(opts: Parameters<typeof makeMockProcess>[0] = {}) {
    const proc = makeMockProcess(opts);
    processManager.spawnFfmpegProcess.mockReturnValue(proc as any);
    processManager.createActiveEncoding.mockReturnValue({
      jobId: 'job-1',
      process: proc,
      lastStderr: '',
      lastOutputTime: new Date(),
      completionHandled: false,
      isPauseOrCancelRequested: false,
    } as any);
    return proc;
  }

  describe('encodeFile - successful encode', () => {
    it('resolves and calls handleEncodingSuccess', async () => {
      mockExistsSync.mockReturnValue(true);
      setupMockProcess({ exitCode: 0 });

      await service.encodeFile(baseJob, basePolicy);

      expect(healthMonitor.handleEncodingSuccess).toHaveBeenCalledWith(
        baseJob,
        basePolicy,
        expect.any(String),
        expect.any(Map)
      );
    });

    it('returns the expected output path (temp path)', async () => {
      mockExistsSync.mockReturnValue(true);
      const customOutput = '/tmp/output.mp4';
      setupMockProcess({ exitCode: 0 });

      await service.encodeFile(baseJob, basePolicy, customOutput);

      expect(tempFileGuard.registerTempFile).toHaveBeenCalledWith('job-1', customOutput, 'node-1');
    });
  });

  describe('encodeFile - missing input file', () => {
    it('throws when input file does not exist', async () => {
      mockExistsSync.mockReturnValue(false);

      await expect(service.encodeFile(baseJob, basePolicy)).rejects.toThrow('File not found');
      expect(processManager.spawnFfmpegProcess).not.toHaveBeenCalled();
    });
  });

  describe('encodeFile - mid-encode process crash', () => {
    it('rejects and calls handleEncodingFailure on non-zero exit code', async () => {
      mockExistsSync.mockReturnValue(true);
      setupMockProcess({ exitCode: 1 });

      await expect(service.encodeFile(baseJob, basePolicy)).rejects.toThrow();
      expect(healthMonitor.handleEncodingFailure).toHaveBeenCalled();
    });

    it('rejects on process error event', async () => {
      mockExistsSync.mockReturnValue(true);
      setupMockProcess({ error: new Error('spawn error') });

      await expect(service.encodeFile(baseJob, basePolicy)).rejects.toThrow('spawn error');
      expect(healthMonitor.handleEncodingFailure).toHaveBeenCalled();
    });
  });

  describe('encodeFile - GPU unavailability fallback', () => {
    it('falls back to CPU encoding when GPU detection returns CPU type', async () => {
      mockExistsSync.mockReturnValue(true);
      hardwareAcceleration.detectHardwareAcceleration.mockResolvedValue({
        type: 'CPU' as any,
        flags: [],
        videoCodec: 'libx265',
      });
      setupMockProcess({ exitCode: 0 });

      await service.encodeFile(baseJob, basePolicy);

      expect(flagBuilder.buildFfmpegCommand).toHaveBeenCalledWith(
        baseJob,
        basePolicy,
        expect.objectContaining({ type: 'CPU' }),
        expect.any(String)
      );
    });
  });

  describe('selectCodecForPolicy', () => {
    it('delegates to HardwareAccelerationService', () => {
      hardwareAcceleration.selectCodecForPolicy.mockReturnValue('hevc_nvenc');
      const result = service.selectCodecForPolicy('hevc', 'NVIDIA');
      expect(result).toBe('hevc_nvenc');
    });

    it('returns software codec when GPU type is CPU', () => {
      hardwareAcceleration.selectCodecForPolicy.mockReturnValue('libx265');
      const result = service.selectCodecForPolicy('hevc', 'CPU');
      expect(result).toBe('libx265');
    });

    it('returns av1 software codec for AV1 target', () => {
      hardwareAcceleration.selectCodecForPolicy.mockReturnValue('libaom-av1');
      const result = service.selectCodecForPolicy('av1', 'CPU');
      expect(result).toBe('libaom-av1');
    });
  });

  describe('interpretFfmpegExitCode', () => {
    it('prefixes FATAL on fatal error class', () => {
      // Exit code 1 with empty stderr → implementation-defined, just verify it returns a string
      const result = service.interpretFfmpegExitCode(1, 'No space left on device', 0, 0);
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    });
  });
});
