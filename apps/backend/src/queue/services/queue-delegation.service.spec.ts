import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JobStage } from '@prisma/client';
import { JobRepository } from '../../common/repositories/job.repository';
import { SharedStorageVerifierService } from '../../nodes/services/shared-storage-verifier.service';
import { PrismaService } from '../../prisma/prisma.service';
import { FileTransferService } from './file-transfer.service';
import { JobRouterService } from './job-router.service';
import { QueueDelegationService } from './queue-delegation.service';
import { QueueJobCrudService } from './queue-job-crud.service';
import { QueueJobStateService } from './queue-job-state.service';

describe('QueueDelegationService', () => {
  let service: QueueDelegationService;
  let mockPrisma: any;
  let mockJobRepository: jest.Mocked<JobRepository>;
  let mockJobRouterService: jest.Mocked<JobRouterService>;
  let mockFileTransferService: jest.Mocked<FileTransferService>;
  let mockSharedStorageVerifier: jest.Mocked<SharedStorageVerifierService>;
  let mockJobCrudService: jest.Mocked<QueueJobCrudService>;
  let mockJobStateService: jest.Mocked<QueueJobStateService>;

  beforeEach(async () => {
    mockPrisma = {
      $transaction: jest.fn(),
    };

    mockJobRepository = {
      findManyWithInclude: jest.fn(),
      updateById: jest.fn(),
    } as any;

    mockJobRouterService = {
      rebalanceJobs: jest.fn(),
    } as any;

    mockFileTransferService = {
      transferFile: jest.fn().mockResolvedValue(undefined),
    } as any;

    mockSharedStorageVerifier = {
      verifyFileAccess: jest.fn(),
    } as any;

    mockJobCrudService = {
      update: jest.fn(),
    } as any;

    mockJobStateService = {
      failJob: jest.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QueueDelegationService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: JobRepository, useValue: mockJobRepository },
        { provide: JobRouterService, useValue: mockJobRouterService },
        { provide: FileTransferService, useValue: mockFileTransferService },
        { provide: SharedStorageVerifierService, useValue: mockSharedStorageVerifier },
        { provide: QueueJobCrudService, useValue: mockJobCrudService },
        { provide: QueueJobStateService, useValue: mockJobStateService },
      ],
    }).compile();

    service = module.get<QueueDelegationService>(QueueDelegationService);
  });

  describe('fixStuckTransfers', () => {
    it('should return 0 when no stuck transfers found', async () => {
      mockJobRepository.findManyWithInclude.mockResolvedValue([]);

      const count = await service.fixStuckTransfers();
      expect(count).toBe(0);
    });

    it('should reset stuck transfers to QUEUED', async () => {
      const stuckJob = {
        id: 'job-1',
        fileLabel: 'movie.mkv',
        nodeId: 'node-1',
        node: { name: 'Node 1', hasSharedStorage: true },
      };
      mockJobRepository.findManyWithInclude.mockResolvedValue([stuckJob as any]);
      mockJobRepository.updateById.mockResolvedValue({ id: 'job-1', stage: 'QUEUED' } as any);

      const count = await service.fixStuckTransfers();

      expect(count).toBe(1);
      expect(mockJobRepository.updateById).toHaveBeenCalledWith(
        'job-1',
        expect.objectContaining({
          stage: 'QUEUED',
          transferProgress: 0,
        })
      );
    });
  });

  describe('rebalanceJobs', () => {
    it('should delegate to JobRouterService', async () => {
      mockJobRouterService.rebalanceJobs.mockResolvedValue(3);

      const count = await service.rebalanceJobs();

      expect(count).toBe(3);
      expect(mockJobRouterService.rebalanceJobs).toHaveBeenCalled();
    });
  });

  describe('delegateJob', () => {
    it('should throw NotFoundException when job not found', async () => {
      mockPrisma.$transaction.mockImplementation(async (cb: any) => {
        const tx = { job: { findUnique: jest.fn().mockResolvedValue(null) } };
        return cb(tx);
      });

      await expect(service.delegateJob('missing', 'node-2')).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException when job already assigned to target node', async () => {
      mockPrisma.$transaction.mockImplementation(async (cb: any) => {
        const tx = {
          job: {
            findUnique: jest.fn().mockResolvedValue({
              id: 'job-1',
              nodeId: 'node-1',
              stage: 'QUEUED',
              library: { nodeId: 'node-1' },
            }),
          },
        };
        return cb(tx);
      });

      await expect(service.delegateJob('job-1', 'node-1')).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException for invalid stage', async () => {
      mockPrisma.$transaction.mockImplementation(async (cb: any) => {
        const tx = {
          job: {
            findUnique: jest.fn().mockResolvedValue({
              id: 'job-1',
              nodeId: 'node-1',
              stage: 'COMPLETED',
              library: { nodeId: 'node-1' },
            }),
          },
        };
        return cb(tx);
      });

      await expect(service.delegateJob('job-1', 'node-2')).rejects.toThrow(BadRequestException);
    });
  });

  describe('cleanupStuckTransfers', () => {
    it('should fail job after 3 retries', async () => {
      const stuckJob = {
        id: 'job-1',
        fileLabel: 'movie.mkv',
        transferRetryCount: 3,
        transferProgress: 50,
        transferStartedAt: new Date(Date.now() - 2 * 60 * 60 * 1000), // 2 hours ago
      };
      mockJobRepository.findManyWithInclude.mockResolvedValue([stuckJob as any]);
      mockJobStateService.failJob.mockResolvedValue({ id: 'job-1', stage: JobStage.FAILED } as any);

      await service.cleanupStuckTransfers();

      expect(mockJobStateService.failJob).toHaveBeenCalledWith(
        'job-1',
        expect.stringContaining('retry')
      );
    });

    it('should reset job to DETECTED for retry < 3', async () => {
      const stuckJob = {
        id: 'job-1',
        fileLabel: 'movie.mkv',
        transferRetryCount: 1,
        transferProgress: 30,
        transferStartedAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
      };
      mockJobRepository.findManyWithInclude.mockResolvedValue([stuckJob as any]);
      mockJobCrudService.update.mockResolvedValue({ id: 'job-1', stage: JobStage.DETECTED } as any);

      await service.cleanupStuckTransfers();

      expect(mockJobCrudService.update).toHaveBeenCalledWith(
        'job-1',
        expect.objectContaining({
          stage: JobStage.DETECTED,
          transferRetryCount: 2,
        })
      );
    });

    it('should do nothing when no stuck transfers found', async () => {
      mockJobRepository.findManyWithInclude.mockResolvedValue([]);

      await service.cleanupStuckTransfers();

      expect(mockJobStateService.failJob).not.toHaveBeenCalled();
      expect(mockJobCrudService.update).not.toHaveBeenCalled();
    });

    it('should handle null transferRetryCount as 0', async () => {
      const stuckJob = {
        id: 'job-2',
        fileLabel: 'video.mkv',
        transferRetryCount: null,
        transferProgress: 0,
        transferStartedAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
      };
      mockJobRepository.findManyWithInclude.mockResolvedValue([stuckJob as any]);
      mockJobCrudService.update.mockResolvedValue({ id: 'job-2' } as any);

      await service.cleanupStuckTransfers();

      expect(mockJobCrudService.update).toHaveBeenCalledWith(
        'job-2',
        expect.objectContaining({
          transferRetryCount: 1,
        })
      );
    });

    it('should handle errors without throwing', async () => {
      mockJobRepository.findManyWithInclude.mockRejectedValue(new Error('DB error'));

      await expect(service.cleanupStuckTransfers()).resolves.toBeUndefined();
    });
  });

  describe('delegateJob - additional branches', () => {
    it('should throw NotFoundException when target node not found', async () => {
      mockPrisma.$transaction.mockImplementation(async (cb: (tx: unknown) => unknown) => {
        const tx = {
          job: {
            findUnique: jest.fn().mockResolvedValue({
              id: 'job-1',
              nodeId: 'node-1',
              stage: 'QUEUED',
              library: { nodeId: 'node-1' },
              originalNodeId: null,
              filePath: '/mnt/file.mkv',
              originalFilePath: null,
              error: null,
              retryCount: 0,
              transferProgress: 0,
            }),
          },
          node: {
            findUnique: jest.fn().mockResolvedValue(null),
          },
        };
        return cb(tx);
      });

      await expect(service.delegateJob('job-1', 'node-2')).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException when target node is not ONLINE', async () => {
      mockPrisma.$transaction.mockImplementation(async (cb: (tx: unknown) => unknown) => {
        const tx = {
          job: {
            findUnique: jest.fn().mockResolvedValue({
              id: 'job-1',
              nodeId: 'node-1',
              stage: 'QUEUED',
              library: { nodeId: 'node-1' },
            }),
          },
          node: {
            findUnique: jest.fn().mockResolvedValue({
              id: 'node-2',
              name: 'Node 2',
              status: 'OFFLINE',
              hasSharedStorage: false,
            }),
          },
        };
        return cb(tx);
      });

      await expect(service.delegateJob('job-1', 'node-2')).rejects.toThrow(BadRequestException);
    });

    it('should set targetStage to QUEUED when FAILED job is delegated', async () => {
      const updatedJob = { id: 'job-1', stage: 'QUEUED', nodeId: 'node-2' };
      mockPrisma.$transaction.mockImplementation(async (cb: (tx: unknown) => unknown) => {
        const jobFindUnique = jest
          .fn()
          .mockResolvedValueOnce({
            id: 'job-1',
            nodeId: 'node-1',
            stage: 'FAILED',
            library: { nodeId: 'node-1' },
            originalNodeId: null,
            filePath: '/mnt/file.mkv',
            originalFilePath: null,
            error: 'some error',
            retryCount: 2,
            transferProgress: 0,
          })
          .mockResolvedValueOnce(updatedJob);
        const tx = {
          job: {
            findUnique: jobFindUnique,
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
          },
          node: {
            findUnique: jest.fn().mockResolvedValue({
              id: 'node-2',
              name: 'Node 2',
              status: 'ONLINE',
              hasSharedStorage: false,
            }),
          },
        };
        return cb(tx);
      });

      const result = await service.delegateJob('job-1', 'node-2');

      expect(result).toEqual(updatedJob);
    });

    it('should throw BadRequestException when job stage changes during delegation', async () => {
      mockPrisma.$transaction.mockImplementation(async (cb: (tx: unknown) => unknown) => {
        const tx = {
          job: {
            findUnique: jest
              .fn()
              .mockResolvedValueOnce({
                id: 'job-1',
                nodeId: 'node-1',
                stage: 'QUEUED',
                library: { nodeId: 'node-1' },
                originalNodeId: null,
                filePath: '/mnt/file.mkv',
                originalFilePath: null,
                error: null,
                retryCount: 0,
                transferProgress: 0,
              })
              .mockResolvedValueOnce(null),
            updateMany: jest.fn().mockResolvedValue({ count: 0 }),
          },
          node: {
            findUnique: jest.fn().mockResolvedValue({
              id: 'node-2',
              name: 'Node 2',
              status: 'ONLINE',
              hasSharedStorage: false,
            }),
          },
        };
        return cb(tx);
      });

      await expect(service.delegateJob('job-1', 'node-2')).rejects.toThrow(BadRequestException);
    });

    it('should use shared storage path when verified accessible', async () => {
      const updatedJob = { id: 'job-1', stage: 'QUEUED', nodeId: 'node-2' };
      mockSharedStorageVerifier.verifyFileAccess.mockResolvedValue({
        isAccessible: true,
        isMounted: true,
        mountPoint: '/mnt/node2',
        error: null,
        translatedPath: '/mnt/node2/file.mkv',
      });

      mockPrisma.$transaction.mockImplementation(async (cb: (tx: unknown) => unknown) => {
        const jobFindUnique = jest
          .fn()
          .mockResolvedValueOnce({
            id: 'job-1',
            nodeId: 'node-1',
            stage: 'QUEUED',
            library: { nodeId: 'source-node' },
            originalNodeId: null,
            filePath: '/mnt/source/file.mkv',
            originalFilePath: null,
            error: null,
            retryCount: 0,
            transferProgress: 0,
          })
          .mockResolvedValueOnce(updatedJob);
        const nodeFindUnique = jest
          .fn()
          .mockResolvedValueOnce({
            id: 'node-2',
            name: 'Node 2',
            status: 'ONLINE',
            hasSharedStorage: true,
          })
          .mockResolvedValueOnce({
            id: 'source-node',
            name: 'Source Node',
          });
        const tx = {
          job: {
            findUnique: jobFindUnique,
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
          },
          node: {
            findUnique: nodeFindUnique,
          },
        };
        return cb(tx);
      });

      const result = await service.delegateJob('job-1', 'node-2');

      expect(result).toEqual(updatedJob);
      expect(mockSharedStorageVerifier.verifyFileAccess).toHaveBeenCalled();
    });

    it('should fall back to file transfer when shared storage verification fails', async () => {
      const updatedJob = { id: 'job-1', stage: 'QUEUED', nodeId: 'node-2' };
      mockSharedStorageVerifier.verifyFileAccess.mockResolvedValue({
        isAccessible: false,
        isMounted: false,
        mountPoint: null,
        error: 'Cannot access path',
      });
      mockFileTransferService.transferFile.mockResolvedValue(undefined);

      mockPrisma.$transaction.mockImplementation(async (cb: (tx: unknown) => unknown) => {
        const jobFindUnique = jest
          .fn()
          .mockResolvedValueOnce({
            id: 'job-1',
            nodeId: 'node-1',
            stage: 'QUEUED',
            library: { nodeId: 'source-node' },
            originalNodeId: null,
            filePath: '/mnt/source/file.mkv',
            originalFilePath: null,
            error: null,
            retryCount: 0,
            transferProgress: 0,
          })
          .mockResolvedValueOnce(updatedJob);
        const nodeFindUnique = jest
          .fn()
          .mockResolvedValueOnce({
            id: 'node-2',
            name: 'Node 2',
            status: 'ONLINE',
            hasSharedStorage: true,
          })
          .mockResolvedValueOnce({
            id: 'source-node',
            name: 'Source Node',
          })
          .mockResolvedValueOnce({
            id: 'source-node',
            name: 'Source Node',
          });
        const tx = {
          job: {
            findUnique: jobFindUnique,
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
          },
          node: {
            findUnique: nodeFindUnique,
          },
        };
        return cb(tx);
      });

      const result = await service.delegateJob('job-1', 'node-2');

      expect(result).toEqual(updatedJob);
    });

    it('should throw NotFoundException when source node not found', async () => {
      mockPrisma.$transaction.mockImplementation(async (cb: (tx: unknown) => unknown) => {
        const nodeFindUnique = jest
          .fn()
          .mockResolvedValueOnce({
            id: 'node-2',
            name: 'Node 2',
            status: 'ONLINE',
            hasSharedStorage: false,
          })
          .mockResolvedValueOnce(null); // source node not found
        const tx = {
          job: {
            findUnique: jest.fn().mockResolvedValue({
              id: 'job-1',
              nodeId: 'node-1',
              stage: 'QUEUED',
              library: { nodeId: 'source-node' },
              originalNodeId: null,
              filePath: '/mnt/file.mkv',
              originalFilePath: null,
              error: null,
              retryCount: 0,
              transferProgress: 0,
            }),
          },
          node: { findUnique: nodeFindUnique },
        };
        return cb(tx);
      });

      await expect(service.delegateJob('job-1', 'node-2')).rejects.toThrow(NotFoundException);
    });
  });

  describe('fixStuckTransfers - additional branches', () => {
    it('should set transferRequired=false when node has shared storage', async () => {
      const stuckJob = {
        id: 'job-shared',
        fileLabel: 'video.mp4',
        nodeId: 'node-1',
        node: { name: 'Node 1', hasSharedStorage: true },
      };
      mockJobRepository.findManyWithInclude.mockResolvedValue([stuckJob as any]);
      mockJobRepository.updateById.mockResolvedValue({ id: 'job-shared' } as any);

      await service.fixStuckTransfers();

      expect(mockJobRepository.updateById).toHaveBeenCalledWith(
        'job-shared',
        expect.objectContaining({ transferRequired: false })
      );
    });

    it('should set transferRequired=true when node has no shared storage', async () => {
      const stuckJob = {
        id: 'job-notshared',
        fileLabel: 'video.mp4',
        nodeId: 'node-1',
        node: { name: 'Node 1', hasSharedStorage: false },
      };
      mockJobRepository.findManyWithInclude.mockResolvedValue([stuckJob as any]);
      mockJobRepository.updateById.mockResolvedValue({ id: 'job-notshared' } as any);

      await service.fixStuckTransfers();

      expect(mockJobRepository.updateById).toHaveBeenCalledWith(
        'job-notshared',
        expect.objectContaining({ transferRequired: true })
      );
    });

    it('should handle null node gracefully', async () => {
      const stuckJob = {
        id: 'job-nonode',
        fileLabel: 'file.mkv',
        nodeId: null,
        node: null,
      };
      mockJobRepository.findManyWithInclude.mockResolvedValue([stuckJob as any]);
      mockJobRepository.updateById.mockResolvedValue({ id: 'job-nonode' } as any);

      await service.fixStuckTransfers();

      expect(mockJobRepository.updateById).toHaveBeenCalledWith(
        'job-nonode',
        expect.objectContaining({ transferRequired: true })
      );
    });
  });
});
