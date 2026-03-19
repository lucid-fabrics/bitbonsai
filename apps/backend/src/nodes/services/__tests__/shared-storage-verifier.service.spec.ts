/* eslint-disable @typescript-eslint/no-require-imports */
import { Test, type TestingModule } from '@nestjs/testing';
import type { Node } from '@prisma/client';
import { NodeRepository } from '../../../common/repositories/node.repository';
import type { SharedStorageVerifierService } from '../shared-storage-verifier.service';

// We need to mock child_process.exec BEFORE the module is loaded
// Use jest.mock with factory to intercept at import time
const mockExecImpl = jest.fn();

jest.mock('child_process', () => {
  const actual = jest.requireActual('child_process');
  return {
    ...actual,
    exec: (...args: any[]) => mockExecImpl(...args),
  };
});

// Mock fs.promises methods without breaking the rest of fs
const mockFsAccess = jest.fn();
const mockFsStat = jest.fn();

jest.mock('fs', () => {
  const actual = jest.requireActual('fs');
  return {
    ...actual,
    promises: {
      ...actual.promises,
      access: (...args: any[]) => mockFsAccess(...args),
      stat: (...args: any[]) => mockFsStat(...args),
    },
  };
});

describe('SharedStorageVerifierService', () => {
  let service: SharedStorageVerifierService;

  const mockStorageShareRepository = {
    findMountedWithNode: jest.fn(),
    findMountedByNodeId: jest.fn(),
    update: jest.fn(),
  };

  const mockNodeRepository = {
    findById: jest.fn(),
    updateData: jest.fn(),
  };

  const createMockNode = (overrides: Partial<Node> = {}): Node =>
    ({
      id: 'node-1',
      name: 'Test Node',
      status: 'ONLINE',
      role: 'LINKED',
      hasSharedStorage: true,
      storageBasePath: '/mnt/nfs/media',
      ipAddress: '192.168.1.170',
      ...overrides,
    }) as Node;

  function mockExecResult(stdout: string) {
    mockExecImpl.mockImplementation(
      (
        _cmd: string,
        callback: (err: Error | null, result: { stdout: string; stderr: string }) => void
      ) => {
        callback(null, { stdout, stderr: '' });
      }
    );
  }

  function mockExecError(error: Error) {
    mockExecImpl.mockImplementation((_cmd: string, callback: (err: Error) => void) => {
      callback(error);
    });
  }

  beforeEach(async () => {
    jest.clearAllMocks();

    // Dynamic import to get the class after mocks are set up
    const { SharedStorageVerifierService } = require('../shared-storage-verifier.service');

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SharedStorageVerifierService,
        { provide: 'IStorageShareRepository', useValue: mockStorageShareRepository },
        { provide: NodeRepository, useValue: mockNodeRepository },
      ],
    }).compile();

    service = module.get(SharedStorageVerifierService);
  });

  describe('performHealthCheck', () => {
    it('should skip when no mounted shares exist', async () => {
      mockExecResult('');
      mockStorageShareRepository.findMountedWithNode.mockResolvedValue([]);

      await service.performHealthCheck();

      expect(mockStorageShareRepository.update).not.toHaveBeenCalled();
    });

    it('should mark shares as unmounted when mount point missing from system mounts', async () => {
      mockExecResult('192.168.1.100:/vol on /mnt/other type nfs (rw)\n');
      mockStorageShareRepository.findMountedWithNode.mockResolvedValue([
        {
          id: 'share-1',
          nodeId: 'node-1',
          name: 'Media Share',
          mountPoint: '/mnt/nfs/media',
          isMounted: true,
          node: { name: 'Child Node' },
        },
      ]);
      mockNodeRepository.findById.mockResolvedValue({
        id: 'node-1',
        name: 'Child Node',
        hasSharedStorage: true,
      });

      await service.performHealthCheck();

      expect(mockStorageShareRepository.update).toHaveBeenCalledWith(
        'share-1',
        expect.objectContaining({
          isMounted: false,
          status: 'UNMOUNTED',
        })
      );
    });

    it('should update health check timestamp for mounted shares', async () => {
      mockExecResult('192.168.1.100:/vol on /mnt/nfs/media type nfs (rw)\n');
      mockStorageShareRepository.findMountedWithNode.mockResolvedValue([
        {
          id: 'share-1',
          nodeId: 'node-1',
          mountPoint: '/mnt/nfs/media',
          isMounted: true,
          node: { name: 'Child Node' },
        },
      ]);
      mockNodeRepository.findById.mockResolvedValue({
        id: 'node-1',
        hasSharedStorage: true,
      });

      await service.performHealthCheck();

      expect(mockStorageShareRepository.update).toHaveBeenCalledWith(
        'share-1',
        expect.objectContaining({ lastHealthCheckAt: expect.any(Date) })
      );
    });

    it('should set hasSharedStorage=false when node loses all mounts', async () => {
      mockExecResult('');
      mockStorageShareRepository.findMountedWithNode.mockResolvedValue([
        {
          id: 'share-1',
          nodeId: 'node-1',
          mountPoint: '/mnt/gone',
          isMounted: true,
          node: { name: 'Node' },
        },
      ]);
      mockNodeRepository.findById.mockResolvedValue({
        id: 'node-1',
        name: 'Node',
        hasSharedStorage: true,
      });

      await service.performHealthCheck();

      expect(mockNodeRepository.updateData).toHaveBeenCalledWith(
        'node-1',
        expect.objectContaining({ hasSharedStorage: false })
      );
    });

    it('should recover hasSharedStorage=true when mount reappears', async () => {
      mockExecResult('server:/vol on /mnt/nfs type nfs (rw)\n');
      mockStorageShareRepository.findMountedWithNode.mockResolvedValue([
        {
          id: 'share-1',
          nodeId: 'node-1',
          mountPoint: '/mnt/nfs',
          isMounted: true,
          node: { name: 'Node' },
        },
      ]);
      mockNodeRepository.findById.mockResolvedValue({
        id: 'node-1',
        name: 'Node',
        hasSharedStorage: false,
      });

      await service.performHealthCheck();

      expect(mockNodeRepository.updateData).toHaveBeenCalledWith(
        'node-1',
        expect.objectContaining({ hasSharedStorage: true })
      );
    });

    it('should handle mount command failure gracefully', async () => {
      mockExecError(new Error('mount command failed'));

      await expect(service.performHealthCheck()).resolves.toBeUndefined();
    });
  });

  describe('verifyFileAccess', () => {
    it('should return not accessible when target has no shared storage', async () => {
      const target = createMockNode({ hasSharedStorage: false });
      const source = createMockNode({ id: 'src-1' });

      const result = await service.verifyFileAccess('/path/file.mkv', target, source);

      expect(result.isAccessible).toBe(false);
      expect(result.error).toContain('does not have shared storage');
    });

    it('should return accessible when mount and file exist', async () => {
      const target = createMockNode();
      const source = createMockNode({ id: 'src-1', storageBasePath: '/mnt/nfs/media' });

      mockExecResult('server:/vol on /mnt/nfs/media type nfs (rw)\n');
      mockStorageShareRepository.findMountedByNodeId.mockResolvedValue([
        { mountPoint: '/mnt/nfs/media', isMounted: true },
      ]);
      mockFsAccess.mockResolvedValue(undefined);
      mockFsStat.mockResolvedValue({ isFile: () => true });

      const result = await service.verifyFileAccess(
        '/mnt/nfs/media/Movies/test.mkv',
        target,
        source
      );

      expect(result.isAccessible).toBe(true);
      expect(result.isMounted).toBe(true);
    });

    it('should return not accessible when mount is down', async () => {
      const target = createMockNode();
      const source = createMockNode({ id: 'src-1' });

      mockExecResult('');
      mockStorageShareRepository.findMountedByNodeId.mockResolvedValue([]);

      const result = await service.verifyFileAccess('/path/file.mkv', target, source);

      expect(result.isAccessible).toBe(false);
      expect(result.isMounted).toBe(false);
    });

    it('should handle errors and return failure result', async () => {
      const target = createMockNode();
      const source = createMockNode({ id: 'src-1' });

      mockExecError(new Error('exec failed'));

      const result = await service.verifyFileAccess('/path/file.mkv', target, source);

      expect(result.isAccessible).toBe(false);
      expect(result.error).toContain('exec failed');
    });
  });

  describe('verifyNFSMount', () => {
    it('should detect mounted storage share', async () => {
      const node = createMockNode();
      mockExecResult('server:/export on /mnt/nfs/media type nfs (rw)\n');
      mockStorageShareRepository.findMountedByNodeId.mockResolvedValue([
        { mountPoint: '/mnt/nfs/media', isMounted: true, name: 'Media' },
      ]);

      const result = await service.verifyNFSMount(node);

      expect(result.isMounted).toBe(true);
      expect(result.mountPoint).toBe('/mnt/nfs/media');
    });

    it('should fallback to storageBasePath when no shares match', async () => {
      const node = createMockNode({ storageBasePath: '/mnt/data' });
      mockExecResult('server:/vol on /mnt/data type nfs (rw)\n');
      mockStorageShareRepository.findMountedByNodeId.mockResolvedValue([]);

      const result = await service.verifyNFSMount(node);

      expect(result.isMounted).toBe(true);
      expect(result.mountPoint).toBe('/mnt/data');
    });

    it('should return not mounted when no mounts found', async () => {
      const node = createMockNode({ storageBasePath: null });
      mockExecResult('');
      mockStorageShareRepository.findMountedByNodeId.mockResolvedValue([]);

      const result = await service.verifyNFSMount(node);

      expect(result.isMounted).toBe(false);
      expect(result.error).toContain('No storage shares or base path configured');
    });

    it('should handle mount command failure', async () => {
      const node = createMockNode();
      mockExecError(new Error('command not found'));

      const result = await service.verifyNFSMount(node);

      expect(result.isMounted).toBe(false);
      expect(result.error).toContain('Mount check failed');
    });
  });

  describe('batchVerifyAccess', () => {
    it('should verify multiple files in parallel', async () => {
      const target = createMockNode({ hasSharedStorage: false });
      const source = createMockNode({ id: 'src-1' });

      const files = ['/path/a.mkv', '/path/b.mkv', '/path/c.mkv'];
      const results = await service.batchVerifyAccess(files, target, source);

      expect(results.size).toBe(3);
      for (const file of files) {
        expect(results.get(file)?.isAccessible).toBe(false);
      }
    });
  });
});
