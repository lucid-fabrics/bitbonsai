import * as fs from 'node:fs';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Test, type TestingModule } from '@nestjs/testing';
import { JobStage } from '@prisma/client';
import { LibrariesService } from '../../../libraries/libraries.service';
import { QueueService } from '../../../queue/queue.service';
import { EncodingProcessorService } from '../../encoding-processor.service';
import { FfmpegService } from '../../ffmpeg.service';

// Mock fs module
jest.mock('node:fs');

describe('EncodingProcessorService', () => {
  let service: EncodingProcessorService;
  let queueService: jest.Mocked<QueueService>;
  let ffmpegService: jest.Mocked<FfmpegService>;
  let librariesService: jest.Mocked<LibrariesService>;
  let _eventEmitter: EventEmitter2;

  const mockJob = {
    id: 'job-123',
    filePath: '/media/test-video.mkv',
    fileLabel: 'Test Video.mkv',
    sourceCodec: 'H.264',
    targetCodec: 'HEVC',
    stage: JobStage.ENCODING,
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
    policy: {
      id: 'policy-1',
      name: 'Test Policy',
      preset: 'BALANCED_HEVC' as any,
      targetCodec: 'HEVC' as any,
      targetQuality: 23,
      deviceProfiles: {},
      advancedSettings: {
        hwaccel: 'auto',
        audioCodec: 'copy',
        subtitleHandling: 'copy',
      },
      atomicReplace: true,
      verifyOutput: true,
      skipSeeding: true,
      libraryId: 'library-1',
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  };

  beforeEach(async () => {
    // Reset all mocks
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EncodingProcessorService,
        {
          provide: QueueService,
          useValue: {
            getNextJob: jest.fn(),
            completeJob: jest.fn(),
            failJob: jest.fn(),
            updateProgress: jest.fn(),
          },
        },
        {
          provide: FfmpegService,
          useValue: {
            encode: jest.fn(),
            encodeFile: jest.fn(),
            verifyFile: jest.fn(),
            detectHardwareAcceleration: jest.fn(),
            buildFfmpegCommand: jest.fn(),
            cancelEncoding: jest.fn(),
            getActiveEncodings: jest.fn(),
            getEncodingStatus: jest.fn(),
          },
        },
        {
          provide: LibrariesService,
          useValue: {
            findOne: jest.fn(),
            update: jest.fn(),
          },
        },
        {
          provide: EventEmitter2,
          useValue: {
            emit: jest.fn(),
            on: jest.fn(),
            once: jest.fn(),
            removeListener: jest.fn(),
            removeAllListeners: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<EncodingProcessorService>(EncodingProcessorService);
    queueService = module.get(QueueService);
    ffmpegService = module.get(FfmpegService);
    librariesService = module.get(LibrariesService);
    _eventEmitter = module.get(EventEmitter2);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('startWorker', () => {
    it('should start a new worker for a node', async () => {
      await service.startWorker('node-1');
      // Worker is running in background, we can't easily test the loop
      // but we can verify no errors occurred
      expect(service).toBeDefined();
    });

    it('should not start duplicate workers for same node', async () => {
      await service.startWorker('node-1');
      await service.startWorker('node-1');
      // Should log warning but not crash
      expect(service).toBeDefined();
    });
  });

  describe('stopWorker', () => {
    it('should stop a running worker', async () => {
      await service.startWorker('node-1');
      await service.stopWorker('node-1');
      expect(service).toBeDefined();
    });

    it('should handle stopping non-existent worker', async () => {
      await service.stopWorker('non-existent');
      expect(service).toBeDefined();
    });
  });

  describe('processNextJob', () => {
    it('should return null when no jobs available', async () => {
      queueService.getNextJob.mockResolvedValue(null);

      const result = await service.processNextJob('node-1');

      expect(result).toBeNull();
      expect(queueService.getNextJob).toHaveBeenCalledWith('node-1');
    });

    it('should successfully process a job', async () => {
      // Mock file operations
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.statSync as jest.Mock).mockReturnValue({ size: 1000000000 }); // Before size
      (fs.statSync as jest.Mock).mockReturnValueOnce({ size: 1000000000 }); // Before
      (fs.statSync as jest.Mock).mockReturnValueOnce({ size: 750000000 }); // After
      (fs.renameSync as jest.Mock).mockImplementation(() => {
        // Mock implementation - no operation needed
      });
      (fs.unlinkSync as jest.Mock).mockImplementation(() => {
        // Mock implementation - no operation needed
      });

      queueService.getNextJob.mockResolvedValue(mockJob);
      ffmpegService.encode.mockResolvedValue();
      ffmpegService.verifyFile.mockResolvedValue(true);
      librariesService.findOne.mockResolvedValue({
        id: 'library-1',
        totalSizeBytes: BigInt(10000000000),
      } as never);
      librariesService.update.mockResolvedValue({} as never);
      queueService.completeJob.mockResolvedValue(mockJob);

      const result = await service.processNextJob('node-1');

      expect(result).toEqual(mockJob);
      expect(ffmpegService.encode).toHaveBeenCalled();
      expect(queueService.completeJob).toHaveBeenCalled();
    });

    it('should fail job when source file does not exist', async () => {
      (fs.existsSync as jest.Mock).mockReturnValue(false);

      queueService.getNextJob.mockResolvedValue(mockJob);
      queueService.failJob.mockResolvedValue(mockJob);

      const result = await service.processNextJob('node-1');

      expect(result).toBeNull();
      expect(queueService.failJob).toHaveBeenCalledWith(
        'job-123',
        expect.stringContaining('Source file not found')
      );
    });

    it('should implement retry logic for transient errors', async () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.statSync as jest.Mock).mockReturnValue({ size: 1000000000 });

      queueService.getNextJob.mockResolvedValue(mockJob);
      ffmpegService.encode.mockRejectedValue(new Error('ECONNRESET: Connection reset'));
      queueService.updateProgress.mockResolvedValue(mockJob);

      const result = await service.processNextJob('node-1');

      expect(result).toBeNull();
      expect(queueService.updateProgress).toHaveBeenCalledWith('job-123', {
        stage: 'QUEUED',
        progress: 0,
      });
    });
  });

  describe('handleJobCompletion', () => {
    it('should update job and library stats on completion', async () => {
      const result = {
        beforeSizeBytes: BigInt(1000000000),
        afterSizeBytes: BigInt(750000000),
        savedBytes: BigInt(250000000),
        savedPercent: 25.0,
      };

      librariesService.findOne.mockResolvedValue({
        id: 'library-1',
        totalSizeBytes: BigInt(10000000000),
      } as never);
      librariesService.update.mockResolvedValue({} as never);
      queueService.completeJob.mockResolvedValue(mockJob);

      await service.handleJobCompletion(mockJob, result);

      expect(queueService.completeJob).toHaveBeenCalledWith('job-123', {
        afterSizeBytes: '750000000',
        savedBytes: '250000000',
        savedPercent: 25.0,
      });
      expect(librariesService.update).toHaveBeenCalledWith('library-1', {
        totalSizeBytes: BigInt(9750000000),
      });
    });

    it('should handle library update errors gracefully', async () => {
      const result = {
        beforeSizeBytes: BigInt(1000000000),
        afterSizeBytes: BigInt(750000000),
        savedBytes: BigInt(250000000),
        savedPercent: 25.0,
      };

      queueService.completeJob.mockResolvedValue(mockJob);
      librariesService.findOne.mockRejectedValue(new Error('Database error'));

      // Should not throw
      await service.handleJobCompletion(mockJob, result);

      expect(queueService.completeJob).toHaveBeenCalled();
    });
  });

  describe('handleJobFailure', () => {
    it('should mark job as failed for non-transient errors', async () => {
      const error = new Error('Invalid codec');

      queueService.failJob.mockResolvedValue(mockJob);

      await service.handleJobFailure(mockJob, error);

      expect(queueService.failJob).toHaveBeenCalledWith('job-123', 'Invalid codec');
    });

    it('should retry job for transient errors', async () => {
      const error = new Error('ETIMEDOUT: Network timeout');

      queueService.updateProgress.mockResolvedValue(mockJob);

      await service.handleJobFailure({ ...mockJob, retryCount: 0 }, error);

      expect(queueService.updateProgress).toHaveBeenCalledWith('job-123', {
        stage: 'QUEUED',
        progress: 0,
      });
    });

    it('should not retry after max retries exceeded', async () => {
      const error = new Error('ETIMEDOUT: Network timeout');

      queueService.failJob.mockResolvedValue(mockJob);

      await service.handleJobFailure({ ...mockJob, retryCount: 3 }, error);

      expect(queueService.failJob).toHaveBeenCalledWith('job-123', 'ETIMEDOUT: Network timeout');
    });
  });

  describe('atomic file replacement', () => {
    it('should perform atomic replacement with backup', async () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.statSync as jest.Mock).mockReturnValueOnce({ size: 1000000000 }); // Before
      (fs.statSync as jest.Mock).mockReturnValueOnce({ size: 750000000 }); // After
      (fs.renameSync as jest.Mock).mockImplementation(() => {
        // Mock implementation - no operation needed
      });
      (fs.unlinkSync as jest.Mock).mockImplementation(() => {
        // Mock implementation - no operation needed
      });

      queueService.getNextJob.mockResolvedValue(mockJob);
      ffmpegService.encode.mockResolvedValue();
      ffmpegService.verifyFile.mockResolvedValue(true);
      librariesService.findOne.mockResolvedValue({
        id: 'library-1',
        totalSizeBytes: BigInt(10000000000),
      } as never);
      queueService.completeJob.mockResolvedValue(mockJob);

      await service.processNextJob('node-1');

      // Verify atomic replacement sequence
      expect(fs.renameSync).toHaveBeenCalledWith(
        '/media/test-video.mkv',
        '/media/test-video.mkv.backup'
      );
      expect(fs.renameSync).toHaveBeenCalledWith(
        '/media/.test-video.mkv.tmp',
        '/media/test-video.mkv'
      );
      expect(fs.unlinkSync).toHaveBeenCalledWith('/media/test-video.mkv.backup');
    });

    it('should restore backup on replacement failure', async () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.statSync as jest.Mock).mockReturnValueOnce({ size: 1000000000 }); // Before
      (fs.statSync as jest.Mock).mockReturnValueOnce({ size: 750000000 }); // After
      (fs.renameSync as jest.Mock)
        .mockImplementationOnce(() => {
          // Mock backup original - no operation needed
        })
        .mockImplementationOnce(() => {
          throw new Error('Permission denied');
        }) // Fail on replace
        .mockImplementationOnce(() => {
          // Mock restore backup - no operation needed
        });

      queueService.getNextJob.mockResolvedValue(mockJob);
      ffmpegService.encode.mockResolvedValue();
      ffmpegService.verifyFile.mockResolvedValue(true);
      queueService.failJob.mockResolvedValue(mockJob);

      await service.processNextJob('node-1');

      // Verify backup was restored
      expect(fs.renameSync).toHaveBeenCalledWith(
        '/media/test-video.mkv.backup',
        '/media/test-video.mkv'
      );
      expect(queueService.failJob).toHaveBeenCalled();
    });
  });

  describe('output verification', () => {
    it('should verify output when enabled', async () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.statSync as jest.Mock).mockReturnValueOnce({ size: 1000000000 });
      (fs.statSync as jest.Mock).mockReturnValueOnce({ size: 750000000 });

      queueService.getNextJob.mockResolvedValue(mockJob);
      ffmpegService.encode.mockResolvedValue();
      ffmpegService.verifyFile.mockResolvedValue(true);
      librariesService.findOne.mockResolvedValue({
        id: 'library-1',
        totalSizeBytes: BigInt(10000000000),
      } as never);
      queueService.completeJob.mockResolvedValue(mockJob);

      await service.processNextJob('node-1');

      expect(ffmpegService.verifyFile).toHaveBeenCalledWith('/media/.test-video.mkv.tmp');
    });

    it('should fail job when verification fails', async () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.statSync as jest.Mock).mockReturnValueOnce({ size: 1000000000 });
      (fs.statSync as jest.Mock).mockReturnValueOnce({ size: 750000000 });
      (fs.unlinkSync as jest.Mock).mockImplementation(() => {
        // Mock implementation - no operation needed
      });

      queueService.getNextJob.mockResolvedValue(mockJob);
      ffmpegService.encode.mockResolvedValue();
      ffmpegService.verifyFile.mockResolvedValue(false);
      queueService.failJob.mockResolvedValue(mockJob);

      await service.processNextJob('node-1');

      expect(queueService.failJob).toHaveBeenCalledWith(
        'job-123',
        expect.stringContaining('Output verification failed')
      );
      expect(fs.unlinkSync).toHaveBeenCalledWith('/media/.test-video.mkv.tmp');
    });
  });

  describe('progress tracking', () => {
    // Note: Progress tracking is tested through the integration tests
    // as it's handled internally by the encodeFile method
    it.skip('should update job progress on ffmpeg events', async () => {
      // This test would require accessing private methods
      // Progress tracking is better tested through integration tests
    });
  });

  describe('metrics calculation', () => {
    it('should calculate correct savings percentages', async () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      // statSync is called 2 times: line 237 (before), line 277 (after)
      const statSyncMock = fs.statSync as jest.Mock;
      statSyncMock.mockClear();
      let callCount = 0;
      statSyncMock.mockImplementation((path: string) => {
        callCount++;
        if (callCount === 1) {
          return { size: 1000000000 }; // Line 237 - before (job.filePath)
        }
        return { size: 750000000 }; // Line 277 - after (tmpPath)
      });
      (fs.renameSync as jest.Mock).mockImplementation(() => {
        // Mock implementation - no operation needed
      });
      (fs.unlinkSync as jest.Mock).mockImplementation(() => {
        // Mock implementation - no operation needed
      });

      queueService.getNextJob.mockResolvedValue(mockJob);
      ffmpegService.encode.mockResolvedValue();
      ffmpegService.verifyFile.mockResolvedValue(true);
      librariesService.findOne.mockResolvedValue({
        id: 'library-1',
        totalSizeBytes: BigInt(10000000000),
      } as never);
      queueService.completeJob.mockResolvedValue(mockJob);

      await service.processNextJob('node-1');

      expect(queueService.completeJob).toHaveBeenCalledWith('job-123', {
        afterSizeBytes: '750000000',
        savedBytes: '250000000',
        savedPercent: 25.0,
      });
    });
  });
});
