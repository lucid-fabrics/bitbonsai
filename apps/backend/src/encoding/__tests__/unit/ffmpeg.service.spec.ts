import type { ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Test, type TestingModule } from '@nestjs/testing';
import { EncodingCancelledEvent, EncodingFailedEvent } from '../../../common/events';
import { JobRepository } from '../../../common/repositories/job.repository';
import { EncodingPreviewService } from '../../../encoding/encoding-preview.service';
import { createMockJob, createMockPolicy } from '../../../testing/mock-factories';
import { FfmpegService } from '../../ffmpeg.service';
import { FfmpegFlagBuilderService } from '../../ffmpeg-flag-builder.service';
import { HardwareAccelerationService } from '../../hardware-acceleration.service';

// Mock child_process spawn (keep original exec for Prisma compatibility)
jest.mock('node:child_process', () => {
  const actual = jest.requireActual('node:child_process');
  return {
    ...actual,
    spawn: jest.fn(),
  };
});

// Mock fs
jest.mock('node:fs', () => ({
  existsSync: jest.fn(),
  promises: {
    stat: jest.fn(),
    rename: jest.fn(),
    unlink: jest.fn(),
  },
}));

/**
 * Creates a mock ChildProcess with stdout, stderr (with destroy), and kill.
 */
function createMockChildProcess(): ChildProcess {
  const proc = new EventEmitter() as ChildProcess;
  const stdout = new EventEmitter();
  (stdout as any).destroy = jest.fn();
  const stderr = new EventEmitter();
  (stderr as any).destroy = jest.fn();
  (proc as any).stdout = stdout;
  (proc as any).stderr = stderr;
  (proc as any).kill = jest.fn();
  (proc as any).killed = false;
  return proc;
}

describe('FfmpegService', () => {
  let service: FfmpegService;
  let module: TestingModule;
  let eventEmitter: jest.Mocked<EventEmitter2>;
  let mockSpawn: jest.Mock;
  let mockExistsSync: jest.Mock;
  let mockFs: {
    stat: jest.Mock;
    rename: jest.Mock;
    unlink: jest.Mock;
  };

  // Mock job and policy using factories for complete type coverage
  const mockJob = createMockJob({
    id: 'test-job-123',
    filePath: '/media/video.mp4',
    fileLabel: 'Test Video.mp4',
    sourceCodec: 'H.264',
    targetCodec: 'HEVC',
    stage: 'ENCODING' as any,
    beforeSizeBytes: BigInt(1000000000),
    startedAt: new Date(),
    nodeId: 'node-1',
    libraryId: 'library-1',
    policyId: 'policy-1',
  });

  const mockPolicy = createMockPolicy({
    id: 'policy-1',
    advancedSettings: {
      audioCodec: 'copy',
      ffmpegFlags: ['-preset', 'medium'],
    },
  });

  beforeEach(async () => {
    // Reset mocks
    jest.clearAllMocks();

    // Get mock references
    const childProcess = await import('node:child_process');
    mockSpawn = childProcess.spawn as jest.Mock;

    const fs = await import('node:fs');
    mockExistsSync = fs.existsSync as jest.Mock;
    mockFs = {
      stat: fs.promises.stat as jest.Mock,
      rename: fs.promises.rename as jest.Mock,
      unlink: fs.promises.unlink as jest.Mock,
    };

    const mockEventEmitterInstance = {
      emit: jest.fn(),
      on: jest.fn(),
      once: jest.fn(),
      removeListener: jest.fn(),
      removeAllListeners: jest.fn(),
    };

    module = await Test.createTestingModule({
      providers: [
        FfmpegService,
        {
          provide: JobRepository,
          useValue: {
            findById: jest.fn().mockResolvedValue(null),
            updateById: jest.fn().mockResolvedValue(mockJob),
            findManyWithInclude: jest.fn().mockResolvedValue([]),
          },
        },
        {
          provide: EventEmitter2,
          useValue: mockEventEmitterInstance,
        },
        {
          provide: EncodingPreviewService,
          useValue: {
            generatePreview: jest.fn(),
            cleanupPreviews: jest.fn(),
          },
        },
        {
          provide: HardwareAccelerationService,
          useValue: {
            detectHardwareAcceleration: jest.fn().mockResolvedValue({
              type: 'CPU',
              flags: [],
              videoCodec: 'libx265',
            }),
          },
        },
        {
          provide: FfmpegFlagBuilderService,
          useValue: {
            ALLOWED_FFMPEG_FLAGS: new Set<string>(),
            validateFfmpegFlags: jest.fn().mockImplementation((f: string[]) => f),
            selectCodecForPolicy: jest.fn().mockReturnValue('libx265'),
            buildFfmpegCommand: jest.fn().mockReturnValue(['-i', 'input', 'output']),
          },
        },
      ],
    }).compile();

    service = module.get<FfmpegService>(FfmpegService);
    eventEmitter = module.get(EventEmitter2) as jest.Mocked<EventEmitter2>;

    // Default mock implementations
    mockExistsSync.mockReturnValue(true);
    mockFs.stat.mockResolvedValue({ size: 500000000 } as never);
    mockFs.rename.mockResolvedValue(undefined as never);
    mockFs.unlink.mockResolvedValue(undefined as never);
  });

  describe('detectHardwareAcceleration', () => {
    let hardwareAccelerationService: { detectHardwareAcceleration: jest.Mock };

    beforeEach(() => {
      hardwareAccelerationService = module.get(HardwareAccelerationService) as any;
    });

    it('should detect NVIDIA GPU', async () => {
      hardwareAccelerationService.detectHardwareAcceleration.mockResolvedValue({
        type: 'NVIDIA',
        flags: ['-hwaccel', 'cuda'],
        videoCodec: 'hevc_nvenc',
      });

      const result = await service.detectHardwareAcceleration();

      expect(result.type).toBe('NVIDIA');
      expect(result.flags).toContain('-hwaccel');
      expect(result.flags).toContain('cuda');
      expect(result.videoCodec).toBe('hevc_nvenc');
    });

    it('should detect Intel QSV', async () => {
      hardwareAccelerationService.detectHardwareAcceleration.mockResolvedValue({
        type: 'INTEL_QSV',
        flags: ['-hwaccel', 'qsv'],
        videoCodec: 'hevc_qsv',
      });

      const result = await service.detectHardwareAcceleration();

      expect(result.type).toBe('INTEL_QSV');
      expect(result.flags).toContain('-hwaccel');
      expect(result.flags).toContain('qsv');
      expect(result.videoCodec).toBe('hevc_qsv');
    });

    it('should fallback to CPU when no hardware acceleration available', async () => {
      hardwareAccelerationService.detectHardwareAcceleration.mockResolvedValue({
        type: 'CPU',
        flags: [],
        videoCodec: 'libx265',
      });

      const result = await service.detectHardwareAcceleration();

      expect(result.type).toBe('CPU');
      expect(result.flags).toEqual([]);
      expect(result.videoCodec).toBe('libx265');
    });
  });

  describe('buildFfmpegCommand', () => {
    let flagBuilderService: { buildFfmpegCommand: jest.Mock };

    beforeEach(() => {
      flagBuilderService = module.get(FfmpegFlagBuilderService) as any;
    });

    it('should delegate to FfmpegFlagBuilderService', () => {
      const hwaccel = {
        type: 'NVIDIA' as const,
        flags: ['-hwaccel', 'cuda'],
        videoCodec: 'hevc_nvenc',
      };

      flagBuilderService.buildFfmpegCommand.mockReturnValue([
        '-hwaccel',
        'cuda',
        '-i',
        '/media/video.mp4',
        '-c:v',
        'hevc_nvenc',
        '-y',
        '/media/video.mp4.tmp',
      ]);

      const args = service.buildFfmpegCommand(mockJob, mockPolicy, hwaccel, '/media/video.mp4.tmp');

      expect(flagBuilderService.buildFfmpegCommand).toHaveBeenCalled();
      expect(args).toContain('-hwaccel');
      expect(args).toContain('cuda');
    });

    it('should return args from FfmpegFlagBuilderService for custom audio codec', () => {
      const hwaccel = {
        type: 'CPU' as const,
        flags: [],
        videoCodec: 'libx265',
      };

      flagBuilderService.buildFfmpegCommand.mockReturnValue([
        '-i',
        '/media/video.mp4',
        '-c:a',
        'aac',
        '-y',
        '/media/video.mp4.tmp',
      ]);

      const args = service.buildFfmpegCommand(mockJob, mockPolicy, hwaccel, '/media/video.mp4.tmp');

      expect(args).toContain('-c:a');
      expect(args).toContain('aac');
    });
  });

  describe('parseProgress', () => {
    it('should parse valid ffmpeg progress line', () => {
      const line =
        'frame= 2450 fps= 87.3 q=28.0 size=   12288kB time=00:01:42.50 bitrate=1234.5kbits/s';
      const result = service.parseProgress(line);

      expect(result).not.toBeNull();
      expect(result?.frame).toBe(2450);
      expect(result?.fps).toBe(87.3);
      expect(result?.currentTime).toBe('00:01:42.50');
    });

    it('should return null for non-progress lines', () => {
      const line = 'ffmpeg version 6.0 Copyright (c) 2000-2023';
      const result = service.parseProgress(line);

      expect(result).toBeNull();
    });

    it('should handle progress lines with different spacing', () => {
      const line = 'frame=1234 fps=45.6 time=00:05:23.10';
      const result = service.parseProgress(line);

      expect(result).not.toBeNull();
      expect(result?.frame).toBe(1234);
      expect(result?.fps).toBe(45.6);
      expect(result?.currentTime).toBe('00:05:23.10');
    });
  });

  describe('encodeFile', () => {
    it('should start encoding and register active encoding', async () => {
      jest.spyOn(service, 'detectHardwareAcceleration').mockResolvedValue({
        type: 'CPU',
        flags: [],
        videoCodec: 'libx265',
      });
      jest.spyOn(service, 'getVideoDuration').mockResolvedValue(3600);

      const ffmpegProc = createMockChildProcess();
      mockSpawn.mockReturnValue(ffmpegProc);

      const encodePromise = service.encodeFile(mockJob, mockPolicy);

      await new Promise((resolve) => setTimeout(resolve, 10));

      const activeJobs = service.getActiveEncodings();
      expect(activeJobs).toContain(mockJob.id);

      // Clean up - simulate failure to avoid handleEncodingSuccess hanging
      setTimeout(() => ffmpegProc.emit('close', 1), 10);
      await encodePromise.catch(() => undefined);
    });

    it('should parse stderr data during encoding', async () => {
      jest.spyOn(service, 'detectHardwareAcceleration').mockResolvedValue({
        type: 'CPU',
        flags: [],
        videoCodec: 'libx265',
      });
      jest.spyOn(service, 'getVideoDuration').mockResolvedValue(3600);

      const ffmpegProc = createMockChildProcess();
      mockSpawn.mockReturnValue(ffmpegProc);

      const encodePromise = service.encodeFile(mockJob, mockPolicy);

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect((ffmpegProc.stderr as EventEmitter).listenerCount('data')).toBeGreaterThan(0);

      // Clean up
      setTimeout(() => ffmpegProc.emit('close', 1), 10);
      await encodePromise.catch(() => undefined);
    });

    it('should handle encoding failure', async () => {
      jest.spyOn(service, 'detectHardwareAcceleration').mockResolvedValue({
        type: 'CPU',
        flags: [],
        videoCodec: 'libx265',
      });
      jest.spyOn(service, 'getVideoDuration').mockResolvedValue(3600);

      const ffmpegProc = createMockChildProcess();
      mockSpawn.mockReturnValue(ffmpegProc);

      const encodePromise = service.encodeFile(mockJob, mockPolicy);

      await new Promise((resolve) => setTimeout(resolve, 10));

      // Simulate ffmpeg failure
      ffmpegProc.emit('close', 1);

      await expect(encodePromise).rejects.toThrow();
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        EncodingFailedEvent.event,
        expect.any(EncodingFailedEvent)
      );
    });

    it('should handle file not found error', async () => {
      mockExistsSync.mockReturnValue(false);

      await expect(service.encodeFile(mockJob, mockPolicy)).rejects.toThrow(
        'File not found: /media/video.mp4'
      );
    });

    it('should handle process spawn error', async () => {
      jest.spyOn(service, 'detectHardwareAcceleration').mockResolvedValue({
        type: 'CPU',
        flags: [],
        videoCodec: 'libx265',
      });
      jest.spyOn(service, 'getVideoDuration').mockResolvedValue(3600);

      const ffmpegProc = createMockChildProcess();
      mockSpawn.mockReturnValue(ffmpegProc);

      const encodePromise = service.encodeFile(mockJob, mockPolicy);

      await new Promise((resolve) => setTimeout(resolve, 10));

      // Simulate spawn error
      ffmpegProc.emit('error', new Error('spawn ffmpeg ENOENT'));

      await expect(encodePromise).rejects.toThrow('spawn ffmpeg ENOENT');
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        EncodingFailedEvent.event,
        expect.any(EncodingFailedEvent)
      );
    });
  });

  describe('cancelEncoding', () => {
    it('should cancel active encoding', async () => {
      mockExistsSync.mockReturnValue(true);
      mockFs.stat.mockResolvedValue({ size: 500000000 } as never);

      jest.spyOn(service, 'detectHardwareAcceleration').mockResolvedValue({
        type: 'CPU',
        flags: [],
        videoCodec: 'libx265',
      });
      jest.spyOn(service, 'getVideoDuration').mockResolvedValue(3600);

      const ffmpegProc = createMockChildProcess();
      mockSpawn.mockReturnValue(ffmpegProc);

      const encodePromise = service.encodeFile(mockJob, mockPolicy);

      await new Promise((resolve) => setTimeout(resolve, 10));

      const cancelPromise = service.cancelEncoding(mockJob.id);

      setTimeout(() => {
        (ffmpegProc as any).killed = true;
      }, 10);

      const result = await cancelPromise;

      expect(result).toBe(true);
      expect((ffmpegProc as any).kill).toHaveBeenCalledWith('SIGTERM');
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        EncodingCancelledEvent.event,
        expect.any(EncodingCancelledEvent)
      );

      // Clean up the encoding promise
      setTimeout(() => ffmpegProc.emit('close', 1), 10);
      await encodePromise.catch(() => {
        // Ignore error from cancelled job
      });
    });

    it('should return false when job is not encoding', async () => {
      const result = await service.cancelEncoding('non-existent-job');
      expect(result).toBe(false);
    });
  });

  describe('getActiveEncodings', () => {
    it('should return empty array when no encodings active', () => {
      const activeJobs = service.getActiveEncodings();
      expect(activeJobs).toEqual([]);
    });

    it('should return active job IDs', async () => {
      jest.spyOn(service, 'detectHardwareAcceleration').mockResolvedValue({
        type: 'CPU',
        flags: [],
        videoCodec: 'libx265',
      });
      jest.spyOn(service, 'getVideoDuration').mockResolvedValue(3600);

      const ffmpegProc = createMockChildProcess();
      mockSpawn.mockReturnValue(ffmpegProc);

      const encodePromise = service.encodeFile(mockJob, mockPolicy);

      await new Promise((resolve) => setTimeout(resolve, 10));

      const activeJobs = service.getActiveEncodings();
      expect(activeJobs).toContain(mockJob.id);

      // Clean up
      setTimeout(() => ffmpegProc.emit('close', 1), 10);
      await encodePromise.catch(() => undefined);
    });
  });

  describe('getEncodingStatus', () => {
    it('should return null for non-active job', () => {
      const status = service.getEncodingStatus('non-existent-job');
      expect(status).toBeNull();
    });

    it('should return status for active encoding', async () => {
      jest.spyOn(service, 'detectHardwareAcceleration').mockResolvedValue({
        type: 'CPU',
        flags: [],
        videoCodec: 'libx265',
      });
      jest.spyOn(service, 'getVideoDuration').mockResolvedValue(3600);

      const ffmpegProc = createMockChildProcess();
      mockSpawn.mockReturnValue(ffmpegProc);

      const encodePromise = service.encodeFile(mockJob, mockPolicy);

      await new Promise((resolve) => setTimeout(resolve, 10));

      const status = service.getEncodingStatus(mockJob.id);
      expect(status).not.toBeNull();
      expect(status?.jobId).toBe(mockJob.id);
      expect(status?.startTime).toBeInstanceOf(Date);
      expect(status?.elapsedSeconds).toBeGreaterThanOrEqual(0);

      // Clean up
      setTimeout(() => ffmpegProc.emit('close', 1), 10);
      await encodePromise.catch(() => undefined);
    });
  });
});
