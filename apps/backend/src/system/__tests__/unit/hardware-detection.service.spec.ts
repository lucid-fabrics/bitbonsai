import { Test, type TestingModule } from '@nestjs/testing';
import * as os from 'os';
import { AccelerationType, GPUVendor } from '../../dto/hardware-capabilities.dto';
import { HardwareDetectionService } from '../../hardware-detection.service';

jest.mock('os');

describe('HardwareDetectionService', () => {
  let service: HardwareDetectionService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [HardwareDetectionService],
    }).compile();

    service = module.get<HardwareDetectionService>(HardwareDetectionService);

    jest.spyOn((service as any).logger, 'log').mockImplementation();
    jest.spyOn((service as any).logger, 'warn').mockImplementation();
    jest.spyOn((service as any).logger, 'debug').mockImplementation();
    jest.spyOn((service as any).logger, 'error').mockImplementation();

    // Reset cache between tests
    service.clearCache();
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  describe('detectHardware', () => {
    beforeEach(() => {
      // Mock os module
      (os.cpus as jest.Mock).mockReturnValue([
        {
          model: 'Intel Core i9-12900K',
          speed: 3200,
          times: { user: 100, nice: 0, sys: 50, idle: 850, irq: 0 },
        },
      ]);
      (os.totalmem as jest.Mock).mockReturnValue(32 * 1024 * 1024 * 1024);
      (os.freemem as jest.Mock).mockReturnValue(16 * 1024 * 1024 * 1024);

      // Mock executeCommand to fail for all GPU detection (CPU-only fallback)
      jest.spyOn(service as any, 'executeCommand').mockResolvedValue(null);
    });

    it('should detect CPU information', async () => {
      const result = await service.detectHardware();

      expect(result.cpu.model).toBe('Intel Core i9-12900K');
      expect(result.cpu.cores).toBe(1); // Only 1 mock CPU
      expect(result.cpu.speed).toBe(3200);
    });

    it('should detect memory information', async () => {
      const result = await service.detectHardware();

      expect(result.memory.total).toBe(Math.floor((32 * 1024 * 1024 * 1024) / (1024 * 1024)));
      expect(result.memory.free).toBe(Math.floor((16 * 1024 * 1024 * 1024) / (1024 * 1024)));
      expect(result.memory.used).toBe(Math.floor((16 * 1024 * 1024 * 1024) / (1024 * 1024)));
    });

    it('should fall back to CPU when no GPUs detected', async () => {
      const result = await service.detectHardware();

      expect(result.accelerationType).toBe(AccelerationType.CPU);
      expect(result.gpus).toEqual([]);
    });

    it('should include platform information', async () => {
      const result = await service.detectHardware();

      expect(result.platform).toBe(process.platform);
    });

    it('should cache results', async () => {
      const result1 = await service.detectHardware();
      const result2 = await service.detectHardware();

      expect(result1).toBe(result2); // Same reference = cached
    });

    it('should re-detect after cache clear', async () => {
      await service.detectHardware();
      service.clearCache();

      const result2 = await service.detectHardware();

      expect(result2).not.toBeNull();
      expect(result2.cpu).not.toBeNull();
    });

    it('should throw on detection failure', async () => {
      jest.spyOn(service as any, 'detectGPUs').mockRejectedValue(new Error('Detection failed'));

      await expect(service.detectHardware()).rejects.toThrow();
    });
  });

  describe('clearCache', () => {
    it('should clear cached result', () => {
      (service as any).cachedResult = { test: true };
      (service as any).cacheTimestamp = Date.now();

      service.clearCache();

      expect((service as any).cachedResult).toBeNull();
      expect((service as any).cacheTimestamp).toBe(0);
    });
  });

  describe('determineAccelerationType', () => {
    it('should return CPU when no GPUs', () => {
      const result = (service as any).determineAccelerationType([]);

      expect(result).toBe(AccelerationType.CPU);
    });

    it('should prioritize NVIDIA', () => {
      const gpus = [
        { vendor: GPUVendor.INTEL, model: 'QSV', memory: 0, driverVersion: '1.0' },
        { vendor: GPUVendor.NVIDIA, model: 'RTX 3080', memory: 10240, driverVersion: '535' },
      ];

      const result = (service as any).determineAccelerationType(gpus);

      expect(result).toBe(AccelerationType.NVIDIA);
    });

    it('should return Intel when only Intel GPU', () => {
      const gpus = [{ vendor: GPUVendor.INTEL, model: 'QSV', memory: 0, driverVersion: '1.0' }];

      const result = (service as any).determineAccelerationType(gpus);

      expect(result).toBe(AccelerationType.INTEL);
    });

    it('should return AMD when only AMD GPU', () => {
      const gpus = [{ vendor: GPUVendor.AMD, model: 'RX 7900', memory: 0, driverVersion: '1.0' }];

      const result = (service as any).determineAccelerationType(gpus);

      expect(result).toBe(AccelerationType.AMD);
    });

    it('should return Apple for Apple Silicon', () => {
      const gpus = [{ vendor: GPUVendor.APPLE, model: 'M3 Max', memory: 0, driverVersion: '1.0' }];

      const result = (service as any).determineAccelerationType(gpus);

      expect(result).toBe(AccelerationType.APPLE);
    });
  });

  describe('detectCPU', () => {
    it('should return CPU info from os module', async () => {
      (os.cpus as jest.Mock).mockReturnValue([
        {
          model: 'AMD Ryzen 9 5950X',
          speed: 3400,
          times: { user: 100, nice: 0, sys: 50, idle: 850, irq: 0 },
        },
        {
          model: 'AMD Ryzen 9 5950X',
          speed: 3400,
          times: { user: 100, nice: 0, sys: 50, idle: 850, irq: 0 },
        },
      ]);

      const result = await (service as any).detectCPU();

      expect(result.model).toBe('AMD Ryzen 9 5950X');
      expect(result.cores).toBe(2);
      expect(result.speed).toBe(3400);
    });

    it('should handle empty CPU list', async () => {
      (os.cpus as jest.Mock).mockReturnValue([]);

      const result = await (service as any).detectCPU();

      expect(result.model).toBe('Unknown');
      expect(result.cores).toBe(0);
      expect(result.speed).toBe(0);
    });
  });

  describe('detectMemory', () => {
    it('should return memory info in MB', async () => {
      (os.totalmem as jest.Mock).mockReturnValue(64 * 1024 * 1024 * 1024); // 64 GB
      (os.freemem as jest.Mock).mockReturnValue(32 * 1024 * 1024 * 1024); // 32 GB

      const result = await (service as any).detectMemory();

      expect(result.total).toBe(64 * 1024); // MB
      expect(result.free).toBe(32 * 1024); // MB
      expect(result.used).toBe(32 * 1024); // MB
    });
  });
});
