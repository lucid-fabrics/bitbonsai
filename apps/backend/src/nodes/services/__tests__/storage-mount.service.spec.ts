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
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
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

  describe('mount - fstab integration', () => {
    it('should add to fstab when addToFstab is true and mount succeeds', async () => {
      mockRepository.findById.mockResolvedValue({ ...baseShare, addToFstab: true });
      mockStrategy.buildMountCommand.mockResolvedValue('mount ...');
      mockStrategy.buildFstabEntry.mockResolvedValue(
        '192.168.1.100:/mnt/media /media nfs defaults 0 0'
      );
      mockFs.access.mockResolvedValue(undefined);
      execResolves('', '');
      execResolves('/media type nfs');
      mockRepository.updateStatus.mockResolvedValue({});
      mockFs.readFile.mockResolvedValue('');
      mockFs.appendFile.mockResolvedValue(undefined);

      const result = await service.mount('share-1');

      expect(result.success).toBe(true);
      expect(mockFs.appendFile).toHaveBeenCalled();
    });

    it('should skip fstab write when entry already exists', async () => {
      mockRepository.findById.mockResolvedValue({ ...baseShare, addToFstab: true });
      mockStrategy.buildMountCommand.mockResolvedValue('mount ...');
      mockFs.access.mockResolvedValue(undefined);
      execResolves('', '');
      execResolves('/media type nfs');
      mockRepository.updateStatus.mockResolvedValue({});
      // fstab already has an entry for /media
      mockFs.readFile.mockResolvedValue('192.168.1.100:/mnt/media /media nfs defaults 0 0');

      const result = await service.mount('share-1');

      expect(result.success).toBe(true);
      expect(mockFs.appendFile).not.toHaveBeenCalled();
    });

    it('should not fail mount when fstab write throws', async () => {
      mockRepository.findById.mockResolvedValue({ ...baseShare, addToFstab: true });
      mockStrategy.buildMountCommand.mockResolvedValue('mount ...');
      mockFs.access.mockResolvedValue(undefined);
      execResolves('', '');
      execResolves('/media type nfs');
      mockRepository.updateStatus.mockResolvedValue({});
      mockFs.readFile.mockResolvedValue('');
      mockFs.appendFile.mockRejectedValue(new Error('Permission denied'));

      const result = await service.mount('share-1');

      // Mount should still succeed even if fstab fails
      expect(result.success).toBe(true);
    });

    it('should handle mount stderr warning without failing', async () => {
      mockRepository.findById.mockResolvedValue(baseShare);
      mockStrategy.buildMountCommand.mockResolvedValue('mount ...');
      mockFs.access.mockResolvedValue(undefined);
      execResolves('', 'warning: something minor');
      execResolves('/media type nfs');
      mockRepository.updateStatus.mockResolvedValue({});

      const result = await service.mount('share-1');

      expect(result.success).toBe(true);
    });

    it('should throw NotFoundException when share not found', async () => {
      mockRepository.findById.mockResolvedValue(null);

      await expect(service.mount('missing-share')).rejects.toThrow(
        'Storage share missing-share not found'
      );
    });
  });

  describe('unmount - fstab removal', () => {
    it('should remove from fstab when addToFstab is true', async () => {
      mockRepository.findById.mockResolvedValue({
        ...baseShare,
        isMounted: true,
        addToFstab: true,
      });
      execResolves('', '');
      execRejects(new Error('not mounted'));
      mockRepository.updateStatus.mockResolvedValue({});
      mockFs.readFile.mockResolvedValue('192.168.1.100:/mnt/media /media nfs defaults 0 0\n');
      mockFs.writeFile.mockResolvedValue(undefined);

      const result = await service.unmount('share-1');

      expect(result.success).toBe(true);
      expect(mockFs.writeFile).toHaveBeenCalled();
    });

    it('should handle unmount stderr warning without failing', async () => {
      mockRepository.findById.mockResolvedValue({ ...baseShare, isMounted: true });
      execResolves('', 'warning: lazy unmount');
      execRejects(new Error('not mounted'));
      mockRepository.updateStatus.mockResolvedValue({});

      const result = await service.unmount('share-1');

      expect(result.success).toBe(true);
    });

    it('should fail when unmount verification shows still mounted', async () => {
      mockRepository.findById.mockResolvedValue({ ...baseShare, isMounted: true });
      execResolves('', '');
      // verifyMount returns true (still mounted)
      execResolves('/media type nfs');

      const result = await service.unmount('share-1');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Unmount verification failed');
    });

    it('should throw NotFoundException when share not found during unmount', async () => {
      mockRepository.findById.mockResolvedValue(null);

      await expect(service.unmount('missing-share')).rejects.toThrow(
        'Storage share missing-share not found'
      );
    });
  });

  describe('remount', () => {
    it('should return unmount failure without attempting mount', async () => {
      mockRepository.findById.mockResolvedValue({ ...baseShare, isMounted: true });
      execRejects(new Error('Device busy'));

      const result = await service.remount('share-1');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Device busy');
    });

    it('should unmount then mount on success', async () => {
      // First findById for unmount (isMounted true)
      mockRepository.findById
        .mockResolvedValueOnce({ ...baseShare, isMounted: true })
        // Second findById for mount (isMounted false after unmount)
        .mockResolvedValueOnce({ ...baseShare, isMounted: false });

      // unmount: exec OK, verify: not mounted
      execResolves('', '');
      execRejects(new Error('not mounted'));
      mockRepository.updateStatus.mockResolvedValue({});

      // mount: access OK, exec OK, verify: mounted
      mockStrategy.buildMountCommand.mockResolvedValue('mount ...');
      mockFs.access.mockResolvedValue(undefined);
      execResolves('', '');
      execResolves('/media type nfs');

      const result = await service.remount('share-1');

      expect(result.success).toBe(true);
    });
  });

  describe('testConnectivity - protocol-specific', () => {
    it('should only test SMB when protocol is SMB', async () => {
      execResolves('1 received');
      mockStrategy.testConnectivity.mockResolvedValue(false);

      await service.testConnectivity('192.168.1.100', StorageProtocol.SMB);

      expect(mockStrategyFactory.getStrategy).toHaveBeenCalledWith(StorageProtocol.SMB);
      expect(mockStrategyFactory.getStrategy).not.toHaveBeenCalledWith(StorageProtocol.NFS);
    });

    it('should test both NFS and SMB when no protocol specified', async () => {
      execResolves('1 received');
      mockStrategy.testConnectivity.mockResolvedValue(true);

      const result = await service.testConnectivity('192.168.1.100');

      expect(result.supportsNFS).toBe(true);
      expect(result.supportsSMB).toBe(true);
    });

    it('should return latencyMs when reachable', async () => {
      execResolves('1 packets received');
      mockStrategy.testConnectivity.mockResolvedValue(true);

      const result = await service.testConnectivity('192.168.1.100');

      expect(result.isReachable).toBe(true);
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    });
  });

  // ==========================================================================
  // getDiskUsage - additional edge cases
  // ==========================================================================
  describe('getDiskUsage - additional cases', () => {
    it('should correctly strip % from usedPercent field', async () => {
      execResolves(
        'Filesystem     1B-blocks    Used Available Use% Mounted on\n' +
          '/dev/sda1 2000000000000 1000000000000 1000000000000  50% /media'
      );

      const result = await service.getDiskUsage('/media');

      expect(result.usedPercent).toBe(50);
      expect(typeof result.usedPercent).toBe('number');
    });

    it('should parse availableBytes independently from usedBytes', async () => {
      execResolves(
        'Filesystem 1B-blocks Used Available Use% Mounted on\n' +
          '/dev/sdb1 500000000000 100000000000 400000000000  20% /data'
      );

      const result = await service.getDiskUsage('/data');

      expect(result.totalBytes).toBe(500000000000n);
      expect(result.availableBytes).toBe(400000000000n);
      expect(result.usedPercent).toBe(20);
    });
  });

  // ==========================================================================
  // mount - non-warning stderr is logged but does not fail
  // ==========================================================================
  describe('mount - stderr with non-warning content', () => {
    it('should warn when stderr does not contain warning keyword', async () => {
      mockRepository.findById.mockResolvedValue(baseShare);
      mockStrategy.buildMountCommand.mockResolvedValue('mount ...');
      mockFs.access.mockResolvedValue(undefined);
      execResolves('', 'info: using version 4');
      execResolves('/media type nfs');
      mockRepository.updateStatus.mockResolvedValue({});

      const result = await service.mount('share-1');

      // Mount still succeeds; stderr is just logged
      expect(result.success).toBe(true);
    });
  });

  // ==========================================================================
  // unmount - without force flag explicitly uses plain umount
  // ==========================================================================
  describe('unmount - plain umount command', () => {
    it('should use plain umount when force is false', async () => {
      mockRepository.findById.mockResolvedValue({ ...baseShare, isMounted: true });
      execResolves('', '');
      execRejects(new Error('not mounted'));
      mockRepository.updateStatus.mockResolvedValue({});

      await service.unmount('share-1', false);

      const cmd = mockExec.mock.calls[0][0] as string;
      expect(cmd).toContain('umount');
      expect(cmd).not.toContain('-f');
    });
  });

  // ==========================================================================
  // addToFstab - fstab does not exist yet (readFile throws)
  // ==========================================================================
  describe('mount - fstab does not exist', () => {
    it('should create fstab entry when file does not exist', async () => {
      mockRepository.findById.mockResolvedValue({ ...baseShare, addToFstab: true });
      mockStrategy.buildMountCommand.mockResolvedValue('mount ...');
      mockStrategy.buildFstabEntry.mockResolvedValue(
        '192.168.1.100:/mnt/media /media nfs defaults 0 0'
      );
      mockFs.access.mockResolvedValue(undefined);
      execResolves('', '');
      execResolves('/media type nfs');
      mockRepository.updateStatus.mockResolvedValue({});
      // readFile throws ENOENT — fstab doesn't exist
      mockFs.readFile.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
      mockFs.appendFile.mockResolvedValue(undefined);

      const result = await service.mount('share-1');

      expect(result.success).toBe(true);
      expect(mockFs.appendFile).toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // removeFromFstab - preserves comments and blank lines
  // ==========================================================================
  describe('unmount - fstab preserves comments and blank lines', () => {
    it('should keep comment lines and blank lines when removing entry', async () => {
      mockRepository.findById.mockResolvedValue({
        ...baseShare,
        isMounted: true,
        addToFstab: true,
      });
      execResolves('', '');
      execRejects(new Error('not mounted'));
      mockRepository.updateStatus.mockResolvedValue({});

      const fstabContent =
        '# /etc/fstab\n' +
        '\n' +
        '192.168.1.100:/mnt/media /media nfs defaults 0 0\n' +
        '/dev/sda1 / ext4 defaults 0 1\n';

      mockFs.readFile.mockResolvedValue(fstabContent);
      mockFs.writeFile.mockResolvedValue(undefined);

      await service.unmount('share-1');

      const writtenContent =
        ((mockFs.writeFile as jest.Mock).mock.calls[1]?.[1] as string) ??
        ((mockFs.writeFile as jest.Mock).mock.calls[0][1] as string);
      expect(writtenContent).toContain('# /etc/fstab');
      expect(writtenContent).toContain('/dev/sda1');
      expect(writtenContent).not.toContain('/media nfs');
    });
  });

  // ==========================================================================
  // testConnectivity - NFS-only when protocol is NFS
  // ==========================================================================
  describe('testConnectivity - NFS only', () => {
    it('should only test NFS when protocol is NFS', async () => {
      execResolves('1 received');
      mockStrategy.testConnectivity.mockResolvedValue(true);

      const result = await service.testConnectivity('192.168.1.100', StorageProtocol.NFS);

      expect(mockStrategyFactory.getStrategy).toHaveBeenCalledWith(StorageProtocol.NFS);
      expect(mockStrategyFactory.getStrategy).not.toHaveBeenCalledWith(StorageProtocol.SMB);
      expect(result.supportsNFS).toBe(true);
      expect(result.supportsSMB).toBe(false);
    });

    it('should return false for both protocols when host is unreachable and no protocol specified', async () => {
      execResolves('0 received');

      const result = await service.testConnectivity('10.0.0.99');

      expect(result.isReachable).toBe(false);
      expect(result.supportsNFS).toBe(false);
      expect(result.supportsSMB).toBe(false);
      expect(result.error).toBe('Host unreachable');
    });
  });
});
