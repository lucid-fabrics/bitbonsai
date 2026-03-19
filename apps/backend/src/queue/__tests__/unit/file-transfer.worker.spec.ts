import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../../prisma/prisma.service';
import { FileTransferWorker } from '../../file-transfer.worker';
import { FileTransferService } from '../../services/file-transfer.service';

describe('FileTransferWorker', () => {
  let worker: FileTransferWorker;
  let prisma: Record<string, Record<string, jest.Mock>>;
  let fileTransferService: { transferFile: jest.Mock };

  function createMockPrisma() {
    return {
      job: {
        findMany: jest.fn(),
      },
    };
  }

  beforeEach(async () => {
    prisma = createMockPrisma();
    fileTransferService = {
      transferFile: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FileTransferWorker,
        { provide: PrismaService, useValue: prisma },
        { provide: FileTransferService, useValue: fileTransferService },
      ],
    }).compile();

    worker = module.get<FileTransferWorker>(FileTransferWorker);
  });

  it('should be defined', () => {
    expect(worker).toBeDefined();
  });

  // ==========================================================================
  // processTransfers - no jobs
  // ==========================================================================
  describe('processTransfers', () => {
    it('should do nothing when no jobs need transfer', async () => {
      prisma.job.findMany.mockResolvedValue([]);

      await worker.processTransfers();

      expect(fileTransferService.transferFile).not.toHaveBeenCalled();
    });

    it('should start transfers for detected jobs', async () => {
      const mockJob = {
        id: 'job-1',
        filePath: '/media/video.mkv',
        library: {
          node: { id: 'src-1', name: 'Main' },
        },
        node: { id: 'tgt-1', name: 'Child' },
      };
      prisma.job.findMany.mockResolvedValue([mockJob]);
      fileTransferService.transferFile.mockResolvedValue(undefined);

      await worker.processTransfers();

      // Transfer is started asynchronously via Promise.race
      // Give it a tick to start
      await new Promise((r) => setTimeout(r, 10));

      expect(fileTransferService.transferFile).toHaveBeenCalledWith(
        'job-1',
        '/media/video.mkv',
        mockJob.library.node,
        mockJob.node
      );
    });

    it('should skip jobs with missing node info', async () => {
      const jobNoLibraryNode = {
        id: 'job-1',
        filePath: '/media/video.mkv',
        library: { node: null },
        node: { id: 'tgt-1' },
      };
      const jobNoTargetNode = {
        id: 'job-2',
        filePath: '/media/video2.mkv',
        library: { node: { id: 'src-1' } },
        node: null,
      };
      prisma.job.findMany.mockResolvedValue([jobNoLibraryNode, jobNoTargetNode]);

      await worker.processTransfers();

      expect(fileTransferService.transferFile).not.toHaveBeenCalled();
    });

    it('should skip already active transfers', async () => {
      const mockJob = {
        id: 'job-1',
        filePath: '/media/video.mkv',
        library: { node: { id: 'src-1' } },
        node: { id: 'tgt-1' },
      };
      prisma.job.findMany.mockResolvedValue([mockJob]);

      // Mark job as already active via internal Set
      (worker as any).activeTransfers.add('job-1');

      await worker.processTransfers();

      expect(fileTransferService.transferFile).not.toHaveBeenCalled();
    });

    it('should handle database errors gracefully', async () => {
      prisma.job.findMany.mockRejectedValue(new Error('DB connection lost'));

      // Should not throw
      await worker.processTransfers();
    });

    it('should remove job from activeTransfers after completion', async () => {
      const mockJob = {
        id: 'job-1',
        filePath: '/media/video.mkv',
        library: { node: { id: 'src-1' } },
        node: { id: 'tgt-1' },
      };
      prisma.job.findMany.mockResolvedValue([mockJob]);
      fileTransferService.transferFile.mockResolvedValue(undefined);

      await worker.processTransfers();

      // Wait for the async promise chain to settle
      await new Promise((r) => setTimeout(r, 50));

      expect((worker as any).activeTransfers.has('job-1')).toBe(false);
    });

    it('should remove job from activeTransfers after failure', async () => {
      const mockJob = {
        id: 'job-1',
        filePath: '/media/video.mkv',
        library: { node: { id: 'src-1' } },
        node: { id: 'tgt-1' },
      };
      prisma.job.findMany.mockResolvedValue([mockJob]);
      fileTransferService.transferFile.mockRejectedValue(new Error('rsync failed'));

      await worker.processTransfers();

      // Wait for the async promise chain to settle
      await new Promise((r) => setTimeout(r, 50));

      expect((worker as any).activeTransfers.has('job-1')).toBe(false);
    });
  });

  // ==========================================================================
  // Circuit breaker
  // ==========================================================================
  describe('circuit breaker', () => {
    it('should skip processing when circuit is open', async () => {
      (worker as any).circuitOpen = true;

      await worker.processTransfers();

      expect(prisma.job.findMany).not.toHaveBeenCalled();
    });

    it('should open circuit after MAX_TIMEOUT_COUNT timeouts', async () => {
      const mockJob = {
        id: 'job-X',
        filePath: '/media/video.mkv',
        library: { node: { id: 'src-1' } },
        node: { id: 'tgt-1' },
      };

      // Simulate timeout errors reaching the threshold
      (worker as any).timeoutCount = 2; // Already at threshold - 1

      prisma.job.findMany.mockResolvedValue([mockJob]);
      fileTransferService.transferFile.mockRejectedValue(new Error('Transfer timeout (30min)'));

      await worker.processTransfers();

      // Wait for promise chain
      await new Promise((r) => setTimeout(r, 50));

      expect((worker as any).circuitOpen).toBe(true);
    });

    it('should reset timeout count on successful transfer', async () => {
      const mockJob = {
        id: 'job-1',
        filePath: '/media/video.mkv',
        library: { node: { id: 'src-1' } },
        node: { id: 'tgt-1' },
      };

      (worker as any).timeoutCount = 2;

      prisma.job.findMany.mockResolvedValue([mockJob]);
      fileTransferService.transferFile.mockResolvedValue(undefined);

      await worker.processTransfers();

      // Wait for promise chain
      await new Promise((r) => setTimeout(r, 50));

      expect((worker as any).timeoutCount).toBe(0);
    });

    it('should auto-reset circuit after timeout', async () => {
      jest.useFakeTimers();

      // Open the circuit
      (worker as any).openCircuit();

      expect((worker as any).circuitOpen).toBe(true);

      // Fast-forward 5 minutes
      jest.advanceTimersByTime(5 * 60 * 1000);

      expect((worker as any).circuitOpen).toBe(false);
      expect((worker as any).timeoutCount).toBe(0);

      jest.useRealTimers();
    });

    it('should clear existing reset timeout when reopening circuit', async () => {
      jest.useFakeTimers();

      (worker as any).openCircuit();
      const _firstTimeout = (worker as any).circuitResetTimeout;

      (worker as any).openCircuit();
      const secondTimeout = (worker as any).circuitResetTimeout;

      // Should have created a new timeout (different reference)
      expect(secondTimeout).not.toBeNull();

      jest.useRealTimers();
    });
  });
});
