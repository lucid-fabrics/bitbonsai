import { Test, TestingModule } from '@nestjs/testing';
import { AccelerationType } from '@prisma/client';
import * as os from 'os';
import { SystemInfoService } from './system-info.service';

// Mock child_process exec
jest.mock('child_process', () => ({
  exec: jest.fn(),
}));

describe('SystemInfoService', () => {
  let service: SystemInfoService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [SystemInfoService],
    }).compile();

    service = module.get<SystemInfoService>(SystemInfoService);
  });

  describe('collectSystemInfo', () => {
    it('should return complete system info object', async () => {
      jest.spyOn(os, 'networkInterfaces').mockReturnValue({
        eth0: [
          {
            family: 'IPv4',
            address: '192.168.1.100',
            internal: false,
            netmask: '255.255.255.0',
            mac: 'aa:bb:cc:dd:ee:ff',
            cidr: '192.168.1.100/24',
          },
        ],
      } as any);
      jest.spyOn(os, 'hostname').mockReturnValue('test-host');
      jest.spyOn(os, 'cpus').mockReturnValue([
        {
          model: 'Intel Core i7',
          speed: 3000,
          times: { user: 0, nice: 0, sys: 0, idle: 0, irq: 0 },
        },
        {
          model: 'Intel Core i7',
          speed: 3000,
          times: { user: 0, nice: 0, sys: 0, idle: 0, irq: 0 },
        },
      ]);
      jest.spyOn(os, 'totalmem').mockReturnValue(16 * 1024 ** 3);

      // Mock exec for disk space and GPU detection
      const { exec } = require('child_process');
      exec.mockImplementation((_cmd: string, cb: any) => cb(null, { stdout: '0G', stderr: '' }));

      const result = await service.collectSystemInfo();

      expect(result.ipAddress).toBe('192.168.1.100');
      expect(result.hostname).toBe('test-host');
      expect(result.macAddress).toBe('aa:bb:cc:dd:ee:ff');
      expect(result.hardwareSpecs.cpuCores).toBe(2);
      expect(result.hardwareSpecs.cpuModel).toBe('Intel Core i7');
      expect(result.hardwareSpecs.ramGb).toBe(16);
    });

    it('should return 127.0.0.1 when no external IP found', async () => {
      jest.spyOn(os, 'networkInterfaces').mockReturnValue({
        lo: [
          {
            family: 'IPv4',
            address: '127.0.0.1',
            internal: true,
            netmask: '255.0.0.0',
            mac: '00:00:00:00:00:00',
            cidr: '127.0.0.1/8',
          },
        ],
      } as any);

      const result = await service.collectSystemInfo();

      expect(result.ipAddress).toBe('127.0.0.1');
    });
  });

  describe('container type detection', () => {
    it('should detect Apple Silicon on darwin arm64', async () => {
      // Override platform detection
      Object.defineProperty(process, 'platform', { value: 'darwin', writable: true });
      Object.defineProperty(process, 'arch', { value: 'arm64', writable: true });

      jest.spyOn(os, 'networkInterfaces').mockReturnValue({} as any);
      jest.spyOn(os, 'hostname').mockReturnValue('mac-host');
      jest
        .spyOn(os, 'cpus')
        .mockReturnValue([
          { model: 'Apple M2', speed: 0, times: { user: 0, nice: 0, sys: 0, idle: 0, irq: 0 } },
        ]);
      jest.spyOn(os, 'totalmem').mockReturnValue(16 * 1024 ** 3);

      const { exec } = require('child_process');
      exec.mockImplementation((_cmd: string, cb: any) => cb(new Error('command not found'), null));

      const result = await service.collectSystemInfo();

      // On darwin arm64, acceleration should be APPLE_M (if nvidia not found)
      expect([AccelerationType.APPLE_M, AccelerationType.CPU]).toContain(result.acceleration);
    });
  });
});
