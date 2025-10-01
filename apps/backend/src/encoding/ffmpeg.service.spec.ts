import type { ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Test, type TestingModule } from '@nestjs/testing';
import type { Job, Policy } from '@prisma/client';
import { QueueService } from '../queue/queue.service';
import { FfmpegService } from './ffmpeg.service';

// Mock Prisma first to avoid import issues
jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn(),
  JobStage: {
    PENDING: 'PENDING',
    ENCODING: 'ENCODING',
    VERIFYING: 'VERIFYING',
    COMPLETED: 'COMPLETED',
    FAILED: 'FAILED',
    CANCELLED: 'CANCELLED',
  },
}));

// Mock child_process spawn
jest.mock('node:child_process', () => ({
  spawn: jest.fn(),
}));

// Mock fs
jest.mock('node:fs', () => ({
  existsSync: jest.fn(),
  promises: {
    stat: jest.fn(),
    rename: jest.fn(),
    unlink: jest.fn(),
  },
}));

describe('FfmpegService', () => {
  let service: FfmpegService;
  let queueService: jest.Mocked<QueueService>;
  let eventEmitter: jest.Mocked<EventEmitter2>;
  let mockSpawn: jest.Mock;
  let mockExistsSync: jest.Mock;
  let mockFs: {
    stat: jest.Mock;
    rename: jest.Mock;
    unlink: jest.Mock;
  };

  // Mock job and policy
  const mockJob: Job = {
    id: 'test-job-123',
    filePath: '/media/video.mp4',
    fileLabel: 'Test Video.mp4',
    sourceCodec: 'H.264',
    targetCodec: 'HEVC',
    stage: 'ENCODING',
    progress: 0,
    etaSeconds: null,
    beforeSizeBytes: BigInt(1000000000),
    afterSizeBytes: null,
    savedBytes: null,
    savedPercent: null,
    startedAt: new Date(),
    completedAt: null,
    error: null,
    nodeId: 'node-1',
    libraryId: 'library-1',
    policyId: 'policy-1',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockPolicy: Policy = {
    id: 'policy-1',
    name: 'Balanced HEVC',
    preset: 'BALANCED_HEVC',
    targetCodec: 'HEVC',
    targetQuality: 23,
    deviceProfiles: {},
    advancedSettings: {
      audioCodec: 'copy',
      ffmpegFlags: ['-preset', 'medium'],
    },
    atomicReplace: true,
    verifyOutput: true,
    skipSeeding: true,
    libraryId: 'library-1',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

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

    // Create mock services
    const mockQueueService = {
      updateProgress: jest.fn().mockResolvedValue(mockJob),
      completeJob: jest.fn().mockResolvedValue(mockJob),
      failJob: jest.fn().mockResolvedValue(mockJob),
      cancelJob: jest.fn().mockResolvedValue(mockJob),
    };

    const mockEventEmitter = {
      emit: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FfmpegService,
        {
          provide: QueueService,
          useValue: mockQueueService,
        },
        {
          provide: EventEmitter2,
          useValue: mockEventEmitter,
        },
      ],
    }).compile();

    service = module.get<FfmpegService>(FfmpegService);
    queueService = module.get(QueueService) as jest.Mocked<QueueService>;
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
      const mockProcess = new EventEmitter() as ChildProcess;
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
      const mockProcess = new EventEmitter() as ChildProcess;
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
      const mockProcess = new EventEmitter() as ChildProcess;
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

      const args = service.buildFfmpegCommand(mockJob, mockPolicy, hwaccel);

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

      const args = service.buildFfmpegCommand(mockJob, customPolicy, hwaccel);

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
    it('should successfully encode file and complete job', async () => {
      mockExistsSync.mockReturnValue(true);
      mockFs.stat.mockResolvedValue({ size: 500000000 } as any);

      // Create mock ffmpeg process
      const mockProcess = new EventEmitter() as ChildProcess;
      (mockProcess as any).stderr = new EventEmitter();
      mockSpawn.mockReturnValue(mockProcess);

      const encodePromise = service.encodeFile(mockJob, mockPolicy);

      // Simulate progress updates
      setTimeout(() => {
        (mockProcess as any).stderr.emit(
          'data',
          Buffer.from('frame= 1000 fps= 50.0 time=00:00:30.00')
        );
      }, 10);

      // Simulate successful completion
      setTimeout(() => {
        mockProcess.emit('close', 0);
      }, 20);

      await encodePromise;

      expect(queueService.completeJob).toHaveBeenCalledWith(mockJob.id, {
        afterSizeBytes: '500000000',
        savedBytes: '500000000',
        savedPercent: 50,
      });
      expect(mockFs.rename).toHaveBeenCalledWith('/media/video.mp4.tmp', '/media/video.mp4');
    });

    it('should emit progress events during encoding', async () => {
      mockExistsSync.mockReturnValue(true);
      mockFs.stat.mockResolvedValue({ size: 500000000 } as any);

      const mockProcess = new EventEmitter() as ChildProcess;
      (mockProcess as any).stderr = new EventEmitter();
      mockSpawn.mockReturnValue(mockProcess);

      const encodePromise = service.encodeFile(mockJob, mockPolicy);

      // Emit progress data
      setTimeout(() => {
        (mockProcess as any).stderr.emit(
          'data',
          Buffer.from('frame= 500 fps= 30.0 time=00:00:20.00\n')
        );
      }, 10);

      setTimeout(() => {
        mockProcess.emit('close', 0);
      }, 20);

      await encodePromise;

      expect(eventEmitter.emit).toHaveBeenCalledWith(
        'encoding.progress',
        expect.objectContaining({
          jobId: mockJob.id,
          frame: 500,
          fps: 30.0,
          currentTime: '00:00:20.00',
        })
      );
    });

    it('should handle encoding failure', async () => {
      mockExistsSync.mockReturnValue(true);
      mockFs.stat.mockResolvedValue({ size: 500000000 } as any);

      const mockProcess = new EventEmitter() as ChildProcess;
      (mockProcess as any).stderr = new EventEmitter();
      mockSpawn.mockReturnValue(mockProcess);

      const encodePromise = service.encodeFile(mockJob, mockPolicy);

      // Simulate failure
      setTimeout(() => {
        mockProcess.emit('close', 1);
      }, 10);

      await expect(encodePromise).rejects.toThrow('ffmpeg exited with code 1');
      expect(queueService.failJob).toHaveBeenCalledWith(mockJob.id, 'ffmpeg exited with code 1');
      expect(mockFs.unlink).toHaveBeenCalledWith('/media/video.mp4.tmp');
    });

    it('should handle file not found error', async () => {
      mockExistsSync.mockReturnValue(false);

      await expect(service.encodeFile(mockJob, mockPolicy)).rejects.toThrow(
        'File not found: /media/video.mp4'
      );
    });

    it('should handle process spawn error', async () => {
      mockExistsSync.mockReturnValue(true);
      mockFs.stat.mockResolvedValue({ size: 500000000 } as any);

      const mockProcess = new EventEmitter() as ChildProcess;
      (mockProcess as any).stderr = new EventEmitter();
      mockSpawn.mockReturnValue(mockProcess);

      const encodePromise = service.encodeFile(mockJob, mockPolicy);

      // Simulate spawn error
      setTimeout(() => {
        mockProcess.emit('error', new Error('spawn ffmpeg ENOENT'));
      }, 10);

      await expect(encodePromise).rejects.toThrow('spawn ffmpeg ENOENT');
      expect(queueService.failJob).toHaveBeenCalledWith(
        mockJob.id,
        'ffmpeg process error: spawn ffmpeg ENOENT'
      );
    });

    it('should preserve original file when atomicReplace is false', async () => {
      mockExistsSync.mockReturnValue(true);
      mockFs.stat.mockResolvedValue({ size: 500000000 } as any);

      const nonAtomicPolicy = {
        ...mockPolicy,
        atomicReplace: false,
      };

      const mockProcess = new EventEmitter() as ChildProcess;
      (mockProcess as any).stderr = new EventEmitter();
      mockSpawn.mockReturnValue(mockProcess);

      const encodePromise = service.encodeFile(mockJob, nonAtomicPolicy);

      setTimeout(() => {
        mockProcess.emit('close', 0);
      }, 10);

      await encodePromise;

      expect(mockFs.rename).toHaveBeenCalledWith('/media/video.mp4', '/media/video.mp4.original');
      expect(mockFs.rename).toHaveBeenCalledWith('/media/video.mp4.tmp', '/media/video.mp4');
    });
  });

  describe('cancelEncoding', () => {
    it('should cancel active encoding', async () => {
      mockExistsSync.mockReturnValue(true);

      // Start encoding
      const mockProcess = new EventEmitter() as ChildProcess;
      (mockProcess as any).stderr = new EventEmitter();
      (mockProcess as any).kill = jest.fn();
      (mockProcess as any).killed = false;
      mockSpawn.mockReturnValue(mockProcess);

      const encodePromise = service.encodeFile(mockJob, mockPolicy);

      // Wait for encoding to start
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Cancel the encoding
      const cancelPromise = service.cancelEncoding(mockJob.id);

      // Simulate process killed
      setTimeout(() => {
        (mockProcess as any).killed = true;
      }, 100);

      const result = await cancelPromise;

      expect(result).toBe(true);
      expect((mockProcess as any).kill).toHaveBeenCalledWith('SIGTERM');
      expect(queueService.cancelJob).toHaveBeenCalledWith(mockJob.id);
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
      mockExistsSync.mockReturnValue(true);

      const mockProcess = new EventEmitter() as ChildProcess;
      (mockProcess as any).stderr = new EventEmitter();
      mockSpawn.mockReturnValue(mockProcess);

      const encodePromise = service.encodeFile(mockJob, mockPolicy);

      // Wait for encoding to start
      await new Promise((resolve) => setTimeout(resolve, 10));

      const activeJobs = service.getActiveEncodings();
      expect(activeJobs).toContain(mockJob.id);

      // Clean up
      setTimeout(() => mockProcess.emit('close', 0), 10);
      await encodePromise;
    });
  });

  describe('getEncodingStatus', () => {
    it('should return null for non-active job', () => {
      const status = service.getEncodingStatus('non-existent-job');
      expect(status).toBeNull();
    });

    it('should return status for active encoding', async () => {
      mockExistsSync.mockReturnValue(true);

      const mockProcess = new EventEmitter() as ChildProcess;
      (mockProcess as any).stderr = new EventEmitter();
      mockSpawn.mockReturnValue(mockProcess);

      const encodePromise = service.encodeFile(mockJob, mockPolicy);

      // Wait for encoding to start
      await new Promise((resolve) => setTimeout(resolve, 10));

      const status = service.getEncodingStatus(mockJob.id);
      expect(status).not.toBeNull();
      expect(status?.jobId).toBe(mockJob.id);
      expect(status?.startTime).toBeInstanceOf(Date);
      expect(status?.elapsedSeconds).toBeGreaterThanOrEqual(0);

      // Clean up
      setTimeout(() => mockProcess.emit('close', 0), 10);
      await encodePromise;
    });
  });
});
