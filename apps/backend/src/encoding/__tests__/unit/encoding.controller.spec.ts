import { Test, type TestingModule } from '@nestjs/testing';
import { EncodingController } from '../../encoding.controller';
import { EncodingProcessorService } from '../../encoding-processor.service';

describe('EncodingController', () => {
  let controller: EncodingController;

  const mockEncodingService = {
    startWorkerPool: jest.fn(),
    stopWorker: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [EncodingController],
      providers: [{ provide: EncodingProcessorService, useValue: mockEncodingService }],
    }).compile();

    controller = module.get<EncodingController>(EncodingController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('startWorker', () => {
    it('should start worker pool and return result', async () => {
      mockEncodingService.startWorkerPool.mockResolvedValue(4);

      const result = await controller.startWorker('node-1');

      expect(result).toEqual({
        message: 'Started 4 worker(s) for node node-1',
        workersStarted: 4,
      });
      expect(mockEncodingService.startWorkerPool).toHaveBeenCalledWith('node-1');
    });

    it('should handle single worker start', async () => {
      mockEncodingService.startWorkerPool.mockResolvedValue(1);

      const result = await controller.startWorker('node-2');

      expect(result.workersStarted).toBe(1);
      expect(result.message).toContain('1 worker(s)');
    });

    it('should propagate errors from service', async () => {
      mockEncodingService.startWorkerPool.mockRejectedValue(new Error('Node not found'));

      await expect(controller.startWorker('nonexistent')).rejects.toThrow('Node not found');
    });
  });

  describe('stopWorker', () => {
    it('should stop worker and return message', async () => {
      mockEncodingService.stopWorker.mockResolvedValue(undefined);

      const result = await controller.stopWorker('node-1');

      expect(result).toEqual({
        message: 'Worker stopped for node node-1',
      });
      expect(mockEncodingService.stopWorker).toHaveBeenCalledWith('node-1');
    });

    it('should propagate errors from service', async () => {
      mockEncodingService.stopWorker.mockRejectedValue(new Error('Worker not running'));

      await expect(controller.stopWorker('node-1')).rejects.toThrow('Worker not running');
    });
  });
});
