import { Test, type TestingModule } from '@nestjs/testing';
import {
  ContainerType,
  EnvironmentDetectorService,
  StorageRecommendation,
} from '../../environment-detector.service';

// Mock child_process and fs
jest.mock('child_process', () => ({
  exec: jest.fn(),
}));

jest.mock('fs/promises', () => ({
  access: jest.fn(),
  readFile: jest.fn(),
}));

import { exec } from 'child_process';
import * as fs from 'fs/promises';

const mockExec = exec as unknown as jest.Mock;
const mockAccess = fs.access as jest.Mock;
const mockReadFile = fs.readFile as jest.Mock;

describe('EnvironmentDetectorService', () => {
  let service: EnvironmentDetectorService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [EnvironmentDetectorService],
    }).compile();

    service = module.get<EnvironmentDetectorService>(EnvironmentDetectorService);

    jest.spyOn((service as any).logger, 'log').mockImplementation();
    jest.spyOn((service as any).logger, 'warn').mockImplementation();
    jest.spyOn((service as any).logger, 'debug').mockImplementation();
    jest.spyOn((service as any).logger, 'error').mockImplementation();

    // Default mocks
    mockAccess.mockRejectedValue(new Error('ENOENT'));
    mockReadFile.mockRejectedValue(new Error('ENOENT'));
    mockExec.mockImplementation(
      (
        _cmd: string,
        callback: (error: Error | null, result: { stdout: string; stderr: string }) => void
      ) => {
        callback(new Error('command not found'), { stdout: '', stderr: '' });
      }
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
    service.clearCache();
  });

  describe('detectEnvironment', () => {
    it('should detect bare metal environment', async () => {
      // No Docker, no LXC indicators
      mockAccess.mockRejectedValue(new Error('ENOENT'));
      mockReadFile.mockResolvedValue('');
      mockExec.mockImplementation(
        (
          cmd: string,
          callback: (error: Error | null, result: { stdout: string; stderr: string }) => void
        ) => {
          if (cmd.includes('systemd-detect-virt')) {
            callback(null, { stdout: 'none\n', stderr: '' });
          } else if (cmd.includes('hostname')) {
            callback(null, { stdout: 'my-server\n', stderr: '' });
          } else if (cmd.includes('ip -4 addr')) {
            callback(null, {
              stdout: 'inet 192.168.1.100/24 brd 192.168.1.255 scope global eth0\n',
              stderr: '',
            });
          } else if (cmd.includes('/proc/self/status')) {
            callback(null, { stdout: '', stderr: '' });
          } else {
            callback(new Error('not found'), { stdout: '', stderr: '' });
          }
        }
      );

      const info = await service.detectEnvironment();

      expect(info.containerType).toBe(ContainerType.BARE_METAL);
      expect(info.hostname).toBe('my-server');
    });

    it('should detect Docker environment via .dockerenv', async () => {
      mockAccess.mockImplementation((path: string) => {
        if (path === '/.dockerenv') return Promise.resolve();
        return Promise.reject(new Error('ENOENT'));
      });
      mockReadFile.mockImplementation((path: string) => {
        if (path === '/proc/self/status') return Promise.resolve('CapEff:\t0000000000000000\n');
        return Promise.resolve('');
      });
      mockExec.mockImplementation(
        (
          cmd: string,
          callback: (error: Error | null, result: { stdout: string; stderr: string }) => void
        ) => {
          if (cmd.includes('hostname')) {
            callback(null, { stdout: 'abc123\n', stderr: '' });
          } else if (cmd.includes('ip -4 addr')) {
            callback(null, { stdout: '', stderr: '' });
          } else {
            callback(new Error('not found'), { stdout: '', stderr: '' });
          }
        }
      );

      const info = await service.detectEnvironment();

      expect(info.containerType).toBe(ContainerType.DOCKER);
      expect(info.canMountNFS).toBe(false); // non-privileged docker
    });

    it('should cache results', async () => {
      mockReadFile.mockResolvedValue('');
      mockExec.mockImplementation(
        (
          cmd: string,
          callback: (error: Error | null, result: { stdout: string; stderr: string }) => void
        ) => {
          if (cmd.includes('systemd-detect-virt')) {
            callback(null, { stdout: 'none\n', stderr: '' });
          } else if (cmd.includes('hostname')) {
            callback(null, { stdout: 'test\n', stderr: '' });
          } else {
            callback(new Error('not found'), { stdout: '', stderr: '' });
          }
        }
      );

      const first = await service.detectEnvironment();
      const second = await service.detectEnvironment();

      expect(first).toBe(second); // Same reference (cached)
    });
  });

  describe('clearCache', () => {
    it('should clear cached environment info', async () => {
      mockReadFile.mockResolvedValue('');
      mockExec.mockImplementation(
        (
          cmd: string,
          callback: (error: Error | null, result: { stdout: string; stderr: string }) => void
        ) => {
          if (cmd.includes('systemd-detect-virt')) {
            callback(null, { stdout: 'none\n', stderr: '' });
          } else if (cmd.includes('hostname')) {
            callback(null, { stdout: 'test\n', stderr: '' });
          } else {
            callback(new Error('not found'), { stdout: '', stderr: '' });
          }
        }
      );

      const first = await service.detectEnvironment();
      service.clearCache();
      const second = await service.detectEnvironment();

      expect(first).not.toBe(second); // Different reference after cache clear
    });
  });

  describe('recommendStorageMethod', () => {
    it('should recommend NFS when both nodes on same network can mount', async () => {
      const result = await service.recommendStorageMethod(
        { subnet: '192.168.1.0/24', containerType: ContainerType.BARE_METAL, canMountNFS: true },
        { subnet: '192.168.1.0/24', containerType: ContainerType.BARE_METAL, canMountNFS: true }
      );

      expect(result.recommended).toBe(StorageRecommendation.NFS);
    });

    it('should recommend RSYNC when target is non-privileged LXC', async () => {
      const result = await service.recommendStorageMethod(
        { subnet: '192.168.1.0/24', containerType: ContainerType.BARE_METAL, canMountNFS: true },
        { subnet: '192.168.1.0/24', containerType: ContainerType.LXC, canMountNFS: false }
      );

      expect(result.recommended).toBe(StorageRecommendation.RSYNC);
      expect(result.warning).toContain('LXC');
      expect(result.actionRequired).toBeDefined();
    });

    it('should recommend RSYNC when target cannot mount NFS', async () => {
      const result = await service.recommendStorageMethod(
        { subnet: '192.168.1.0/24', containerType: ContainerType.BARE_METAL, canMountNFS: true },
        { subnet: '192.168.1.0/24', containerType: ContainerType.DOCKER, canMountNFS: false }
      );

      expect(result.recommended).toBe(StorageRecommendation.RSYNC);
    });

    it('should recommend EITHER when nodes on different networks both support NFS', async () => {
      const result = await service.recommendStorageMethod(
        { subnet: '192.168.1.0/24', containerType: ContainerType.BARE_METAL, canMountNFS: true },
        { subnet: '10.0.0.0/24', containerType: ContainerType.BARE_METAL, canMountNFS: true }
      );

      expect(result.recommended).toBe(StorageRecommendation.EITHER);
      expect(result.warning).toContain('latency');
    });

    it('should recommend RSYNC as fallback', async () => {
      const result = await service.recommendStorageMethod(
        { subnet: null, containerType: ContainerType.UNKNOWN, canMountNFS: false },
        { subnet: null, containerType: ContainerType.UNKNOWN, canMountNFS: true }
      );

      expect(result.recommended).toBe(StorageRecommendation.RSYNC);
    });
  });
});
