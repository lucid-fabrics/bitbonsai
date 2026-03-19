import { NotFoundException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { JobStage } from '@prisma/client';
import { JobRepository } from '../../../../common/repositories/job.repository';
import { SharedStorageVerifierService } from '../../../../nodes/services/shared-storage-verifier.service';
import { PrismaService } from '../../../../prisma/prisma.service';
import { createMockPrismaService } from '../../../../testing/mock-providers';
import { FileTransferService } from '../../file-transfer.service';
import { JobRouterService } from '../../job-router.service';
import { QueueDelegationService } from '../../queue-delegation.service';
import { QueueJobCrudService } from '../../queue-job-crud.service';
import { QueueJobStateService } from '../../queue-job-state.service';

const makeDbJob = (overrides: Record<string, unknown> = {}) => ({
  id: 'job-1',
  stage: 'QUEUED',
  nodeId: 'node-1',
  filePath: '/media/movie.mkv',
  originalFilePath: null,
  originalNodeId: null,
  error: null,
  retryCount: 0,
  transferProgress: 0,
  library: { nodeId: 'node-1' },
  ...overrides,
});

const makeNode = (overrides: Record<string, unknown> = {}) => ({
  id: 'node-2',
  name: 'Worker',
  status: 'ONLINE',
  hasSharedStorage: false,
  ...overrides,
});

describe('QueueDelegationService', () => {
  let service: QueueDelegationService;
  let jobRepository: jest.Mocked<JobRepository>;
  let jobRouterService: jest.Mocked<JobRouterService>;
  let fileTransferService: jest.Mocked<FileTransferService>;
  let sharedStorageVerifier: jest.Mocked<SharedStorageVerifierService>;
  let jobCrudService: jest.Mocked<QueueJobCrudService>;
  let jobStateService: jest.Mocked<QueueJobStateService>;
  let prisma: ReturnType<typeof createMockPrismaService>;

  beforeEach(async () => {
    prisma = createMockPrismaService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QueueDelegationService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: JobRepository,
          useValue: {
            findById: jest.fn(),
            updateById: jest.fn(),
            findManyWithInclude: jest.fn(),
          },
        },
        {
          provide: JobRouterService,
          useValue: { rebalanceJobs: jest.fn() },
        },
        {
          provide: FileTransferService,
          useValue: { transferFile: jest.fn() },
        },
        {
          provide: SharedStorageVerifierService,
          useValue: { verifyFileAccess: jest.fn() },
        },
        {
          provide: QueueJobCrudService,
          useValue: { update: jest.fn() },
        },
        {
          provide: QueueJobStateService,
          useValue: { failJob: jest.fn() },
        },
      ],
    }).compile();

    service = module.get(QueueDelegationService);
    jobRepository = module.get(JobRepository);
    jobRouterService = module.get(JobRouterService);
    fileTransferService = module.get(FileTransferService);
    sharedStorageVerifier = module.get(SharedStorageVerifierService);
    jobCrudService = module.get(QueueJobCrudService);
    jobStateService = module.get(QueueJobStateService);

    jest.spyOn((service as any).logger, 'log').mockImplementation();
    jest.spyOn((service as any).logger, 'warn').mockImplementation();
    jest.spyOn((service as any).logger, 'debug').mockImplementation();
    jest.spyOn((service as any).logger, 'error').mockImplementation();
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  // ─── cleanupStuckTransfers ───────────────────────────────────────────────────

  describe('cleanupStuckTransfers', () => {
    it('should return early when no stuck jobs found', async () => {
      jobRepository.findManyWithInclude.mockResolvedValue([]);

      await service.cleanupStuckTransfers();

      expect(jobCrudService.update).not.toHaveBeenCalled();
      expect(jobStateService.failJob).not.toHaveBeenCalled();
    });

    it('should fail job when transferRetryCount >= 3', async () => {
      const stuckJob = {
        id: 'job-1',
        fileLabel: 'movie.mkv',
        transferRetryCount: 3,
        transferProgress: 50,
        transferStartedAt: new Date(Date.now() - 90 * 60 * 1000),
      };
      jobRepository.findManyWithInclude.mockResolvedValue([stuckJob]);
      jobStateService.failJob.mockResolvedValue(undefined as any);

      await service.cleanupStuckTransfers();

      expect(jobStateService.failJob).toHaveBeenCalledWith(
        'job-1',
        expect.stringContaining('retry attempts')
      );
    });

    it('should reset job to DETECTED when transferRetryCount < 3', async () => {
      const stuckJob = {
        id: 'job-1',
        fileLabel: 'movie.mkv',
        transferRetryCount: 1,
        transferProgress: 20,
        transferStartedAt: new Date(Date.now() - 90 * 60 * 1000),
      };
      jobRepository.findManyWithInclude.mockResolvedValue([stuckJob]);
      jobCrudService.update.mockResolvedValue(undefined as any);

      await service.cleanupStuckTransfers();

      expect(jobCrudService.update).toHaveBeenCalledWith(
        'job-1',
        expect.objectContaining({
          stage: JobStage.DETECTED,
          transferRetryCount: 2,
          transferProgress: 0,
        })
      );
    });

    it('should treat null transferRetryCount as 0 for retry counting', async () => {
      const stuckJob = {
        id: 'job-1',
        fileLabel: 'movie.mkv',
        transferRetryCount: null,
        transferProgress: 10,
        transferStartedAt: new Date(Date.now() - 90 * 60 * 1000),
      };
      jobRepository.findManyWithInclude.mockResolvedValue([stuckJob]);
      jobCrudService.update.mockResolvedValue(undefined as any);

      await service.cleanupStuckTransfers();

      expect(jobCrudService.update).toHaveBeenCalledWith(
        'job-1',
        expect.objectContaining({
          transferRetryCount: 1,
        })
      );
    });

    it('should handle multiple stuck jobs', async () => {
      const jobs = [
        {
          id: 'job-a',
          fileLabel: 'a.mkv',
          transferRetryCount: 3,
          transferProgress: 40,
          transferStartedAt: new Date(Date.now() - 90 * 60 * 1000),
        },
        {
          id: 'job-b',
          fileLabel: 'b.mkv',
          transferRetryCount: 2,
          transferProgress: 10,
          transferStartedAt: new Date(Date.now() - 90 * 60 * 1000),
        },
      ];
      jobRepository.findManyWithInclude.mockResolvedValue(jobs);
      jobStateService.failJob.mockResolvedValue(undefined as any);
      jobCrudService.update.mockResolvedValue(undefined as any);

      await service.cleanupStuckTransfers();

      expect(jobStateService.failJob).toHaveBeenCalledTimes(1);
      expect(jobCrudService.update).toHaveBeenCalledTimes(1);
    });

    it('should catch and log errors without throwing', async () => {
      jobRepository.findManyWithInclude.mockRejectedValue(new Error('DB error'));

      await expect(service.cleanupStuckTransfers()).resolves.toBeUndefined();
      expect((service as any).logger.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to cleanup stuck transfers'),
        expect.anything()
      );
    });
  });

  // ─── delegateJob ─────────────────────────────────────────────────────────────

  describe('delegateJob', () => {
    const setupTx = (jobOverrides = {}, targetNodeOverrides = {}, sourceNodeOverrides = {}) => {
      const job = makeDbJob(jobOverrides);
      const targetNode = makeNode(targetNodeOverrides);
      const sourceNode = makeNode({ id: 'node-1', name: 'Main', ...sourceNodeOverrides });

      prisma.$transaction.mockImplementation(async (fn: (tx: any) => any) => {
        const tx = {
          job: {
            findUnique: jest.fn().mockResolvedValueOnce(job).mockResolvedValueOnce(job),
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
          },
          node: {
            findUnique: jest
              .fn()
              .mockResolvedValueOnce(targetNode)
              .mockResolvedValueOnce(sourceNode),
          },
        };
        return fn(tx);
      });

      return { job, targetNode, sourceNode };
    };

    it('should throw NotFoundException when job not found', async () => {
      prisma.$transaction.mockImplementation(async (fn: (tx: any) => any) => {
        return fn({
          job: { findUnique: jest.fn().mockResolvedValue(null) },
          node: { findUnique: jest.fn() },
        });
      });

      await expect(service.delegateJob('job-1', 'node-2')).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException when job is already on target node', async () => {
      prisma.$transaction.mockImplementation(async (fn: (tx: any) => any) => {
        return fn({
          job: { findUnique: jest.fn().mockResolvedValue(makeDbJob({ nodeId: 'node-2' })) },
          node: { findUnique: jest.fn() },
        });
      });

      await expect(service.delegateJob('job-1', 'node-2')).rejects.toThrow(
        'Job is already assigned to this node'
      );
    });

    it('should throw BadRequestException for disallowed stages', async () => {
      prisma.$transaction.mockImplementation(async (fn: (tx: any) => any) => {
        return fn({
          job: {
            findUnique: jest.fn().mockResolvedValue(makeDbJob({ stage: 'COMPLETED' })),
          },
          node: { findUnique: jest.fn() },
        });
      });

      await expect(service.delegateJob('job-1', 'node-2')).rejects.toThrow(
        'Cannot delegate job in COMPLETED stage'
      );
    });

    it('should throw NotFoundException when target node not found', async () => {
      prisma.$transaction.mockImplementation(async (fn: (tx: any) => any) => {
        return fn({
          job: { findUnique: jest.fn().mockResolvedValue(makeDbJob()) },
          node: { findUnique: jest.fn().mockResolvedValue(null) },
        });
      });

      await expect(service.delegateJob('job-1', 'node-2')).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException when target node is not ONLINE', async () => {
      prisma.$transaction.mockImplementation(async (fn: (tx: any) => any) => {
        return fn({
          job: { findUnique: jest.fn().mockResolvedValue(makeDbJob()) },
          node: { findUnique: jest.fn().mockResolvedValue(makeNode({ status: 'OFFLINE' })) },
        });
      });

      await expect(service.delegateJob('job-1', 'node-2')).rejects.toThrow(
        'not available for job assignment'
      );
    });

    it('should throw NotFoundException when source node not found', async () => {
      prisma.$transaction.mockImplementation(async (fn: (tx: any) => any) => {
        const tx = {
          job: { findUnique: jest.fn().mockResolvedValue(makeDbJob()) },
          node: {
            findUnique: jest
              .fn()
              .mockResolvedValueOnce(makeNode({ status: 'ONLINE' }))
              .mockResolvedValueOnce(null),
          },
        };
        return fn(tx);
      });

      await expect(service.delegateJob('job-1', 'node-2')).rejects.toThrow(NotFoundException);
    });

    it('should set transferRequired=false and translate path when shared storage is accessible', async () => {
      const job = makeDbJob({ nodeId: 'node-1', library: { nodeId: 'node-source' } });
      const targetNode = makeNode({ id: 'node-2', hasSharedStorage: true });
      const sourceNode = makeNode({ id: 'node-source', name: 'Source' });

      sharedStorageVerifier.verifyFileAccess.mockResolvedValue({
        isAccessible: true,
        isMounted: true,
        mountPoint: '/mnt/shared',
        translatedPath: '/mnt/shared/movie.mkv',
        error: null,
      });

      prisma.$transaction.mockImplementation(async (fn: (tx: any) => any) => {
        const tx = {
          job: {
            findUnique: jest
              .fn()
              .mockResolvedValueOnce(job)
              .mockResolvedValueOnce({ ...job, filePath: '/mnt/shared/movie.mkv' }),
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
          },
          node: {
            findUnique: jest
              .fn()
              .mockResolvedValueOnce(targetNode)
              .mockResolvedValueOnce(sourceNode),
          },
        };
        return fn(tx);
      });

      await service.delegateJob('job-1', 'node-2');

      expect(sharedStorageVerifier.verifyFileAccess).toHaveBeenCalled();
    });

    it('should set transferRequired=true when shared storage verification fails', async () => {
      const job = makeDbJob({ nodeId: 'node-1', library: { nodeId: 'node-source' } });
      const targetNode = makeNode({ id: 'node-2', hasSharedStorage: true });
      const sourceNode = makeNode({ id: 'node-source', name: 'Source' });

      sharedStorageVerifier.verifyFileAccess.mockResolvedValue({
        isAccessible: false,
        isMounted: false,
        mountPoint: null,
        translatedPath: undefined,
        error: 'Mount not found',
      });

      prisma.$transaction.mockImplementation(async (fn: (tx: any) => any) => {
        const tx = {
          job: {
            findUnique: jest.fn().mockResolvedValueOnce(job).mockResolvedValueOnce(job),
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
          },
          node: {
            findUnique: jest
              .fn()
              .mockResolvedValueOnce(targetNode)
              .mockResolvedValueOnce(sourceNode)
              .mockResolvedValueOnce(sourceNode),
          },
        };
        return fn(tx);
      });

      fileTransferService.transferFile.mockResolvedValue(undefined);

      await service.delegateJob('job-1', 'node-2');

      expect((service as any).logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Shared storage verification failed')
      );
    });

    it('should convert FAILED stage to QUEUED on delegation', async () => {
      setupTx({ stage: 'FAILED', error: 'old error', retryCount: 2 });

      await service.delegateJob('job-1', 'node-2');

      const txCall = prisma.$transaction.mock.calls[0][0];
      const capturedTx = {
        job: {
          findUnique: jest
            .fn()
            .mockResolvedValueOnce(
              makeDbJob({ stage: 'FAILED', error: 'old error', retryCount: 2 })
            )
            .mockResolvedValueOnce(makeDbJob({ stage: 'QUEUED' })),
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        node: {
          findUnique: jest
            .fn()
            .mockResolvedValueOnce(makeNode())
            .mockResolvedValueOnce(makeNode({ id: 'node-1', name: 'Main' })),
        },
      };
      const result = await txCall(capturedTx);

      expect(capturedTx.job.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            stage: 'QUEUED',
            error: null,
            retryCount: 0,
          }),
        })
      );
      expect(result).not.toBeNull();
    });

    it('should throw BadRequestException when updateMany count is 0 (race condition)', async () => {
      prisma.$transaction.mockImplementation(async (fn: (tx: any) => any) => {
        return fn({
          job: {
            findUnique: jest.fn().mockResolvedValue(makeDbJob()),
            updateMany: jest.fn().mockResolvedValue({ count: 0 }),
          },
          node: {
            findUnique: jest
              .fn()
              .mockResolvedValueOnce(makeNode())
              .mockResolvedValueOnce(makeNode({ id: 'node-1', name: 'Main' })),
          },
        });
      });

      await expect(service.delegateJob('job-1', 'node-2')).rejects.toThrow(
        'Job stage changed during delegation'
      );
    });

    it('should convert ENCODING stage to PAUSED on delegation', async () => {
      prisma.$transaction.mockImplementation(async (fn: (tx: any) => any) => {
        const tx = {
          job: {
            findUnique: jest
              .fn()
              .mockResolvedValueOnce(makeDbJob({ stage: 'ENCODING' }))
              .mockResolvedValueOnce(makeDbJob({ stage: 'PAUSED' })),
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
          },
          node: {
            findUnique: jest
              .fn()
              .mockResolvedValueOnce(makeNode())
              .mockResolvedValueOnce(makeNode({ id: 'node-1', name: 'Main' })),
          },
        };
        return fn(tx);
      });

      await service.delegateJob('job-1', 'node-2');

      const lastCall = prisma.$transaction.mock.calls[0][0];
      const captureTx = {
        job: {
          findUnique: jest
            .fn()
            .mockResolvedValueOnce(makeDbJob({ stage: 'ENCODING' }))
            .mockResolvedValueOnce(makeDbJob({ stage: 'PAUSED' })),
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        node: {
          findUnique: jest
            .fn()
            .mockResolvedValueOnce(makeNode())
            .mockResolvedValueOnce(makeNode({ id: 'node-1', name: 'Main' })),
        },
      };
      await lastCall(captureTx);

      expect(captureTx.job.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ stage: 'PAUSED' }),
        })
      );
    });
  });

  // ─── rebalanceJobs ───────────────────────────────────────────────────────────

  describe('rebalanceJobs', () => {
    it('should delegate to jobRouterService', async () => {
      jobRouterService.rebalanceJobs.mockResolvedValue(3);

      const result = await service.rebalanceJobs();

      expect(jobRouterService.rebalanceJobs).toHaveBeenCalled();
      expect(result).toBe(3);
    });
  });

  // ─── fixStuckTransfers ───────────────────────────────────────────────────────

  describe('fixStuckTransfers', () => {
    it('should return 0 when no stuck transfers found', async () => {
      jobRepository.findManyWithInclude.mockResolvedValue([]);

      const result = await service.fixStuckTransfers();

      expect(result).toBe(0);
      expect(jobRepository.updateById).not.toHaveBeenCalled();
    });

    it('should reset each stuck transfer to QUEUED', async () => {
      const stuckJobs = [
        {
          id: 'job-a',
          fileLabel: 'a.mkv',
          nodeId: 'node-1',
          node: { name: 'Main', hasSharedStorage: true },
        },
        {
          id: 'job-b',
          fileLabel: 'b.mkv',
          nodeId: 'node-2',
          node: { name: 'Worker', hasSharedStorage: false },
        },
      ];
      jobRepository.findManyWithInclude.mockResolvedValue(stuckJobs);
      jobRepository.updateById.mockResolvedValue(undefined as any);

      const result = await service.fixStuckTransfers();

      expect(result).toBe(2);
      expect(jobRepository.updateById).toHaveBeenCalledTimes(2);
    });

    it('should set transferRequired based on node hasSharedStorage flag', async () => {
      const stuckJobs = [
        {
          id: 'job-a',
          fileLabel: 'a.mkv',
          nodeId: 'node-1',
          node: { name: 'Main', hasSharedStorage: true },
        },
      ];
      jobRepository.findManyWithInclude.mockResolvedValue(stuckJobs);
      jobRepository.updateById.mockResolvedValue(undefined as any);

      await service.fixStuckTransfers();

      expect(jobRepository.updateById).toHaveBeenCalledWith(
        'job-a',
        expect.objectContaining({
          transferRequired: false, // !hasSharedStorage = !true = false
          stage: 'QUEUED',
        })
      );
    });

    it('should set transferRequired=true when node has no shared storage', async () => {
      const stuckJobs = [
        {
          id: 'job-b',
          fileLabel: 'b.mkv',
          nodeId: 'node-2',
          node: { name: 'Worker', hasSharedStorage: false },
        },
      ];
      jobRepository.findManyWithInclude.mockResolvedValue(stuckJobs);
      jobRepository.updateById.mockResolvedValue(undefined as any);

      await service.fixStuckTransfers();

      expect(jobRepository.updateById).toHaveBeenCalledWith(
        'job-b',
        expect.objectContaining({
          transferRequired: true,
        })
      );
    });

    it('should handle null node gracefully (transferRequired=true by default)', async () => {
      const stuckJobs = [{ id: 'job-c', fileLabel: 'c.mkv', nodeId: null, node: null }];
      jobRepository.findManyWithInclude.mockResolvedValue(stuckJobs);
      jobRepository.updateById.mockResolvedValue(undefined as any);

      await service.fixStuckTransfers();

      expect(jobRepository.updateById).toHaveBeenCalledWith(
        'job-c',
        expect.objectContaining({
          transferRequired: true, // !null?.hasSharedStorage = !undefined = true
        })
      );
    });
  });
});
