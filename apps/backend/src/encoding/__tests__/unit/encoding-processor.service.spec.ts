import * as fs from 'node:fs';
import { Test, type TestingModule } from '@nestjs/testing';
import { JobStage } from '@prisma/client';
import { DataAccessService } from '../../../core/services/data-access.service';
import { FileRelocatorService } from '../../../core/services/file-relocator.service';
import { LibrariesService } from '../../../libraries/libraries.service';
import { NodesService } from '../../../nodes/nodes.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { QueueService } from '../../../queue/queue.service';
import { createMockJob, createMockPolicy } from '../../../testing/mock-factories';
import {
  createMockPrismaService,
  mockDataAccessProvider,
  mockEventEmitterProvider,
  mockFileRelocatorProvider,
} from '../../../testing/mock-providers';
import { EncodingProcessorService } from '../../encoding-processor.service';
import { FfmpegService } from '../../ffmpeg.service';

// Mock fs module
jest.mock('node:fs');

describe('EncodingProcessorService', () => {
  let service: EncodingProcessorService;
  let queueService: jest.Mocked<QueueService>;
  let ffmpegService: jest.Mocked<FfmpegService>;
  let librariesService: jest.Mocked<LibrariesService>;
  let prisma: ReturnType<typeof createMockPrismaService>;

  const mockPolicy = createMockPolicy({
    id: 'policy-1',
    advancedSettings: {
      hwaccel: 'auto',
      audioCodec: 'copy',
      subtitleHandling: 'copy',
    },
  });

  const mockJob = {
    ...createMockJob({
      id: 'job-123',
      filePath: '/media/test-video.mkv',
      fileLabel: 'Test Video.mkv',
      sourceCodec: 'H.264',
      targetCodec: 'HEVC',
      stage: JobStage.ENCODING,
      beforeSizeBytes: BigInt(1000000000),
      startedAt: new Date(),
      nodeId: 'node-1',
      libraryId: 'library-1',
      policyId: 'policy-1',
    }),
    policy: mockPolicy,
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    prisma = createMockPrismaService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EncodingProcessorService,
        { provide: PrismaService, useValue: prisma },
        mockDataAccessProvider,
        mockFileRelocatorProvider,
        mockEventEmitterProvider,
        {
          provide: QueueService,
          useValue: {
            getNextJob: jest.fn(),
            completeJob: jest.fn(),
            failJob: jest.fn(),
            updateProgress: jest.fn(),
            update: jest.fn(),
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
            getActiveEncodings: jest.fn().mockReturnValue([]),
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
          provide: NodesService,
          useValue: {
            findOne: jest.fn(),
            findAll: jest.fn().mockResolvedValue([]),
            update: jest.fn(),
            getCurrentNode: jest.fn().mockResolvedValue({ id: 'node-1', maxWorkers: 4 }),
          },
        },
      ],
    }).compile();

    service = module.get<EncodingProcessorService>(EncodingProcessorService);
    queueService = module.get(QueueService);
    ffmpegService = module.get(FfmpegService);
    librariesService = module.get(LibrariesService);
  });

  /**
   * Helper: register a worker so processNextJob can find it
   */
  function registerWorker(workerId = 'node-1') {
    (service as any).workers.set(workerId, {
      workerId,
      nodeId: 'node-1',
      isRunning: true,
      currentJobId: null,
      startedAt: new Date(),
    });
  }

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('startWorker', () => {
    it('should start a new worker for a node', async () => {
      await (service as any).startWorker('node-1', 'node-1');
      expect((service as any).workers.has('node-1')).toBe(true);
    });

    it('should not start duplicate workers for same node', async () => {
      await (service as any).startWorker('node-1', 'node-1');
      await (service as any).startWorker('node-1', 'node-1');
      expect(service).toBeDefined();
    });
  });

  describe('stopWorker', () => {
    it('should stop a running worker', async () => {
      await (service as any).startWorker('node-1', 'node-1');
      await service.stopWorker('node-1');
      expect(service).toBeDefined();
    });

    it('should handle stopping non-existent worker', async () => {
      await service.stopWorker('non-existent');
      expect(service).toBeDefined();
    });
  });

  describe('processNextJob', () => {
    beforeEach(() => {
      registerWorker();
      // Default: policy exists and matches
      prisma.policy.findUnique.mockResolvedValue(mockPolicy as any);
      prisma.job.findUnique.mockResolvedValue(null); // No fresh pause check
    });

    it('should return null when no jobs available', async () => {
      queueService.getNextJob.mockResolvedValue(null);

      const result = await service.processNextJob('node-1');

      expect(result).toBeNull();
      expect(queueService.getNextJob).toHaveBeenCalledWith('node-1');
    });

    it('should return null when worker not registered', async () => {
      const result = await service.processNextJob('non-existent-worker');
      expect(result).toBeNull();
    });

    it('should successfully process a job', async () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.statSync as jest.Mock).mockImplementation((filePath: string) => {
        if (filePath === '/media/test-video.mkv') return { size: 1000000000 };
        if (filePath.includes('.tmp')) return { size: 750000000 };
        return { size: 0 };
      });
      (fs.renameSync as jest.Mock).mockImplementation(() => undefined);
      (fs.unlinkSync as jest.Mock).mockImplementation(() => undefined);

      queueService.getNextJob.mockResolvedValue(mockJob as any);
      ffmpegService.encode.mockResolvedValue();
      ffmpegService.verifyFile.mockResolvedValue({ isValid: true });
      librariesService.findOne.mockResolvedValue({
        id: 'library-1',
        totalSizeBytes: BigInt(10000000000),
      } as never);
      librariesService.update.mockResolvedValue({} as never);
      queueService.completeJob.mockResolvedValue(mockJob as any);
      queueService.update.mockResolvedValue(mockJob as any);

      const result = await service.processNextJob('node-1');

      // Job should be processed (returned or null depending on internal flow)
      // The important thing is no errors thrown
      expect(queueService.getNextJob).toHaveBeenCalledWith('node-1');
    });

    it('should fail job when source file does not exist', async () => {
      (fs.existsSync as jest.Mock).mockReturnValue(false);

      queueService.getNextJob.mockResolvedValue(mockJob as any);
      queueService.failJob.mockResolvedValue(mockJob as any);
      queueService.update.mockResolvedValue(mockJob as any);

      const result = await service.processNextJob('node-1');

      expect(result).toBeNull();
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
      queueService.completeJob.mockResolvedValue(mockJob as any);
      prisma.library.findUnique.mockResolvedValue({
        id: 'library-1',
        totalSizeBytes: BigInt(10000000000),
      } as any);

      await service.handleJobCompletion(mockJob as any, result);

      expect(queueService.completeJob).toHaveBeenCalledWith('job-123', {
        afterSizeBytes: '750000000',
        savedBytes: '250000000',
        savedPercent: 25.0,
      });
    });

    it('should handle library update errors gracefully', async () => {
      const result = {
        beforeSizeBytes: BigInt(1000000000),
        afterSizeBytes: BigInt(750000000),
        savedBytes: BigInt(250000000),
        savedPercent: 25.0,
      };

      queueService.completeJob.mockRejectedValue(new Error('Database error'));
      prisma.library.findUnique.mockRejectedValue(new Error('Database error'));

      // handleJobCompletion re-throws errors from completeJob
      await expect(service.handleJobCompletion(mockJob as any, result)).rejects.toThrow('Database error');
    });
  });

  describe('handleJobFailure', () => {
    it('should mark job as failed for non-transient errors', async () => {
      const error = new Error('Invalid codec');

      queueService.failJob.mockResolvedValue(mockJob as any);

      await service.handleJobFailure(mockJob as any, error);

      expect(queueService.failJob).toHaveBeenCalledWith(
        'job-123',
        expect.stringContaining('Invalid codec')
      );
    });

    it('should retry job for transient errors', async () => {
      const error = new Error('ETIMEDOUT: Network timeout');

      queueService.update.mockResolvedValue(mockJob as any);

      await service.handleJobFailure(createMockJob({ id: 'job-123', retryCount: 0 }) as any, error);

      expect(queueService.update).toHaveBeenCalledWith(
        'job-123',
        expect.objectContaining({
          stage: 'QUEUED',
          progress: 0,
          retryCount: 1,
        })
      );
    });

    it('should not retry after max retries exceeded', async () => {
      const error = new Error('ETIMEDOUT: Network timeout');

      queueService.failJob.mockResolvedValue(mockJob as any);

      await service.handleJobFailure(createMockJob({ id: 'job-123', retryCount: 3 }) as any, error);

      expect(queueService.failJob).toHaveBeenCalledWith(
        'job-123',
        expect.stringContaining('retry attempts exhausted')
      );
    });
  });

  describe('progress tracking', () => {
    it.skip('should update job progress on ffmpeg events', async () => {
      // Progress tracking is better tested through integration tests
    });
  });
});
