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

  describe('detectNvidiaGPU', () => {
    it('should return NVIDIA GPU info when nvidia-smi succeeds', async () => {
      jest
        .spyOn(service as any, 'executeCommand')
        .mockResolvedValue('NVIDIA GeForce RTX 3080, 10240 MiB, 535.54.03');

      const result = await (service as any).detectNvidiaGPU();

      expect(result).not.toBeNull();
      expect(result.vendor).toBe(GPUVendor.NVIDIA);
      expect(result.model).toBe('NVIDIA GeForce RTX 3080');
      expect(result.memory).toBe(10240);
      expect(result.driverVersion).toBe('535.54.03');
    });

    it('should return null when nvidia-smi returns null', async () => {
      jest.spyOn(service as any, 'executeCommand').mockResolvedValue(null);

      const result = await (service as any).detectNvidiaGPU();

      expect(result).toBeNull();
    });

    it('should return null when executeCommand throws', async () => {
      jest.spyOn(service as any, 'executeCommand').mockRejectedValue(new Error('not found'));

      const result = await (service as any).detectNvidiaGPU();

      expect(result).toBeNull();
    });
  });

  describe('detectIntelGPU', () => {
    it('should return null on non-linux platforms', async () => {
      Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });

      const result = await (service as any).detectIntelGPU();

      expect(result).toBeNull();
    });

    it('should return Intel GPU when vainfo reports intel on linux', async () => {
      Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
      jest
        .spyOn(service as any, 'executeCommand')
        .mockResolvedValueOnce('renderD128 renderD129') // ls /dev/dri/
        .mockResolvedValueOnce(
          'vainfo: VA-API version: 1.16\nDriver version: intel-media-driver 23.1\nVA-API driver: iHD\nIntel VA-API driver'
        ); // vainfo

      const result = await (service as any).detectIntelGPU();

      expect(result).not.toBeNull();
      expect(result.vendor).toBe(GPUVendor.INTEL);
      expect(result.model).toBe('Intel Quick Sync');
    });

    it('should return Intel GPU with unknown driver when vainfo not available (throws)', async () => {
      Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
      jest
        .spyOn(service as any, 'executeCommand')
        .mockResolvedValueOnce('renderD128') // ls /dev/dri/
        .mockRejectedValueOnce(new Error('vainfo not found')); // vainfo throws

      const result = await (service as any).detectIntelGPU();

      expect(result).not.toBeNull();
      expect(result.vendor).toBe(GPUVendor.INTEL);
      expect(result.driverVersion).toBe('unknown');
    });

    it('should return null when /dev/dri/ has no renderD', async () => {
      Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
      jest.spyOn(service as any, 'executeCommand').mockResolvedValueOnce('card0 card1');

      const result = await (service as any).detectIntelGPU();

      expect(result).toBeNull();
    });

    it('should return null when ls /dev/dri/ returns null', async () => {
      Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
      jest.spyOn(service as any, 'executeCommand').mockResolvedValueOnce(null);

      const result = await (service as any).detectIntelGPU();

      expect(result).toBeNull();
    });

    it('should return null when vainfo output does not include intel', async () => {
      Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
      jest
        .spyOn(service as any, 'executeCommand')
        .mockResolvedValueOnce('renderD128') // ls
        .mockResolvedValueOnce('AMD Radeon driver'); // vainfo - no "intel"

      const result = await (service as any).detectIntelGPU();

      expect(result).toBeNull();
    });
  });

  describe('detectAMDGPU', () => {
    it('should return null on non-linux platforms', async () => {
      Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });

      const result = await (service as any).detectAMDGPU();

      expect(result).toBeNull();
    });

    it('should return AMD GPU when lspci reports AMD VGA on linux', async () => {
      Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
      jest
        .spyOn(service as any, 'executeCommand')
        .mockResolvedValue(
          '0000:01:00.0 VGA compatible controller: AMD/ATI Navi 21 [Radeon RX 6800 XT] (rev c1)'
        );

      const result = await (service as any).detectAMDGPU();

      expect(result).not.toBeNull();
      expect(result.vendor).toBe(GPUVendor.AMD);
      expect(result.driverVersion).toBe('unknown');
    });

    it('should return null when lspci has no AMD VGA lines', async () => {
      Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
      jest
        .spyOn(service as any, 'executeCommand')
        .mockResolvedValue('0000:00:00.0 Host bridge: Intel Corporation');

      const result = await (service as any).detectAMDGPU();

      expect(result).toBeNull();
    });

    it('should return null when lspci returns null', async () => {
      Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
      jest.spyOn(service as any, 'executeCommand').mockResolvedValue(null);

      const result = await (service as any).detectAMDGPU();

      expect(result).toBeNull();
    });

    it('should return null when executeCommand throws', async () => {
      Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
      jest.spyOn(service as any, 'executeCommand').mockRejectedValue(new Error('lspci fail'));

      const result = await (service as any).detectAMDGPU();

      expect(result).toBeNull();
    });
  });

  describe('detectAppleGPU', () => {
    it('should return Apple GPU on darwin with Apple silicon CPU', async () => {
      Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
      (os.cpus as jest.Mock).mockReturnValue([
        {
          model: 'Apple M3 Max',
          speed: 4000,
          times: { user: 0, nice: 0, sys: 0, idle: 0, irq: 0 },
        },
      ]);
      (os.release as jest.Mock).mockReturnValue('23.0.0');

      const result = await (service as any).detectAppleGPU();

      expect(result).not.toBeNull();
      expect(result.vendor).toBe(GPUVendor.APPLE);
      expect(result.model).toContain('Apple M3 Max');
      expect(result.model).toContain('VideoToolbox');
      expect(result.driverVersion).toBe('23.0.0');
    });

    it('should return null on darwin with non-Apple CPU', async () => {
      Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
      (os.cpus as jest.Mock).mockReturnValue([
        {
          model: 'Intel Core i9-12900K',
          speed: 3200,
          times: { user: 0, nice: 0, sys: 0, idle: 0, irq: 0 },
        },
      ]);

      const result = await (service as any).detectAppleGPU();

      expect(result).toBeNull();
    });

    it('should return null on non-darwin platforms', async () => {
      Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });

      const result = await (service as any).detectAppleGPU();

      expect(result).toBeNull();
    });

    it('should return null when cpus() returns empty array', async () => {
      Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
      (os.cpus as jest.Mock).mockReturnValue([]);

      const result = await (service as any).detectAppleGPU();

      expect(result).toBeNull();
    });
  });

  describe('detectHardware with NVIDIA GPU', () => {
    it('should detect NVIDIA GPU and set accelerationType to NVIDIA', async () => {
      (os.cpus as jest.Mock).mockReturnValue([
        { model: 'Intel i9', speed: 3200, times: { user: 0, nice: 0, sys: 0, idle: 0, irq: 0 } },
      ]);
      (os.totalmem as jest.Mock).mockReturnValue(32 * 1024 * 1024 * 1024);
      (os.freemem as jest.Mock).mockReturnValue(16 * 1024 * 1024 * 1024);

      jest
        .spyOn(service as any, 'executeCommand')
        .mockResolvedValue('NVIDIA RTX 4090, 24576 MiB, 535.1');

      const result = await service.detectHardware();

      expect(result.accelerationType).toBe(AccelerationType.NVIDIA);
      expect(result.gpus).toHaveLength(1);
      expect(result.gpus[0].vendor).toBe(GPUVendor.NVIDIA);
    });
  });

  describe('detectGPUs error handling', () => {
    it('should return empty array and log error when detectNvidiaGPU fails catastrophically', async () => {
      (os.cpus as jest.Mock).mockReturnValue([
        { model: 'Intel i9', speed: 3200, times: { user: 0, nice: 0, sys: 0, idle: 0, irq: 0 } },
      ]);
      (os.totalmem as jest.Mock).mockReturnValue(32 * 1024 * 1024 * 1024);
      (os.freemem as jest.Mock).mockReturnValue(16 * 1024 * 1024 * 1024);

      jest.spyOn(service as any, 'detectNvidiaGPU').mockRejectedValue(new Error('critical fail'));
      // Let others resolve normally
      jest.spyOn(service as any, 'detectIntelGPU').mockResolvedValue(null);
      jest.spyOn(service as any, 'detectAMDGPU').mockResolvedValue(null);
      jest.spyOn(service as any, 'detectAppleGPU').mockResolvedValue(null);

      const result = await service.detectHardware();

      expect(result.gpus).toEqual([]);
      expect(result.accelerationType).toBe(AccelerationType.CPU);
    });
  });

  describe('cache TTL expiry', () => {
    it('should re-detect after cache TTL expires', async () => {
      (os.cpus as jest.Mock).mockReturnValue([
        { model: 'Intel i9', speed: 3200, times: { user: 0, nice: 0, sys: 0, idle: 0, irq: 0 } },
      ]);
      (os.totalmem as jest.Mock).mockReturnValue(32 * 1024 * 1024 * 1024);
      (os.freemem as jest.Mock).mockReturnValue(16 * 1024 * 1024 * 1024);
      jest.spyOn(service as any, 'executeCommand').mockResolvedValue(null);

      await service.detectHardware();

      // Simulate expired cache
      (service as any).cacheTimestamp = Date.now() - 10 * 60 * 1000; // 10 min ago

      const executeCommandSpy = jest
        .spyOn(service as any, 'executeCommand')
        .mockResolvedValue(null);
      await service.detectHardware();

      expect(executeCommandSpy).toHaveBeenCalled();
    });
  });
});
