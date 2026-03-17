import { Test, type TestingModule } from '@nestjs/testing';
import { JobStage } from '@prisma/client';
import { PrismaService } from '../../../../prisma/prisma.service';
import { createMockPrismaService } from '../../../../testing/mock-providers';
import { BatchOperationsService } from '../../batch-operations.service';

describe('BatchOperationsService', () => {
  let service: BatchOperationsService;
  let prisma: ReturnType<typeof createMockPrismaService>;

  beforeEach(async () => {
    prisma = createMockPrismaService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [BatchOperationsService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get<BatchOperationsService>(BatchOperationsService);

    jest.spyOn((service as any).logger, 'log').mockImplementation();
    jest.spyOn((service as any).logger, 'warn').mockImplementation();
    jest.spyOn((service as any).logger, 'debug').mockImplementation();
    jest.spyOn((service as any).logger, 'error').mockImplementation();
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  describe('pauseAll', () => {
    it('should pause all queued jobs', async () => {
      prisma.job.updateMany.mockResolvedValue({ count: 5 });

      const result = await service.pauseAll();

      expect(result.success).toBe(true);
      expect(result.errors).toEqual([]);
      expect(prisma.job.updateMany).toHaveBeenCalledTimes(2); // Phase 1 + Phase 2
    });

    it('should pause jobs for a specific node', async () => {
      prisma.job.updateMany.mockResolvedValue({ count: 2 });

      const result = await service.pauseAll('node-1');

      expect(result.success).toBe(true);
      // Verify nodeId was included in the where clause
      expect(prisma.job.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            nodeId: 'node-1',
          }),
        })
      );
    });

    it('should handle database errors gracefully', async () => {
      prisma.job.updateMany.mockRejectedValue(new Error('Connection lost'));

      const result = await service.pauseAll();

      expect(result.success).toBe(false);
      expect(result.affectedCount).toBe(0);
      expect(result.errors).toContain('Connection lost');
    });
  });

  describe('resumeAll', () => {
    it('should resume all paused jobs', async () => {
      prisma.job.updateMany.mockResolvedValue({ count: 3 });

      const result = await service.resumeAll();

      expect(result.success).toBe(true);
      expect(result.affectedCount).toBe(3);
      expect(prisma.job.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            stage: JobStage.QUEUED,
          }),
        })
      );
    });

    it('should resume jobs for a specific node', async () => {
      prisma.job.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.resumeAll('node-2');

      expect(result.success).toBe(true);
      expect(prisma.job.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            nodeId: 'node-2',
          }),
        })
      );
    });

    it('should handle database errors', async () => {
      prisma.job.updateMany.mockRejectedValue(new Error('Timeout'));

      const result = await service.resumeAll();

      expect(result.success).toBe(false);
      expect(result.errors).toContain('Timeout');
    });
  });

  describe('cancelAll', () => {
    it('should cancel all active jobs', async () => {
      prisma.job.updateMany.mockResolvedValue({ count: 10 });

      const result = await service.cancelAll();

      expect(result.success).toBe(true);
      expect(result.affectedCount).toBe(10);
      expect(prisma.job.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            stage: JobStage.CANCELLED,
            error: 'Batch cancelled by user',
          }),
        })
      );
    });

    it('should include cancelRequestedAt timestamp', async () => {
      prisma.job.updateMany.mockResolvedValue({ count: 1 });

      await service.cancelAll();

      expect(prisma.job.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            cancelRequestedAt: expect.any(Date),
          }),
        })
      );
    });

    it('should cancel jobs for specific node', async () => {
      prisma.job.updateMany.mockResolvedValue({ count: 3 });

      const result = await service.cancelAll('node-1');

      expect(result.success).toBe(true);
    });

    it('should handle database errors', async () => {
      prisma.job.updateMany.mockRejectedValue(new Error('DB error'));

      const result = await service.cancelAll();

      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
    });
  });

  describe('retryAllFailed', () => {
    it('should retry all failed jobs under retry limit', async () => {
      prisma.job.updateMany.mockResolvedValue({ count: 4 });

      const result = await service.retryAllFailed();

      expect(result.success).toBe(true);
      expect(result.affectedCount).toBe(4);
      expect(prisma.job.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            stage: JobStage.FAILED,
            retryCount: { lt: 3 },
          }),
          data: expect.objectContaining({
            stage: JobStage.QUEUED,
            progress: 0,
          }),
        })
      );
    });

    it('should respect custom maxRetries', async () => {
      prisma.job.updateMany.mockResolvedValue({ count: 2 });

      await service.retryAllFailed(undefined, 5);

      expect(prisma.job.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            retryCount: { lt: 5 },
          }),
        })
      );
    });

    it('should retry only for specific node', async () => {
      prisma.job.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.retryAllFailed('node-3');

      expect(result.success).toBe(true);
    });

    it('should handle database errors', async () => {
      prisma.job.updateMany.mockRejectedValue(new Error('Retry failed'));

      const result = await service.retryAllFailed();

      expect(result.success).toBe(false);
    });
  });

  describe('deleteCompletedOlderThan', () => {
    it('should delete completed jobs older than specified days', async () => {
      prisma.job.deleteMany.mockResolvedValue({ count: 15 });

      const result = await service.deleteCompletedOlderThan(30);

      expect(result.success).toBe(true);
      expect(result.affectedCount).toBe(15);
      expect(prisma.job.deleteMany).toHaveBeenCalledWith({
        where: expect.objectContaining({
          stage: JobStage.COMPLETED,
          completedAt: {
            lt: expect.any(Date),
          },
        }),
      });
    });

    it('should delete for specific node', async () => {
      prisma.job.deleteMany.mockResolvedValue({ count: 5 });

      const result = await service.deleteCompletedOlderThan(7, 'node-1');

      expect(result.success).toBe(true);
      expect(result.affectedCount).toBe(5);
    });

    it('should handle database errors', async () => {
      prisma.job.deleteMany.mockRejectedValue(new Error('Delete failed'));

      const result = await service.deleteCompletedOlderThan(30);

      expect(result.success).toBe(false);
    });
  });

  describe('deleteAllFailed', () => {
    it('should delete all failed jobs', async () => {
      prisma.job.deleteMany.mockResolvedValue({ count: 8 });

      const result = await service.deleteAllFailed();

      expect(result.success).toBe(true);
      expect(result.affectedCount).toBe(8);
      expect(prisma.job.deleteMany).toHaveBeenCalledWith({
        where: expect.objectContaining({
          stage: JobStage.FAILED,
        }),
      });
    });

    it('should delete failed jobs for specific node', async () => {
      prisma.job.deleteMany.mockResolvedValue({ count: 2 });

      const result = await service.deleteAllFailed('node-2');

      expect(result.success).toBe(true);
    });

    it('should handle database errors', async () => {
      prisma.job.deleteMany.mockRejectedValue(new Error('DB down'));

      const result = await service.deleteAllFailed();

      expect(result.success).toBe(false);
    });
  });

  describe('getStats', () => {
    it('should return counts for all stages', async () => {
      prisma.job.count.mockResolvedValue(5);

      const stats = await service.getStats();

      // Should have counts for each stage + PAUSED_LOAD + TOTAL
      expect(stats.TOTAL).toBe(5);
      expect(prisma.job.count).toHaveBeenCalled();
    });

    it('should filter by nodeId', async () => {
      prisma.job.count.mockResolvedValue(2);

      const stats = await service.getStats('node-1');

      expect(stats.TOTAL).toBe(2);
    });
  });

  describe('clearAll', () => {
    it('should reject with wrong confirmation token', async () => {
      const result = await service.clearAll('wrong-token');

      expect(result.success).toBe(false);
      expect(result.errors).toContain(
        'Invalid confirmation token. Use "CLEAR_ALL_JOBS" to confirm.'
      );
      expect(prisma.job.deleteMany).not.toHaveBeenCalled();
    });

    it('should clear all jobs with correct token', async () => {
      prisma.job.deleteMany.mockResolvedValue({ count: 100 });

      const result = await service.clearAll('CLEAR_ALL_JOBS');

      expect(result.success).toBe(true);
      expect(result.affectedCount).toBe(100);
      expect(prisma.job.deleteMany).toHaveBeenCalledWith({});
    });

    it('should handle database errors', async () => {
      prisma.job.deleteMany.mockRejectedValue(new Error('Clear failed'));

      const result = await service.clearAll('CLEAR_ALL_JOBS');

      expect(result.success).toBe(false);
    });
  });
});
