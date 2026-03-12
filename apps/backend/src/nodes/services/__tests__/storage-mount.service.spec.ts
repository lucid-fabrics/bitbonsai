import { InternalServerErrorException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { StorageProtocol, StorageShareStatus } from '@prisma/client';
import { exec } from 'child_process';
import * as fs from 'fs/promises';
import { MountStrategyFactory } from '../strategies/mount-strategy.factory';

jest.mock('child_process', () => ({
  exec: jest.fn(),
  execFile: jest.fn(),
}));

jest.mock('fs/promises', () => ({
  access: jest.fn(),
  mkdir: jest.fn(),
  readFile: jest.fn(),
  writeFile: jest.fn(),
  appendFile: jest.fn(),
}));

jest.mock('../../utils/input-sanitizer', () => ({
  escapeShellArg: jest.fn((arg: string) => `'${arg}'`),
  sanitizePath: jest.fn((path: string) => path),
  sanitizeServerAddress: jest.fn((addr: string) => addr),
}));

import { StorageMountService } from '../storage-mount.service';

// Get the mocked exec function
const mockExec = exec as unknown as jest.Mock;
const mockFs = fs as jest.Mocked<typeof fs>;

describe('StorageMountService', () => {
  let service: StorageMountService;

  const mockStrategy = {
    buildMountCommand: jest.fn(),
    buildFstabEntry: jest.fn(),
    testConnectivity: jest.fn(),
  };

  const mockStrategyFactory = {
    getStrategy: jest.fn().mockReturnValue(mockStrategy),
  };

  const mockRepository = {
    findById: jest.fn(),
    updateStatus: jest.fn(),
  };

  const baseShare = {
    id: 'share-1',
    name: 'Media Share',
    protocol: StorageProtocol.NFS,
    serverAddress: '192.168.1.100',
    sharePath: '/mnt/media',
    mountPoint: '/media',
    isMounted: false,
    addToFstab: false,
    readOnly: true,
    nodeId: 'node-1',
  };

  // Helper: make exec callback with (null, {stdout, stderr})
  function execResolves(stdout: string, stderr = '') {
    mockExec.mockImplementationOnce(
      (
        _cmd: string,
        cb: (err: Error | null, result: { stdout: string; stderr: string }) => void
      ) => {
        cb(null, { stdout, stderr });
      }
    );
  }

  function execRejects(error: Error) {
    mockExec.mockImplementationOnce((_cmd: string, cb: (err: Error | null) => void) => {
      cb(error);
    });
  }

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StorageMountService,
        { provide: MountStrategyFactory, useValue: mockStrategyFactory },
        { provide: 'IStorageShareRepository', useValue: mockRepository },
      ],
    }).compile();

    service = module.get<StorageMountService>(StorageMountService);
    jest.clearAllMocks();
    mockStrategyFactory.getStrategy.mockReturnValue(mockStrategy);
  });

  describe('mount', () => {
    it('should return success if share is already mounted', async () => {
      mockRepository.findById.mockResolvedValue({
        ...baseShare,
        isMounted: true,
      });

      const result = await service.mount('share-1');

      expect(result.success).toBe(true);
      expect(result.message).toBe('Share is already mounted');
    });

    it('should mount share successfully', async () => {
      mockRepository.findById.mockResolvedValue(baseShare);
      mockStrategy.buildMountCommand.mockResolvedValue(
        'mount -t nfs 192.168.1.100:/mnt/media /media'
      );
      mockFs.access.mockResolvedValue(undefined);
      execResolves('', '');
      execResolves('/media type nfs');
      mockRepository.updateStatus.mockResolvedValue({});

      const result = await service.mount('share-1');

      expect(result.success).toBe(true);
      expect(result.message).toContain('Successfully mounted');
      expect(mockRepository.updateStatus).toHaveBeenCalledWith(
        'share-1',
        StorageShareStatus.MOUNTED
      );
    });

    it('should handle mount failure and set ERROR status', async () => {
      mockRepository.findById.mockResolvedValue(baseShare);
      mockStrategy.buildMountCommand.mockResolvedValue('mount ...');
      mockFs.access.mockResolvedValue(undefined);
      execRejects(new Error('Permission denied'));
      mockRepository.updateStatus.mockResolvedValue({});

      const result = await service.mount('share-1');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Permission denied');
      expect(mockRepository.updateStatus).toHaveBeenCalledWith(
        'share-1',
        StorageShareStatus.ERROR,
        expect.stringContaining('Permission denied')
      );
    });

    it('should create mount point directory if it does not exist', async () => {
      mockRepository.findById.mockResolvedValue(baseShare);
      mockStrategy.buildMountCommand.mockResolvedValue('mount ...');
      mockFs.access.mockRejectedValue(new Error('ENOENT'));
      mockFs.mkdir.mockResolvedValue(undefined);
      execResolves('', '');
      execResolves('/media type nfs');
      mockRepository.updateStatus.mockResolvedValue({});

      await service.mount('share-1');

      expect(mockFs.mkdir).toHaveBeenCalledWith('/media', { recursive: true, mode: 0o755 });
    });

    it('should handle mount verification failure', async () => {
      mockRepository.findById.mockResolvedValue(baseShare);
      mockStrategy.buildMountCommand.mockResolvedValue('mount ...');
      mockFs.access.mockResolvedValue(undefined);
      execResolves('', '');
      execRejects(new Error('not mounted'));
      mockRepository.updateStatus.mockResolvedValue({});

      const result = await service.mount('share-1');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Mount verification failed');
    });
  });

  describe('unmount', () => {
    it('should return success if share is already unmounted', async () => {
      mockRepository.findById.mockResolvedValue({
        ...baseShare,
        isMounted: false,
      });

      const result = await service.unmount('share-1');

      expect(result.success).toBe(true);
      expect(result.message).toBe('Share is already unmounted');
    });

    it('should unmount share successfully', async () => {
      mockRepository.findById.mockResolvedValue({
        ...baseShare,
        isMounted: true,
      });
      execResolves('', '');
      execRejects(new Error('not found'));
      mockRepository.updateStatus.mockResolvedValue({});

      const result = await service.unmount('share-1');

      expect(result.success).toBe(true);
      expect(mockRepository.updateStatus).toHaveBeenCalledWith(
        'share-1',
        StorageShareStatus.UNMOUNTED
      );
    });

    it('should use force flag when requested', async () => {
      mockRepository.findById.mockResolvedValue({
        ...baseShare,
        isMounted: true,
      });
      execResolves('', '');
      execRejects(new Error('not found'));
      mockRepository.updateStatus.mockResolvedValue({});

      await service.unmount('share-1', true);

      const firstCallCmd = mockExec.mock.calls[0][0];
      expect(firstCallCmd).toContain('umount -f');
    });

    it('should handle unmount failure', async () => {
      mockRepository.findById.mockResolvedValue({
        ...baseShare,
        isMounted: true,
      });
      execRejects(new Error('Device busy'));

      const result = await service.unmount('share-1');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Device busy');
    });
  });

  describe('testConnectivity', () => {
    it('should return reachable when ping succeeds', async () => {
      execResolves('1 received');
      mockStrategy.testConnectivity.mockResolvedValue(true);

      const result = await service.testConnectivity('192.168.1.100');

      expect(result.isReachable).toBe(true);
      expect(result.latencyMs).toBeDefined();
    });

    it('should return unreachable when ping shows 0 received', async () => {
      execResolves('0 received');

      const result = await service.testConnectivity('192.168.1.999');

      expect(result.isReachable).toBe(false);
      expect(result.error).toBe('Host unreachable');
    });

    it('should handle connectivity test exception', async () => {
      execRejects(new Error('timeout'));

      const result = await service.testConnectivity('192.168.1.100');

      expect(result.isReachable).toBe(false);
      expect(result.error).toContain('timeout');
    });

    it('should test specific protocol when specified', async () => {
      execResolves('1 received');
      mockStrategy.testConnectivity.mockResolvedValue(true);

      await service.testConnectivity('192.168.1.100', StorageProtocol.NFS);

      expect(mockStrategyFactory.getStrategy).toHaveBeenCalledWith(StorageProtocol.NFS);
    });
  });

  describe('getDiskUsage', () => {
    it('should parse df output correctly', async () => {
      execResolves(
        'Filesystem     1B-blocks    Used Available Use% Mounted on\n' +
          '/dev/sda1 1000000000000 400000000000 600000000000  40% /media'
      );

      const result = await service.getDiskUsage('/media');

      expect(result.totalBytes).toBe(1000000000000n);
      expect(result.availableBytes).toBe(600000000000n);
      expect(result.usedPercent).toBe(40);
    });

    it('should throw InternalServerErrorException on exec failure', async () => {
      execRejects(new Error('df failed'));

      await expect(service.getDiskUsage('/media')).rejects.toThrow(InternalServerErrorException);
    });

    it('should throw on invalid df output (single line)', async () => {
      execResolves('invalid');

      await expect(service.getDiskUsage('/media')).rejects.toThrow(InternalServerErrorException);
    });
  });
});
