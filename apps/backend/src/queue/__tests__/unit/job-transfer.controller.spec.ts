import { NotFoundException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { JobStage } from '@prisma/client';
import { JwtAuthGuard } from '../../../auth/guards/jwt-auth.guard';
import { JobTransferController } from '../../controllers/job-transfer.controller';
import { QueueService } from '../../queue.service';
import type { TransferProgress } from '../../services/file-transfer.service';
import { FileTransferService } from '../../services/file-transfer.service';

describe('JobTransferController', () => {
  let controller: JobTransferController;
  let queueService: Record<string, jest.Mock>;
  let fileTransferService: Record<string, jest.Mock>;

  const mockTransferProgress: TransferProgress = {
    jobId: 'job-1',
    progress: 45,
    speedMBps: 120.5,
    bytesTransferred: BigInt(4718592000),
    totalBytes: BigInt(10737418240),
    eta: 50,
    status: 'TRANSFERRING',
  };

  const mockTransferringJob = {
    id: 'job-1',
    filePath: '/mnt/user/media/Movies/Avatar.mkv',
    fileLabel: 'Avatar (2009).mkv',
    stage: JobStage.TRANSFERRING,
    progress: 45,
    nodeId: 'node-1',
  };

  beforeEach(async () => {
    queueService = {
      findAll: jest.fn(),
    };

    fileTransferService = {
      getTransferProgress: jest.fn(),
      cancelTransfer: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [JobTransferController],
      providers: [
        { provide: QueueService, useValue: queueService },
        { provide: FileTransferService, useValue: fileTransferService },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<JobTransferController>(JobTransferController);

    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  // ─── GET /queue/transfers/active ────────────────────────────────────

  describe('getActiveTransfers', () => {
    it('should return paginated list of TRANSFERRING jobs', async () => {
      const paginatedResult = {
        jobs: [mockTransferringJob],
        total: 1,
        page: 1,
        limit: 50,
        totalPages: 1,
      };
      queueService.findAll.mockResolvedValue(paginatedResult);

      const result = await controller.getActiveTransfers();

      expect(result).toEqual(paginatedResult);
      expect(queueService.findAll).toHaveBeenCalledWith('TRANSFERRING');
    });

    it('should return empty list when no transfers are active', async () => {
      const paginatedResult = {
        jobs: [],
        total: 0,
        page: 1,
        limit: 50,
        totalPages: 0,
      };
      queueService.findAll.mockResolvedValue(paginatedResult);

      const result = await controller.getActiveTransfers();

      expect(result).toEqual(paginatedResult);
      expect(queueService.findAll).toHaveBeenCalledWith('TRANSFERRING');
    });

    it('should return multiple active transfers', async () => {
      const secondJob = { ...mockTransferringJob, id: 'job-2', fileLabel: 'Dune (2021).mkv' };
      const paginatedResult = {
        jobs: [mockTransferringJob, secondJob],
        total: 2,
        page: 1,
        limit: 50,
        totalPages: 1,
      };
      queueService.findAll.mockResolvedValue(paginatedResult);

      const result = (await controller.getActiveTransfers()) as typeof paginatedResult;

      expect(result.total).toBe(2);
      expect(result.jobs).toHaveLength(2);
    });

    it('should propagate errors from QueueService', async () => {
      queueService.findAll.mockRejectedValue(new Error('Database connection lost'));

      await expect(controller.getActiveTransfers()).rejects.toThrow('Database connection lost');
    });
  });

  // ─── GET /queue/:id/transfer/progress ───────────────────────────────

  describe('getTransferProgress', () => {
    it('should return transfer progress for a valid job', async () => {
      fileTransferService.getTransferProgress.mockResolvedValue(mockTransferProgress);

      const result = await controller.getTransferProgress('job-1');

      expect(result).toEqual(mockTransferProgress);
      expect(fileTransferService.getTransferProgress).toHaveBeenCalledWith('job-1');
    });

    it('should return progress with all fields populated', async () => {
      fileTransferService.getTransferProgress.mockResolvedValue(mockTransferProgress);

      const result = (await controller.getTransferProgress('job-1')) as TransferProgress;

      expect(result.progress).toBe(45);
      expect(result.speedMBps).toBe(120.5);
      expect(result.eta).toBe(50);
      expect(result.status).toBe('TRANSFERRING');
    });

    it('should return progress for a completed transfer', async () => {
      const completedProgress: TransferProgress = {
        jobId: 'job-1',
        progress: 100,
        speedMBps: null,
        bytesTransferred: BigInt(10737418240),
        totalBytes: BigInt(10737418240),
        eta: null,
        status: 'COMPLETED',
      };
      fileTransferService.getTransferProgress.mockResolvedValue(completedProgress);

      const result = (await controller.getTransferProgress('job-1')) as TransferProgress;

      expect(result.status).toBe('COMPLETED');
      expect(result.progress).toBe(100);
      expect(result.eta).toBeNull();
    });

    it('should return progress for a failed transfer', async () => {
      const failedProgress: TransferProgress = {
        jobId: 'job-1',
        progress: 30,
        speedMBps: null,
        bytesTransferred: BigInt(3221225472),
        totalBytes: BigInt(10737418240),
        eta: null,
        status: 'FAILED',
        error: 'SSH connection refused',
      };
      fileTransferService.getTransferProgress.mockResolvedValue(failedProgress);

      const result = (await controller.getTransferProgress('job-1')) as TransferProgress;

      expect(result.status).toBe('FAILED');
      expect(result.error).toBe('SSH connection refused');
    });

    it('should return pending progress when transfer has not started', async () => {
      const pendingProgress: TransferProgress = {
        jobId: 'job-2',
        progress: 0,
        speedMBps: null,
        bytesTransferred: BigInt(0),
        totalBytes: BigInt(5368709120),
        eta: null,
        status: 'PENDING',
      };
      fileTransferService.getTransferProgress.mockResolvedValue(pendingProgress);

      const result = (await controller.getTransferProgress('job-2')) as TransferProgress;

      expect(result.status).toBe('PENDING');
      expect(result.progress).toBe(0);
    });

    it('should throw NotFoundException when job does not exist', async () => {
      fileTransferService.getTransferProgress.mockRejectedValue(
        new NotFoundException('Job not found')
      );

      await expect(controller.getTransferProgress('non-existent')).rejects.toThrow(
        NotFoundException
      );
      expect(fileTransferService.getTransferProgress).toHaveBeenCalledWith('non-existent');
    });

    it('should pass the correct job ID to FileTransferService', async () => {
      const jobId = 'clq8x9z8x0000qh8x9z8x0000';
      fileTransferService.getTransferProgress.mockResolvedValue(mockTransferProgress);

      await controller.getTransferProgress(jobId);

      expect(fileTransferService.getTransferProgress).toHaveBeenCalledWith(jobId);
    });
  });

  // ─── POST /queue/:id/transfer/cancel ────────────────────────────────

  describe('cancelTransfer', () => {
    it('should cancel an active transfer successfully', async () => {
      fileTransferService.cancelTransfer.mockResolvedValue(undefined);

      const result = await controller.cancelTransfer('job-1');

      expect(result).toBeUndefined();
      expect(fileTransferService.cancelTransfer).toHaveBeenCalledWith('job-1');
    });

    it('should call cancelTransfer with the correct job ID', async () => {
      const jobId = 'clq8x9z8x0000qh8x9z8x0000';
      fileTransferService.cancelTransfer.mockResolvedValue(undefined);

      await controller.cancelTransfer(jobId);

      expect(fileTransferService.cancelTransfer).toHaveBeenCalledWith(jobId);
      expect(fileTransferService.cancelTransfer).toHaveBeenCalledTimes(1);
    });

    it('should throw NotFoundException when job does not exist', async () => {
      fileTransferService.cancelTransfer.mockRejectedValue(
        new NotFoundException('Job not found or no active transfer')
      );

      await expect(controller.cancelTransfer('non-existent')).rejects.toThrow(NotFoundException);
      await expect(controller.cancelTransfer('non-existent')).rejects.toThrow(
        'Job not found or no active transfer'
      );
    });

    it('should throw an error when there is no active transfer for the job', async () => {
      fileTransferService.cancelTransfer.mockRejectedValue(
        new NotFoundException('No active transfer found for job "job-1"')
      );

      await expect(controller.cancelTransfer('job-1')).rejects.toThrow(NotFoundException);
    });

    it('should propagate generic errors from FileTransferService', async () => {
      fileTransferService.cancelTransfer.mockRejectedValue(new Error('rsync process kill failed'));

      await expect(controller.cancelTransfer('job-1')).rejects.toThrow('rsync process kill failed');
    });
  });
});
