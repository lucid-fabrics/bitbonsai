import { HttpService } from '@nestjs/axios';
import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { NodeRepository } from '../../common/repositories/node.repository';
import { NodeConfigService } from '../../core/services/node-config.service';
import { PrismaService } from '../../prisma/prisma.service';
import { QueueProcessingService } from './queue-processing.service';

describe('QueueProcessingService', () => {
  let service: QueueProcessingService;
  let mockPrisma: any;
  let mockNodeConfig: jest.Mocked<NodeConfigService>;
  let mockNodeRepository: { findById: jest.Mock; findUnique: jest.Mock };
  let mockHttpService: { get: jest.Mock };

  beforeEach(async () => {
    mockPrisma = {
      $transaction: jest.fn(),
      $executeRaw: jest.fn(),
    };

    mockNodeConfig = {
      getMainApiUrl: jest.fn().mockReturnValue(null),
      getNodeId: jest.fn().mockReturnValue(null),
      isMainNode: jest.fn().mockReturnValue(true),
    } as any;

    mockNodeRepository = { findById: jest.fn(), findUnique: jest.fn() };
    mockHttpService = { get: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QueueProcessingService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: NodeRepository, useValue: mockNodeRepository },
        { provide: NodeConfigService, useValue: mockNodeConfig },
        { provide: HttpService, useValue: mockHttpService },
      ],
    }).compile();

    service = module.get<QueueProcessingService>(QueueProcessingService);
  });

  describe('getNextJob', () => {
    it('should throw NotFoundException when node not found', async () => {
      mockNodeConfig.getMainApiUrl.mockReturnValue(null);
      mockNodeRepository.findUnique.mockResolvedValue(null);

      await expect(service.getNextJob('missing-node')).rejects.toThrow(NotFoundException);
    });

    it('should return null when node is at capacity', async () => {
      mockNodeConfig.getMainApiUrl.mockReturnValue(null);
      mockNodeRepository.findUnique.mockResolvedValue({
        id: 'node-1',
        hasSharedStorage: true,
        license: { maxConcurrentJobs: 2 },
        _count: { jobs: 2 },
      });

      const result = await service.getNextJob('node-1');
      expect(result).toBeNull();
    });

    it('should proxy to main API on linked node', async () => {
      mockNodeConfig.getMainApiUrl.mockReturnValue('http://main:3000/api/v1');
      const job = { id: 'job-1', fileLabel: 'movie.mkv' };
      const { of } = await import('rxjs');
      mockHttpService.get.mockReturnValue(of({ data: job }));

      const result = await service.getNextJob('node-1');
      expect(result).toEqual(job);
    });
  });

  describe('handleFileDetected_MOVED_TO_queue-file-detection.service.spec', () => {
    it('placeholder - tests moved to queue-file-detection.service.spec.ts', () => {
      expect(true).toBe(true);
    });
  });

  describe('getNextJob - extended', () => {
    it('should return null when no queued jobs in transaction', async () => {
      mockNodeConfig.getMainApiUrl.mockReturnValue(null);
      mockNodeRepository.findUnique.mockResolvedValue({
        id: 'node-1',
        hasSharedStorage: true,
        license: { maxConcurrentJobs: 5 },
        _count: { jobs: 1 },
      });
      mockPrisma.$transaction.mockResolvedValue(null);

      const result = await service.getNextJob('node-1');
      expect(result).toBeNull();
    });

    it('should retry up to maxAttempts when claim fails', async () => {
      mockNodeConfig.getMainApiUrl.mockReturnValue(null);
      mockNodeRepository.findUnique.mockResolvedValue({
        id: 'node-1',
        hasSharedStorage: true,
        license: { maxConcurrentJobs: 5 },
        _count: { jobs: 1 },
      });

      // Always return claimFailed
      mockPrisma.$transaction.mockResolvedValue({
        claimFailed: true,
        attemptedJobId: 'job-x',
      });

      const result = await service.getNextJob('node-1');
      expect(result).toBeNull();
      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(5); // maxAttempts
    });

    it('should return claimedJob when transaction succeeds', async () => {
      mockNodeConfig.getMainApiUrl.mockReturnValue(null);
      mockNodeRepository.findUnique.mockResolvedValue({
        id: 'node-1',
        hasSharedStorage: true,
        license: { maxConcurrentJobs: 5 },
        _count: { jobs: 1 },
      });

      const claimedJob = { id: 'job-claimed', fileLabel: 'movie.mkv' };
      mockPrisma.$transaction.mockResolvedValue({ claimedJob });

      const result = await service.getNextJob('node-1');
      expect(result).toEqual(claimedJob);
    });

    it('should fallback to local DB when linked node proxy fails', async () => {
      const { throwError } = await import('rxjs');
      mockNodeConfig.getMainApiUrl.mockReturnValue('http://main:3000/api/v1');
      mockHttpService.get.mockReturnValue(throwError(() => new Error('network error')));

      // After fallback, node not found
      mockNodeRepository.findUnique.mockResolvedValue(null);

      await expect(service.getNextJob('node-1')).rejects.toThrow(NotFoundException);
    });
  });
  describe('getNextJob - additional branches', () => {
    it('should return null when linked-node proxy returns null data', async () => {
      const { of } = await import('rxjs');
      mockNodeConfig.getMainApiUrl.mockReturnValue('http://main:3000/api/v1');
      mockHttpService.get.mockReturnValue(of({ data: null }));

      const result = await service.getNextJob('node-1');
      expect(result).toBeNull();
    });

    it('should return null after exhausting all attempts when pause requested', async () => {
      mockNodeConfig.getMainApiUrl.mockReturnValue(null);
      mockNodeRepository.findUnique.mockResolvedValue({
        id: 'node-1',
        hasSharedStorage: true,
        license: { maxConcurrentJobs: 5 },
        _count: { jobs: 1 },
      });

      mockPrisma.$transaction.mockResolvedValue({
        claimFailed: true,
        pauseRequested: true,
      });

      const result = await service.getNextJob('node-1');
      expect(result).toBeNull();
      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(5);
    });

    it('should return null when transaction returns needs transfer', async () => {
      mockNodeConfig.getMainApiUrl.mockReturnValue(null);
      mockNodeRepository.findUnique.mockResolvedValue({
        id: 'node-1',
        hasSharedStorage: false,
        license: { maxConcurrentJobs: 5 },
        _count: { jobs: 1 },
      });

      mockPrisma.$transaction.mockResolvedValue({
        claimFailed: true,
        needsTransfer: true,
      });

      const result = await service.getNextJob('node-1');
      expect(result).toBeNull();
    });
  });

  describe('getNextJob - retry backoff', () => {
    it('should exclude jobs with a future nextRetryAt in both the candidate query and the claim guard', async () => {
      mockNodeConfig.getMainApiUrl.mockReturnValue(null);
      mockNodeRepository.findUnique.mockResolvedValue({
        id: 'node-1',
        hasSharedStorage: true,
        license: { maxConcurrentJobs: 5 },
        _count: { jobs: 0 },
      });

      const claimedJob = { id: 'job-1', fileLabel: 'movie.mkv' };
      const tx = {
        $executeRaw: jest.fn(),
        job: {
          findFirst: jest.fn().mockResolvedValue({
            id: 'job-1',
            filePath: '/media/movie.mkv',
            pauseRequestedAt: null,
            cancelRequestedAt: null,
            transferRequired: false,
            transferProgress: 100,
            library: { nodeId: 'node-1' },
          }),
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
          findUnique: jest.fn().mockResolvedValue(claimedJob),
          update: jest.fn(),
        },
        node: { findUnique: jest.fn() },
      };
      mockPrisma.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(tx));

      const result = await service.getNextJob('node-1');
      expect(result).toEqual(claimedJob);

      const backoffCondition = [{ nextRetryAt: null }, { nextRetryAt: { lte: expect.any(Date) } }];

      // Candidate-selection query honors backoff
      const findFirstArgs = tx.job.findFirst.mock.calls[0][0];
      expect(findFirstArgs.where.OR).toEqual(backoffCondition);

      // Guarded optimistic-claim update honors backoff too
      const updateManyArgs = tx.job.updateMany.mock.calls[0][0];
      expect(updateManyArgs.where.OR).toEqual(backoffCondition);
    });
  });
});
