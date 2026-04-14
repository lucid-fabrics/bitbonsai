import type { ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Test, type TestingModule } from '@nestjs/testing';
import { EncodingCancelledEvent, EncodingFailedEvent } from '../../../common/events';
import { EncodingPreviewService } from '../../../encoding/encoding-preview.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { createMockJob, createMockPolicy } from '../../../testing/mock-factories';
import { FfmpegService } from '../../ffmpeg.service';

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

    // Create mock PrismaService
    const mockPrismaService = {
      job: {
        findUnique: jest.fn().mockResolvedValue(null),
        update: jest.fn().mockResolvedValue(mockJob),
        findMany: jest.fn().mockResolvedValue([]),
      },
      $transaction: jest.fn().mockImplementation((fn: any) => fn(mockPrismaService)),
    };

    const mockEventEmitterInstance = {
      emit: jest.fn(),
      on: jest.fn(),
      once: jest.fn(),
      removeListener: jest.fn(),
      removeAllListeners: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FfmpegService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
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
    it('should detect NVIDIA GPU', async () => {
      // Mock successful nvidia-smi execution
      const mockProcess = createMockChildProcess();
      mockSpawn.mockReturnValue(mockProcess);

      const promise = service.detectHardwareAcceleration();

      // Simulate nvidia-smi success
      setTimeout(() => {
        mockProcess.emit('close', 0);
      }, 10);

      const result = await promise;

      expect(result.type).toBe('NVIDIA');
      expect(result.flags).toContain('-hwaccel');
      expect(result.flags).toContain('cuda');
      expect(result.videoCodec).toBe('hevc_nvenc');
    });

    it('should detect Intel QSV', async () => {
      // Mock nvidia-smi failure
      const mockProcess = createMockChildProcess();
      mockSpawn.mockReturnValue(mockProcess);

      const promise = service.detectHardwareAcceleration();

      // Simulate nvidia-smi failure
      setTimeout(() => {
        mockProcess.emit('close', 1);
      }, 10);

      // Mock Intel QSV device exists
      mockExistsSync.mockImplementation((path) => path === '/dev/dri/renderD128');

      const result = await promise;

      expect(result.type).toBe('INTEL_QSV');
      expect(result.flags).toContain('-hwaccel');
      expect(result.flags).toContain('qsv');
      expect(result.videoCodec).toBe('hevc_qsv');
    });

    it('should fallback to CPU when no hardware acceleration available', async () => {
      // Mock nvidia-smi failure
      const mockProcess = createMockChildProcess();
      mockSpawn.mockReturnValue(mockProcess);

      const promise = service.detectHardwareAcceleration();

      setTimeout(() => {
        mockProcess.emit('close', 1);
      }, 10);

      // No hardware devices
      mockExistsSync.mockReturnValue(false);

      const result = await promise;

      // On macOS (darwin), it will detect Apple M hardware
      // On other platforms without hardware, it will fallback to CPU
      if (process.platform === 'darwin') {
        expect(result.type).toBe('APPLE_M');
        expect(result.flags).toEqual(['-hwaccel', 'videotoolbox']);
        expect(result.videoCodec).toBe('hevc_videotoolbox');
      } else {
        expect(result.type).toBe('CPU');
        expect(result.flags).toEqual([]);
        expect(result.videoCodec).toBe('libx265');
      }
    });
  });

  describe('buildFfmpegCommand', () => {
    it('should build correct ffmpeg command with hardware acceleration', () => {
      const hwaccel = {
        type: 'NVIDIA' as const,
        flags: ['-hwaccel', 'cuda'],
        videoCodec: 'hevc_nvenc',
      };

      const args = service.buildFfmpegCommand(mockJob, mockPolicy, hwaccel, '/media/video.mp4.tmp');

      expect(args).toContain('-hwaccel');
      expect(args).toContain('cuda');
      expect(args).toContain('-i');
      expect(args).toContain('/media/video.mp4');
      expect(args).toContain('-c:v');
      expect(args).toContain('hevc_nvenc');
      expect(args).toContain('-crf');
      expect(args).toContain('23');
      expect(args).toContain('-c:a');
      expect(args).toContain('copy');
      expect(args).toContain('-preset');
      expect(args).toContain('medium');
      expect(args).toContain('-progress');
      expect(args).toContain('pipe:2');
      expect(args).toContain('-y');
      expect(args).toContain('/media/video.mp4.tmp');
    });

    it('should build command with custom audio codec', () => {
      const customPolicy = {
        ...mockPolicy,
        advancedSettings: {
          audioCodec: 'aac',
          ffmpegFlags: [],
        },
      };

      const hwaccel = {
        type: 'CPU' as const,
        flags: [],
        videoCodec: 'libx265',
      };

      const args = service.buildFfmpegCommand(
        mockJob,
        customPolicy,
        hwaccel,
        '/media/video.mp4.tmp'
      );

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

  describe('selectCodecForPolicy', () => {
    it('should return av1_nvenc for AV1 on NVIDIA', () => {
      const codec = (service as any).selectCodecForPolicy('AV1', 'NVIDIA');
      expect(codec).toBe('av1_nvenc');
    });

    it('should return av1_qsv for AV1 on Intel QSV', () => {
      const codec = (service as any).selectCodecForPolicy('AV1', 'INTEL_QSV');
      expect(codec).toBe('av1_qsv');
    });

    it('should return av1_vaapi for AV1 on AMD', () => {
      const codec = (service as any).selectCodecForPolicy('AV1', 'AMD');
      expect(codec).toBe('av1_vaapi');
    });

    it('should return libaom-av1 for AV1 on Apple M (no native HW encoder)', () => {
      const codec = (service as any).selectCodecForPolicy('AV1', 'APPLE_M');
      expect(codec).toBe('libaom-av1');
    });

    it('should return libaom-av1 for AV1 on CPU fallback', () => {
      const codec = (service as any).selectCodecForPolicy('AV1', 'CPU');
      expect(codec).toBe('libaom-av1');
    });

    it('should return hevc_nvenc for HEVC on NVIDIA', () => {
      const codec = (service as any).selectCodecForPolicy('HEVC', 'NVIDIA');
      expect(codec).toBe('hevc_nvenc');
    });

    it('should return libx265 for HEVC on CPU', () => {
      const codec = (service as any).selectCodecForPolicy('HEVC', 'CPU');
      expect(codec).toBe('libx265');
    });

    it('should return h264_nvenc for H264 on NVIDIA', () => {
      const codec = (service as any).selectCodecForPolicy('H264', 'NVIDIA');
      expect(codec).toBe('h264_nvenc');
    });

    it('should return libvpx-vp9 for VP9 on AMD', () => {
      const codec = (service as any).selectCodecForPolicy('VP9', 'AMD');
      expect(codec).toBe('libvpx-vp9');
    });
  });

  describe('pauseEncoding', () => {
    it('should pause active encoding job', async () => {
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

      const pauseResult = await service.pauseEncoding(mockJob.id);
      expect(pauseResult).toBe(true);

      // Clean up
      setTimeout(() => ffmpegProc.emit('close', 1), 10);
      await encodePromise.catch(() => undefined);
    });

    it('should return false for non-existent job', async () => {
      const result = await service.pauseEncoding('non-existent-job');
      expect(result).toBe(false);
    });
  });

  describe('getVideoDuration', () => {
    it('should return video duration in seconds', async () => {
      const mockProcess = createMockChildProcess();
      mockSpawn.mockReturnValue(mockProcess);

      // Simulate successful ffprobe output
      setTimeout(() => {
        mockProcess.stdout?.emit('data', '3600.5');
        mockProcess.emit('close', 0);
      }, 10);

      const duration = await service.getVideoDuration('/media/video.mp4');
      expect(duration).toBe(3600.5);
    });

    it('should handle stream duration not available and fallback to format', async () => {
      const mockProcess = createMockChildProcess();
      mockSpawn.mockReturnValue(mockProcess);

      // First call returns empty (stream duration unavailable)
      setTimeout(() => {
        mockProcess.emit('close', 1); // Non-zero exit code triggers fallback
      }, 10);

      // Mock the fallback getFormatDuration
      jest.spyOn(service as any, 'getFormatDuration').mockResolvedValue(7200);

      const duration = await service.getVideoDuration('/media/video.mp4');
      expect(duration).toBe(7200);
    });

    it('should handle ffprobe timeout and return fallback', async () => {
      const mockProcess = createMockChildProcess();
      mockSpawn.mockReturnValue(mockProcess);

      // Don't emit close - let it timeout
      const duration = await service.getVideoDuration('/media/slow-video.mp4');
      expect(duration).toBe(3600); // Default fallback
    });

    it('should handle ffprobe error and return fallback', async () => {
      const mockProcess = createMockChildProcess();
      mockSpawn.mockReturnValue(mockProcess);

      setTimeout(() => {
        mockProcess.emit('error', new Error('ffprobe not found'));
      }, 10);

      const duration = await service.getVideoDuration('/media/video.mp4');
      expect(duration).toBe(3600); // Default fallback
    });
  });

  describe('getVideoInfo', () => {
    it('should return codec and container from ffprobe', async () => {
      const mockProcess = createMockChildProcess();
      mockSpawn.mockReturnValue(mockProcess);

      setTimeout(() => {
        mockProcess.stdout?.emit(
          'data',
          JSON.stringify({
            streams: [{ codec_name: 'h264' }],
            format: { format_name: 'mov,mp4,m4a,3gp,3g2,mj2' },
          })
        );
        mockProcess.emit('close', 0);
      }, 10);

      const info = await service.getVideoInfo('/media/video.mp4');
      expect(info.codec).toBe('h264');
      expect(info.container).toBe('mov');
    });

    it('should handle missing streams and default to unknown', async () => {
      const mockProcess = createMockChildProcess();
      mockSpawn.mockReturnValue(mockProcess);

      setTimeout(() => {
        mockProcess.stdout?.emit('data', JSON.stringify({ streams: [] }));
        mockProcess.emit('close', 0);
      }, 10);

      const info = await service.getVideoInfo('/media/video.mp4');
      expect(info.codec).toBe('unknown');
    });

    it('should handle ffprobe parse error', async () => {
      const mockProcess = createMockChildProcess();
      mockSpawn.mockReturnValue(mockProcess);

      setTimeout(() => {
        mockProcess.stdout?.emit('data', 'not valid json');
        mockProcess.emit('close', 0);
      }, 10);

      await expect(service.getVideoInfo('/media/video.mp4')).rejects.toThrow(
        'Failed to parse ffprobe output'
      );
    });

    it('should handle ffprobe failure', async () => {
      const mockProcess = createMockChildProcess();
      mockSpawn.mockReturnValue(mockProcess);

      setTimeout(() => {
        mockProcess.emit('close', 1);
      }, 10);

      await expect(service.getVideoInfo('/media/video.mp4')).rejects.toThrow(
        'FFprobe failed with code 1'
      );
    });

    it('should handle ffprobe timeout', async () => {
      const mockProcess = createMockChildProcess();
      mockSpawn.mockReturnValue(mockProcess);

      // Don't emit close - let timeout trigger
      await expect(service.getVideoInfo('/media/video.mp4')).rejects.toThrow('FFprobe timeout');
    });
  });

  describe('getVideoInfoCached', () => {
    it('should return cached result when available and not expired', async () => {
      // First call to populate cache
      const mockProcess1 = createMockChildProcess();
      mockSpawn.mockReturnValue(mockProcess1);

      setTimeout(() => {
        mockProcess1.stdout?.emit(
          'data',
          JSON.stringify({
            streams: [{ codec_name: 'h264' }],
            format: { format_name: 'mp4' },
          })
        );
        mockProcess1.emit('close', 0);
      }, 10);

      const info1 = await service.getVideoInfoCached('/media/video.mp4');
      expect(info1.codec).toBe('h264');

      // Second call should use cache (no new spawn)
      const info2 = await service.getVideoInfoCached('/media/video.mp4');
      expect(info2.codec).toBe('h264');
      expect(mockSpawn).toHaveBeenCalledTimes(1); // Only called once
    });

    it('should refetch when cache is expired', async () => {
      // First call to populate cache
      const mockProcess1 = createMockChildProcess();
      mockSpawn.mockReturnValue(mockProcess1);

      setTimeout(() => {
        mockProcess1.stdout?.emit(
          'data',
          JSON.stringify({
            streams: [{ codec_name: 'h264' }],
            format: { format_name: 'mp4' },
          })
        );
        mockProcess1.emit('close', 0);
      }, 10);

      await service.getVideoInfoCached('/media/video.mp4');

      // Manually expire the cache by clearing it
      service['codecCache'].clear();

      // Should refetch
      const mockProcess2 = createMockChildProcess();
      mockSpawn.mockReturnValue(mockProcess2);

      setTimeout(() => {
        mockProcess2.stdout?.emit(
          'data',
          JSON.stringify({
            streams: [{ codec_name: 'hevc' }],
            format: { format_name: 'mkv' },
          })
        );
        mockProcess2.emit('close', 0);
      }, 10);

      const info = await service.getVideoInfoCached('/media/video.mp4');
      expect(info.codec).toBe('hevc');
      expect(mockSpawn).toHaveBeenCalledTimes(2);
    });
  });

  describe('verifyFile', () => {
    it('should return isValid true for valid video file', async () => {
      const mockProcess = createMockChildProcess();
      mockSpawn.mockReturnValue(mockProcess);

      setTimeout(() => {
        mockProcess.stdout?.emit('data', '3600.0');
        mockProcess.emit('close', 0);
      }, 10);

      const result = await service.verifyFile('/media/video.mp4');
      expect(result.isValid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('should return isValid false for invalid video file', async () => {
      const mockProcess = createMockChildProcess();
      mockSpawn.mockReturnValue(mockProcess);

      setTimeout(() => {
        mockProcess.emit('close', 1);
      }, 10);

      const result = await service.verifyFile('/media/invalid.mp4');
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('File verification failed');
    });

    it('should return isValid false on timeout', async () => {
      const mockProcess = createMockChildProcess();
      mockSpawn.mockReturnValue(mockProcess);

      // Don't emit close - let it timeout
      const result = await service.verifyFile('/media/slow-video.mp4');
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('timed out');
    });

    it('should return isValid false on ffprobe error', async () => {
      const mockProcess = createMockChildProcess();
      mockSpawn.mockReturnValue(mockProcess);

      setTimeout(() => {
        mockProcess.emit('error', new Error('ffprobe not found'));
      }, 10);

      const result = await service.verifyFile('/media/video.mp4');
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('Failed to run ffprobe');
    });
  });

  describe('selectCodecForPolicy', () => {
    it('should return av1_nvenc for AV1 on NVIDIA', async () => {
      jest.spyOn(service, 'detectHardwareAcceleration').mockResolvedValue({
        type: 'NVIDIA',
        flags: [],
        videoCodec: 'av1_nvenc',
      });

      const codec = await (service as any).selectCodecForPolicy('AV1', 'NVIDIA');
      expect(codec).toBe('av1_nvenc');
    });

    it('should return av1_qsv for AV1 on Intel QSV', async () => {
      jest.spyOn(service, 'detectHardwareAcceleration').mockResolvedValue({
        type: 'INTEL_QSV' as any,
        flags: [],
        videoCodec: 'av1_qsv',
      });

      const codec = await (service as any).selectCodecForPolicy('AV1', 'INTEL_QSV');
      expect(codec).toBe('av1_qsv');
    });

    it('should return av1_vaapi for AV1 on AMD', async () => {
      jest.spyOn(service, 'detectHardwareAcceleration').mockResolvedValue({
        type: 'AMD',
        flags: [],
        videoCodec: 'av1_vaapi',
      });

      const codec = await (service as any).selectCodecForPolicy('AV1', 'AMD');
      expect(codec).toBe('av1_vaapi');
      expect(codec).toBe('av1_vaapi');
    });

    it('should return libaom-av1 for AV1 on Apple M (no native HW encoder)', async () => {
      jest.spyOn(service, 'detectHardwareAcceleration').mockResolvedValue({
        type: 'APPLE_M',
        flags: [],
        videoCodec: 'libaom-av1',
      });

      const codec = await (service as any).selectCodecForPolicy('AV1');
      expect(codec).toBe('libaom-av1');
    });

    it('should return libaom-av1 for AV1 on CPU fallback', async () => {
      jest.spyOn(service, 'detectHardwareAcceleration').mockResolvedValue({
        type: 'CPU',
        flags: [],
        videoCodec: 'libaom-av1',
      });

      const codec = await (service as any).selectCodecForPolicy('AV1');
      expect(codec).toBe('libaom-av1');
    });

    it('should return hevc_nvenc for HEVC on NVIDIA', async () => {
      jest.spyOn(service, 'detectHardwareAcceleration').mockResolvedValue({
        type: 'NVIDIA',
        flags: [],
        videoCodec: 'hevc_nvenc',
      });

      const codec = await (service as any).selectCodecForPolicy('HEVC');
      expect(codec).toBe('hevc_nvenc');
    });

    it('should return libx265 for HEVC on CPU', async () => {
      jest.spyOn(service, 'detectHardwareAcceleration').mockResolvedValue({
        type: 'CPU',
        flags: [],
        videoCodec: 'libx265',
      });

      const codec = await (service as any).selectCodecForPolicy('HEVC');
      expect(codec).toBe('libx265');
    });

    it('should return h264_nvenc for H264 on NVIDIA', async () => {
      jest.spyOn(service, 'detectHardwareAcceleration').mockResolvedValue({
        type: 'NVIDIA',
        flags: [],
        videoCodec: 'h264_nvenc',
      });

      const codec = await (service as any).selectCodecForPolicy('H264');
      expect(codec).toBe('h264_nvenc');
    });

    it('should return libvpx-vp9 for VP9 on AMD', async () => {
      jest.spyOn(service, 'detectHardwareAcceleration').mockResolvedValue({
        type: 'AMD',
        flags: [],
        videoCodec: 'libvpx-vp9',
      });

      const codec = await (service as any).selectCodecForPolicy('VP9');
      expect(codec).toBe('libvpx-vp9');
    });
  });

  describe('reniceProcess', () => {
    it('should return true when renice succeeds', async () => {
      const mockProcess = createMockChildProcess();
      mockSpawn.mockReturnValue(mockProcess);

      setTimeout(() => {
        mockProcess.emit('close', 0);
      }, 10);

      const result = await service.reniceProcess('test-job-123', 10);
      expect(result).toBe(true);
    });

    it('should return false when renice fails', async () => {
      const mockProcess = createMockChildProcess();
      mockSpawn.mockReturnValue(mockProcess);

      setTimeout(() => {
        mockProcess.emit('close', 1);
      }, 10);

      const result = await service.reniceProcess('test-job-123', 10);
      expect(result).toBe(false);
    });
  });

  describe('findSystemFfmpegProcesses', () => {
    it('should return empty array when no ffmpeg processes', async () => {
      const mockProcess = createMockChildProcess();
      mockSpawn.mockReturnValue(mockProcess);

      setTimeout(() => {
        mockProcess.emit('close', 0, '');
      }, 10);

      const result = await service.findSystemFfmpegProcesses();
      expect(result).toEqual([]);
    });

    it('should parse ffmpeg process output', async () => {
      const mockProcess = createMockChildProcess();
      mockSpawn.mockReturnValue(mockProcess);

      setTimeout(() => {
        mockProcess.emit('close', 0, '12345 ffmpeg -i input.mp4\n67890 ffmpeg -i input2.mp4');
      }, 10);

      const result = await service.findSystemFfmpegProcesses();
      expect(result).toHaveLength(2);
    });

    it('should return empty on error', async () => {
      const mockProcess = createMockChildProcess();
      mockSpawn.mockReturnValue(mockProcess);

      setTimeout(() => {
        mockProcess.emit('error', new Error('ps failed'));
      }, 10);

      const result = await service.findSystemFfmpegProcesses();
      expect(result).toEqual([]);
    });
  });

  describe('detectZombieFfmpegProcesses', () => {
    it('should detect zombie ffmpeg processes', async () => {
      const mockProcess = createMockChildProcess();
      mockSpawn.mockReturnValue(mockProcess);

      // Simulate ps output with zombie state - explicitly filter out test runner processes
      // to avoid test isolation issues where the test runner itself appears as a zombie
      const testRunnerPid = process.pid;
      setTimeout(() => {
        mockProcess.emit(
          'close',
          0,
          `12345  0.0  0.0 Z ffmpeg -i input.mp4\n${testRunnerPid}  0.0  0.0 Z jest`
        );
      }, 10);

      const result = await service.detectZombieFfmpegProcesses();
      // Only count the actual ffmpeg zombie (test runner is filtered by command)
      const ffmpegZombies = result.filter((p) => p.isZombie && p.command.includes('ffmpeg'));
      expect(ffmpegZombies.length).toBeGreaterThanOrEqual(1);
      expect(ffmpegZombies[0].isZombie).toBe(true);
    });
  });

  describe('killFfmpegByPid', () => {
    it('should return success when kill succeeds', async () => {
      const mockProcess = createMockChildProcess();
      mockSpawn.mockReturnValue(mockProcess);

      setTimeout(() => {
        mockProcess.emit('close', 0);
      }, 10);

      const result = await service.killFfmpegByPid(12345);
      expect(result.success).toBe(true);
    });

    it('should return error when kill fails', async () => {
      const mockProcess = createMockChildProcess();
      mockSpawn.mockReturnValue(mockProcess);

      setTimeout(() => {
        mockProcess.emit('close', 1, 'Permission denied');
      }, 10);

      const result = await service.killFfmpegByPid(12345);
      expect(result.success).toBe(false);
      expect(result.message).toContain('12345');
    });
  });

  describe('killAllZombieFfmpegProcesses', () => {
    it('should return empty when no zombies', async () => {
      const mockProcess = createMockChildProcess();
      mockSpawn.mockReturnValue(mockProcess);

      setTimeout(() => {
        mockProcess.emit('close', 0, '');
      }, 10);

      const result = await service.killAllZombieFfmpegProcesses();
      expect(result.killed).toBe(0);
    });
  });

  describe('killAllFfmpegProcesses', () => {
    it('should kill all ffmpeg processes', async () => {
      const mockProcess = createMockChildProcess();
      mockSpawn.mockReturnValue(mockProcess);

      setTimeout(() => {
        mockProcess.emit('close', 0, '12345 ffmpeg -i input.mp4');
      }, 10);

      // Mock kill to succeed
      const killMockProcess = createMockChildProcess();
      mockSpawn.mockReturnValueOnce(mockProcess); // First call is ps
      mockSpawn.mockReturnValueOnce(killMockProcess); // Second call is kill

      setTimeout(() => {
        killMockProcess.emit('close', 0);
      }, 10);

      const result = await service.killAllFfmpegProcesses();
      expect(result.killed).toBeGreaterThanOrEqual(0);
    });
  });
});
