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
      transferFile: jest.fn(),
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
  });
});
