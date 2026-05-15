import { Test, type TestingModule } from '@nestjs/testing';
import { JobStage } from '@prisma/client';
import { JobRepository } from '../../../../common/repositories/job.repository';
import { BatchOperationsService } from '../../batch-operations.service';

describe('BatchOperationsService', () => {
  let service: BatchOperationsService;
  let jobRepository: {
    atomicUpdateMany: jest.Mock;
    deleteManyWhere: jest.Mock;
    countWhere: jest.Mock;
  };

  beforeEach(async () => {
    jobRepository = {
      atomicUpdateMany: jest.fn(),
      deleteManyWhere: jest.fn(),
      countWhere: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [BatchOperationsService, { provide: JobRepository, useValue: jobRepository }],
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
      jobRepository.atomicUpdateMany.mockResolvedValue({ count: 5 });

      const result = await service.pauseAll();

      expect(result.success).toBe(true);
      expect(result.errors).toEqual([]);
      expect(jobRepository.atomicUpdateMany).toHaveBeenCalledTimes(2); // Phase 1 + Phase 2
    });

    it('should pause jobs for a specific node', async () => {
      jobRepository.atomicUpdateMany.mockResolvedValue({ count: 2 });

      const result = await service.pauseAll('node-1');

      expect(result.success).toBe(true);
      // Verify nodeId was included in the where clause
      expect(jobRepository.atomicUpdateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          nodeId: 'node-1',
        }),
        expect.anything()
      );
    });

    it('should handle database errors gracefully', async () => {
      jobRepository.atomicUpdateMany.mockRejectedValue(new Error('Connection lost'));

      const result = await service.pauseAll();

      expect(result.success).toBe(false);
      expect(result.affectedCount).toBe(0);
      expect(result.errors).toContain('Connection lost');
    });
  });

  describe('resumeAll', () => {
    it('should resume all paused jobs', async () => {
      jobRepository.atomicUpdateMany.mockResolvedValue({ count: 3 });

      const result = await service.resumeAll();

      expect(result.success).toBe(true);
      expect(result.affectedCount).toBe(3);
      expect(jobRepository.atomicUpdateMany).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          stage: JobStage.QUEUED,
        })
      );
    });

    it('should resume jobs for a specific node', async () => {
      jobRepository.atomicUpdateMany.mockResolvedValue({ count: 1 });

      const result = await service.resumeAll('node-2');

      expect(result.success).toBe(true);
      expect(jobRepository.atomicUpdateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          nodeId: 'node-2',
        }),
        expect.anything()
      );
    });

    it('should handle database errors', async () => {
      jobRepository.atomicUpdateMany.mockRejectedValue(new Error('Timeout'));

      const result = await service.resumeAll();

      expect(result.success).toBe(false);
      expect(result.errors).toContain('Timeout');
    });
  });

  describe('cancelAll', () => {
    it('should cancel all active jobs', async () => {
      jobRepository.atomicUpdateMany.mockResolvedValue({ count: 10 });

      const result = await service.cancelAll();

      expect(result.success).toBe(true);
      expect(result.affectedCount).toBe(10);
      expect(jobRepository.atomicUpdateMany).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          stage: JobStage.CANCELLED,
          error: 'Batch cancelled by user',
        })
      );
    });

    it('should include cancelRequestedAt timestamp', async () => {
      jobRepository.atomicUpdateMany.mockResolvedValue({ count: 1 });

      await service.cancelAll();

      expect(jobRepository.atomicUpdateMany).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          cancelRequestedAt: expect.any(Date),
        })
      );
    });

    it('should cancel jobs for specific node', async () => {
      jobRepository.atomicUpdateMany.mockResolvedValue({ count: 3 });

      const result = await service.cancelAll('node-1');

      expect(result.success).toBe(true);
    });

    it('should handle database errors', async () => {
      jobRepository.atomicUpdateMany.mockRejectedValue(new Error('DB error'));

      const result = await service.cancelAll();

      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
    });
  });

  describe('retryAllFailed', () => {
    it('should retry all failed jobs under retry limit', async () => {
      jobRepository.atomicUpdateMany.mockResolvedValue({ count: 4 });

      const result = await service.retryAllFailed();

      expect(result.success).toBe(true);
      expect(result.affectedCount).toBe(4);
      expect(jobRepository.atomicUpdateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          stage: JobStage.FAILED,
          retryCount: { lt: 3 },
        }),
        expect.objectContaining({
          stage: JobStage.QUEUED,
          progress: 0,
        })
      );
    });

    it('should respect custom maxRetries', async () => {
      jobRepository.atomicUpdateMany.mockResolvedValue({ count: 2 });

      await service.retryAllFailed(undefined, 5);

      expect(jobRepository.atomicUpdateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          retryCount: { lt: 5 },
        }),
        expect.anything()
      );
    });

    it('should retry only for specific node', async () => {
      jobRepository.atomicUpdateMany.mockResolvedValue({ count: 1 });

      const result = await service.retryAllFailed('node-3');

      expect(result.success).toBe(true);
    });

    it('should handle database errors', async () => {
      jobRepository.atomicUpdateMany.mockRejectedValue(new Error('Retry failed'));

      const result = await service.retryAllFailed();

      expect(result.success).toBe(false);
    });
  });

  describe('deleteCompletedOlderThan', () => {
    it('should delete completed jobs older than specified days', async () => {
      jobRepository.deleteManyWhere.mockResolvedValue({ count: 15 });

      const result = await service.deleteCompletedOlderThan(30);

      expect(result.success).toBe(true);
      expect(result.affectedCount).toBe(15);
      expect(jobRepository.deleteManyWhere).toHaveBeenCalledWith(
        expect.objectContaining({
          stage: JobStage.COMPLETED,
          completedAt: {
            lt: expect.any(Date),
          },
        })
      );
    });

    it('should delete for specific node', async () => {
      jobRepository.deleteManyWhere.mockResolvedValue({ count: 5 });

      const result = await service.deleteCompletedOlderThan(7, 'node-1');

      expect(result.success).toBe(true);
      expect(result.affectedCount).toBe(5);
    });

    it('should handle database errors', async () => {
      jobRepository.deleteManyWhere.mockRejectedValue(new Error('Delete failed'));

      const result = await service.deleteCompletedOlderThan(30);

      expect(result.success).toBe(false);
    });
  });

  describe('deleteAllFailed', () => {
    it('should delete all failed jobs', async () => {
      jobRepository.deleteManyWhere.mockResolvedValue({ count: 8 });

      const result = await service.deleteAllFailed();

      expect(result.success).toBe(true);
      expect(result.affectedCount).toBe(8);
      expect(jobRepository.deleteManyWhere).toHaveBeenCalledWith(
        expect.objectContaining({
          stage: JobStage.FAILED,
        })
      );
    });

    it('should delete failed jobs for specific node', async () => {
      jobRepository.deleteManyWhere.mockResolvedValue({ count: 2 });

      const result = await service.deleteAllFailed('node-2');

      expect(result.success).toBe(true);
    });

    it('should handle database errors', async () => {
      jobRepository.deleteManyWhere.mockRejectedValue(new Error('DB down'));

      const result = await service.deleteAllFailed();

      expect(result.success).toBe(false);
    });
  });

  describe('getStats', () => {
    it('should return counts for all stages', async () => {
      jobRepository.countWhere.mockResolvedValue(5);

      const stats = await service.getStats();

      // Should have counts for each stage + PAUSED_LOAD + TOTAL
      expect(stats.TOTAL).toBe(5);
      expect(jobRepository.countWhere).toHaveBeenCalled();
    });

    it('should filter by nodeId', async () => {
      jobRepository.countWhere.mockResolvedValue(2);

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
      expect(jobRepository.deleteManyWhere).not.toHaveBeenCalled();
    });

    it('should clear all jobs with correct token', async () => {
      jobRepository.deleteManyWhere.mockResolvedValue({ count: 100 });

      const result = await service.clearAll('CLEAR_ALL_JOBS');

      expect(result.success).toBe(true);
      expect(result.affectedCount).toBe(100);
      expect(jobRepository.deleteManyWhere).toHaveBeenCalledWith({});
    });

    it('should handle database errors', async () => {
      jobRepository.deleteManyWhere.mockRejectedValue(new Error('Clear failed'));

      const result = await service.clearAll('CLEAR_ALL_JOBS');

      expect(result.success).toBe(false);
    });
  });
});
