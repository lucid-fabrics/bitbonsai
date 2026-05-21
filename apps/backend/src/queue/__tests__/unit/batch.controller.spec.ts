import { Test, type TestingModule } from '@nestjs/testing';
import { JwtAuthGuard } from '../../../auth/guards/jwt-auth.guard';
import { BatchController } from '../../batch.controller';
import { BatchOperationsService } from '../../services/batch-operations.service';

describe('BatchController', () => {
  let controller: BatchController;

  const mockBatchOperations = {
    pauseAll: jest.fn(),
    resumeAll: jest.fn(),
    cancelAll: jest.fn(),
    retryAllFailed: jest.fn(),
    deleteCompletedOlderThan: jest.fn(),
    deleteAllFailed: jest.fn(),
    getStats: jest.fn(),
    clearAll: jest.fn(),
  };

  const batchResult = { success: true, affectedCount: 3, errors: [] };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [BatchController],
      providers: [{ provide: BatchOperationsService, useValue: mockBatchOperations }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<BatchController>(BatchController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('pauseAll', () => {
    it('should call batchOperations.pauseAll without nodeId', async () => {
      mockBatchOperations.pauseAll.mockResolvedValue(batchResult);

      const result = await controller.pauseAll(undefined);

      expect(mockBatchOperations.pauseAll).toHaveBeenCalledWith(undefined);
      expect(result).toEqual(batchResult);
    });

    it('should pass nodeId to batchOperations.pauseAll', async () => {
      mockBatchOperations.pauseAll.mockResolvedValue(batchResult);

      await controller.pauseAll('node-123');

      expect(mockBatchOperations.pauseAll).toHaveBeenCalledWith('node-123');
    });

    it('should propagate service errors', async () => {
      mockBatchOperations.pauseAll.mockRejectedValue(new Error('pause failed'));
      await expect(controller.pauseAll(undefined)).rejects.toThrow('pause failed');
    });
  });

  describe('resumeAll', () => {
    it('should call batchOperations.resumeAll without nodeId', async () => {
      mockBatchOperations.resumeAll.mockResolvedValue(batchResult);

      const result = await controller.resumeAll(undefined);

      expect(mockBatchOperations.resumeAll).toHaveBeenCalledWith(undefined);
      expect(result).toEqual(batchResult);
    });

    it('should pass nodeId to batchOperations.resumeAll', async () => {
      mockBatchOperations.resumeAll.mockResolvedValue(batchResult);

      await controller.resumeAll('node-456');

      expect(mockBatchOperations.resumeAll).toHaveBeenCalledWith('node-456');
    });

    it('should propagate service errors', async () => {
      mockBatchOperations.resumeAll.mockRejectedValue(new Error('resume failed'));
      await expect(controller.resumeAll(undefined)).rejects.toThrow('resume failed');
    });
  });

  describe('cancelAll', () => {
    it('should call batchOperations.cancelAll without nodeId', async () => {
      mockBatchOperations.cancelAll.mockResolvedValue(batchResult);

      const result = await controller.cancelAll(undefined);

      expect(mockBatchOperations.cancelAll).toHaveBeenCalledWith(undefined);
      expect(result).toEqual(batchResult);
    });

    it('should pass nodeId to batchOperations.cancelAll', async () => {
      mockBatchOperations.cancelAll.mockResolvedValue(batchResult);

      await controller.cancelAll('node-789');

      expect(mockBatchOperations.cancelAll).toHaveBeenCalledWith('node-789');
    });

    it('should propagate service errors', async () => {
      mockBatchOperations.cancelAll.mockRejectedValue(new Error('cancel failed'));
      await expect(controller.cancelAll(undefined)).rejects.toThrow('cancel failed');
    });
  });

  describe('retryAllFailed', () => {
    it('should call batchOperations.retryAllFailed with nodeId and maxRetries from dto', async () => {
      const dto = { nodeId: 'node-1', maxRetries: 5 };
      mockBatchOperations.retryAllFailed.mockResolvedValue(batchResult);

      const result = await controller.retryAllFailed(dto);

      expect(mockBatchOperations.retryAllFailed).toHaveBeenCalledWith('node-1', 5);
      expect(result).toEqual(batchResult);
    });

    it('should pass undefined nodeId and undefined maxRetries when dto is empty', async () => {
      mockBatchOperations.retryAllFailed.mockResolvedValue(batchResult);

      await controller.retryAllFailed({});

      expect(mockBatchOperations.retryAllFailed).toHaveBeenCalledWith(undefined, undefined);
    });

    it('should propagate service errors', async () => {
      mockBatchOperations.retryAllFailed.mockRejectedValue(new Error('retry failed'));
      await expect(controller.retryAllFailed({})).rejects.toThrow('retry failed');
    });
  });

  describe('deleteCompleted', () => {
    it('should call deleteCompletedOlderThan with default 30 days when dto is empty', async () => {
      mockBatchOperations.deleteCompletedOlderThan.mockResolvedValue(batchResult);

      const result = await controller.deleteCompleted({});

      expect(mockBatchOperations.deleteCompletedOlderThan).toHaveBeenCalledWith(30, undefined);
      expect(result).toEqual(batchResult);
    });

    it('should call deleteCompletedOlderThan with custom days and nodeId from dto', async () => {
      const dto = { olderThanDays: 7, nodeId: 'node-1' };
      mockBatchOperations.deleteCompletedOlderThan.mockResolvedValue(batchResult);

      await controller.deleteCompleted(dto);

      expect(mockBatchOperations.deleteCompletedOlderThan).toHaveBeenCalledWith(7, 'node-1');
    });

    it('should propagate service errors', async () => {
      mockBatchOperations.deleteCompletedOlderThan.mockRejectedValue(new Error('delete failed'));
      await expect(controller.deleteCompleted({})).rejects.toThrow('delete failed');
    });
  });

  describe('deleteFailed', () => {
    it('should call batchOperations.deleteAllFailed without nodeId', async () => {
      mockBatchOperations.deleteAllFailed.mockResolvedValue(batchResult);

      const result = await controller.deleteFailed(undefined);

      expect(mockBatchOperations.deleteAllFailed).toHaveBeenCalledWith(undefined);
      expect(result).toEqual(batchResult);
    });

    it('should pass nodeId to batchOperations.deleteAllFailed', async () => {
      mockBatchOperations.deleteAllFailed.mockResolvedValue(batchResult);

      await controller.deleteFailed('node-1');

      expect(mockBatchOperations.deleteAllFailed).toHaveBeenCalledWith('node-1');
    });

    it('should propagate service errors', async () => {
      mockBatchOperations.deleteAllFailed.mockRejectedValue(new Error('delete failed'));
      await expect(controller.deleteFailed(undefined)).rejects.toThrow('delete failed');
    });
  });

  describe('getStats', () => {
    it('should call batchOperations.getStats without nodeId and return stats', async () => {
      const stats = { QUEUED: 10, ENCODING: 2, FAILED: 1 };
      mockBatchOperations.getStats.mockResolvedValue(stats);

      const result = await controller.getStats(undefined);

      expect(mockBatchOperations.getStats).toHaveBeenCalledWith(undefined);
      expect(result).toEqual(stats);
    });

    it('should pass nodeId to batchOperations.getStats', async () => {
      mockBatchOperations.getStats.mockResolvedValue({});

      await controller.getStats('node-1');

      expect(mockBatchOperations.getStats).toHaveBeenCalledWith('node-1');
    });

    it('should propagate service errors', async () => {
      mockBatchOperations.getStats.mockRejectedValue(new Error('stats error'));
      await expect(controller.getStats(undefined)).rejects.toThrow('stats error');
    });
  });

  describe('clearAll', () => {
    it('should call batchOperations.clearAll with confirmation token from dto', async () => {
      const dto = { confirmationToken: 'CLEAR_ALL_JOBS' };
      mockBatchOperations.clearAll.mockResolvedValue(batchResult);

      const result = await controller.clearAll(dto);

      expect(mockBatchOperations.clearAll).toHaveBeenCalledWith('CLEAR_ALL_JOBS');
      expect(result).toEqual(batchResult);
    });

    it('should propagate service errors (e.g. invalid token)', async () => {
      mockBatchOperations.clearAll.mockRejectedValue(new Error('invalid confirmation token'));

      await expect(controller.clearAll({ confirmationToken: 'WRONG' })).rejects.toThrow(
        'invalid confirmation token'
      );
    });
  });
});
