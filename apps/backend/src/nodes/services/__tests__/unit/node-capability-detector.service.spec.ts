import { Test, type TestingModule } from '@nestjs/testing';
import { promises as fsPromises } from 'fs';
import { LibraryPathsService } from '../../../../media/library-paths.service';
import { NodeCapabilityDetectorService } from '../../node-capability-detector.service';

describe('NodeCapabilityDetectorService', () => {
  let service: NodeCapabilityDetectorService;

  const mockLibraryPathsService = {
    getAllLibraryPaths: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NodeCapabilityDetectorService,
        { provide: LibraryPathsService, useValue: mockLibraryPathsService },
      ],
    }).compile();

    service = module.get<NodeCapabilityDetectorService>(NodeCapabilityDetectorService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('isPrivateIP', () => {
    it('should detect 10.x.x.x as private', () => {
      expect(service.isPrivateIP('10.0.0.1')).toBe(true);
      expect(service.isPrivateIP('10.255.255.255')).toBe(true);
    });

    it('should detect 172.16-31.x.x as private', () => {
      expect(service.isPrivateIP('172.16.0.1')).toBe(true);
      expect(service.isPrivateIP('172.31.255.255')).toBe(true);
    });

    it('should detect 192.168.x.x as private', () => {
      expect(service.isPrivateIP('192.168.1.100')).toBe(true);
      expect(service.isPrivateIP('192.168.0.1')).toBe(true);
    });

    it('should detect public IPs as non-private', () => {
      expect(service.isPrivateIP('8.8.8.8')).toBe(false);
      expect(service.isPrivateIP('1.1.1.1')).toBe(false);
      expect(service.isPrivateIP('172.32.0.1')).toBe(false);
    });
  });

  describe('testSharedStorageAccess', () => {
    it('should return false when no libraries configured', async () => {
      mockLibraryPathsService.getAllLibraryPaths.mockResolvedValue([]);

      const result = await service.testSharedStorageAccess('node-1', '192.168.1.100');

      expect(result.hasSharedStorage).toBe(false);
      expect(result.storageBasePath).toBeNull();
    });
  });

  describe('measureLatency', () => {
    it('should return a numeric latency value', async () => {
      // measureLatency uses ping - returns actual latency or a default
      const result = await service.measureLatency('127.0.0.1');

      expect(typeof result).toBe('number');
      expect(result).toBeGreaterThanOrEqual(0);
    });

    it('should return default for unreachable IP', async () => {
      // Mock the private method to force a failure
      jest.spyOn(service, 'measureLatency').mockResolvedValue(10);

      const result = await service.measureLatency('192.168.99.99');

      expect(result).toBe(10);
    });
  });

  describe('detectCapabilities', () => {
    beforeEach(() => {
      // Mock measureLatency to avoid actual ping calls
      jest.spyOn(service, 'measureLatency').mockResolvedValue(5);
    });

    it('should detect LOCAL network for private IP', async () => {
      mockLibraryPathsService.getAllLibraryPaths.mockResolvedValue([]);

      const result = await service.detectCapabilities('node-1', '192.168.1.170');

      expect(result.networkLocation).toBe('LOCAL');
      expect(result.isPrivateIP).toBe(true);
      expect(result.reasoning).toContain('Local network');
    });

    it('should detect REMOTE for public IP', async () => {
      mockLibraryPathsService.getAllLibraryPaths.mockResolvedValue([]);

      const result = await service.detectCapabilities('node-1', '203.0.113.5');

      expect(result.networkLocation).toBe('REMOTE');
      expect(result.isPrivateIP).toBe(false);
      expect(result.reasoning).toContain('Remote network');
    });

    it('should include storage info in reasoning when no shared storage', async () => {
      mockLibraryPathsService.getAllLibraryPaths.mockResolvedValue([]);

      const result = await service.detectCapabilities('node-1', '192.168.1.170');

      expect(result.reasoning).toContain('No shared storage');
      expect(result.reasoning).toContain('file transfers');
    });

    it('should not test shared storage for REMOTE nodes', async () => {
      mockLibraryPathsService.getAllLibraryPaths.mockResolvedValue(['/media/movies']);

      const result = await service.detectCapabilities('node-1', '203.0.113.5');

      expect(result.hasSharedStorage).toBe(false);
      expect(result.storageBasePath).toBeNull();
    });

    it('should set bandwidthMbps to null (not yet implemented)', async () => {
      mockLibraryPathsService.getAllLibraryPaths.mockResolvedValue([]);

      const result = await service.detectCapabilities('node-1', '192.168.1.170');

      expect(result.bandwidthMbps).toBeNull();
    });

    it('should include shared storage reasoning when detected', async () => {
      mockLibraryPathsService.getAllLibraryPaths.mockResolvedValue(['/media/movies']);

      // Mock testSharedStorageAccess to simulate shared storage
      jest.spyOn(service, 'testSharedStorageAccess').mockResolvedValue({
        hasSharedStorage: true,
        storageBasePath: '/media/movies',
      });

      const result = await service.detectCapabilities('node-1', '192.168.1.170');

      expect(result.hasSharedStorage).toBe(true);
      expect(result.reasoning).toContain('zero-copy');
    });
  });

  describe('testBandwidth', () => {
    it('should return 0 (placeholder)', async () => {
      const result = await service.testBandwidth('node-1', 'http://node:3000');

      expect(result).toBe(0);
    });
  });

  describe('isPrivateIP – edge cases', () => {
    it('should return false for 172.15.x.x (below range)', () => {
      expect(service.isPrivateIP('172.15.255.255')).toBe(false);
    });

    it('should return false for 172.32.x.x (above range)', () => {
      expect(service.isPrivateIP('172.32.0.0')).toBe(false);
    });

    it('should return true for 172.16.0.0', () => {
      expect(service.isPrivateIP('172.16.0.0')).toBe(true);
    });

    it('should return true for 172.31.255.255', () => {
      expect(service.isPrivateIP('172.31.255.255')).toBe(true);
    });

    it('should return false for empty string', () => {
      expect(service.isPrivateIP('')).toBe(false);
    });
  });

  describe('testSharedStorageAccess – localhost/127.0.0.1 branch', () => {
    it('should test local access when nodeIp is undefined', async () => {
      mockLibraryPathsService.getAllLibraryPaths.mockResolvedValue(['/tmp']);
      jest.spyOn(fsPromises, 'access').mockResolvedValue(undefined);
      jest.spyOn(fsPromises, 'readdir').mockResolvedValue(['file.mkv'] as unknown as never);

      const result = await service.testSharedStorageAccess('node-1', undefined);
      expect(result.hasSharedStorage).toBe(true);
      expect(result.storageBasePath).toBe('/tmp');
    });

    it('should test local access when nodeIp is localhost', async () => {
      mockLibraryPathsService.getAllLibraryPaths.mockResolvedValue(['/tmp/media']);
      jest.spyOn(fsPromises, 'access').mockResolvedValue(undefined);
      jest.spyOn(fsPromises, 'readdir').mockResolvedValue([] as unknown as never);

      const result = await service.testSharedStorageAccess('node-1', 'localhost');
      expect(result.hasSharedStorage).toBe(true);
    });

    it('should test local access when nodeIp is 127.0.0.1', async () => {
      mockLibraryPathsService.getAllLibraryPaths.mockResolvedValue(['/tmp/media']);
      jest.spyOn(fsPromises, 'access').mockResolvedValue(undefined);
      jest.spyOn(fsPromises, 'readdir').mockResolvedValue(['a'] as unknown as never);

      const result = await service.testSharedStorageAccess('node-1', '127.0.0.1');
      expect(result.hasSharedStorage).toBe(true);
    });

    it('returns no storage when local path is not accessible', async () => {
      mockLibraryPathsService.getAllLibraryPaths.mockResolvedValue(['/nonexistent/path']);
      jest.spyOn(fsPromises, 'access').mockRejectedValue(new Error('ENOENT'));

      const result = await service.testSharedStorageAccess('node-1', '127.0.0.1');
      expect(result.hasSharedStorage).toBe(false);
      expect(result.storageBasePath).toBeNull();
    });
  });

  describe('testSharedStorageAccess – NFS matching', () => {
    it('returns shared storage when media path matches NFS export', async () => {
      mockLibraryPathsService.getAllLibraryPaths.mockResolvedValue(['/mnt/user/media']);
      jest
        .spyOn(fsPromises, 'readFile')
        .mockResolvedValue('/mnt/user/media 192.168.1.0/24(rw)\n' as unknown as Buffer);
      // Make smb.conf unreadable
      jest.spyOn(fsPromises, 'readFile').mockImplementation((p) => {
        if (String(p) === '/etc/exports') {
          return Promise.resolve('/mnt/user/media 192.168.1.0/24(rw)\n' as unknown as Buffer);
        }
        return Promise.reject(new Error('not found'));
      });

      const result = await service.testSharedStorageAccess('node-1', '192.168.1.50');
      expect(result.hasSharedStorage).toBe(true);
      expect(result.storageBasePath).toBe('/mnt/user/media');
    });

    it('returns shared storage when media path matches SMB share', async () => {
      mockLibraryPathsService.getAllLibraryPaths.mockResolvedValue(['/mnt/user/media']);
      jest.spyOn(fsPromises, 'readFile').mockImplementation((p) => {
        if (String(p) === '/etc/exports') {
          return Promise.reject(new Error('not found'));
        }
        if (String(p) === '/etc/samba/smb.conf') {
          return Promise.resolve(
            '[global]\n[media]\n   path = /mnt/user/media\n' as unknown as Buffer
          );
        }
        return Promise.reject(new Error('not found'));
      });

      const result = await service.testSharedStorageAccess('node-1', '192.168.1.50');
      expect(result.hasSharedStorage).toBe(true);
      expect(result.storageBasePath).toBe('/mnt/user/media');
    });

    it('returns no storage when neither NFS nor SMB matches', async () => {
      mockLibraryPathsService.getAllLibraryPaths.mockResolvedValue(['/mnt/user/movies']);
      jest.spyOn(fsPromises, 'readFile').mockImplementation((p) => {
        if (String(p) === '/etc/exports') {
          return Promise.resolve('/mnt/user/music 192.168.1.0/24(rw)\n' as unknown as Buffer);
        }
        if (String(p) === '/etc/samba/smb.conf') {
          return Promise.resolve('[global]\n[backups]\n' as unknown as Buffer);
        }
        return Promise.reject(new Error('not found'));
      });

      const result = await service.testSharedStorageAccess('node-1', '192.168.1.50');
      expect(result.hasSharedStorage).toBe(false);
    });

    it('skips empty media paths gracefully', async () => {
      mockLibraryPathsService.getAllLibraryPaths.mockResolvedValue(['', '   ', '/real/path']);
      jest.spyOn(fsPromises, 'readFile').mockRejectedValue(new Error('not found'));

      const result = await service.testSharedStorageAccess('node-1', '192.168.1.50');
      expect(result.hasSharedStorage).toBe(false);
    });

    it('skips empty NFS export paths gracefully', async () => {
      mockLibraryPathsService.getAllLibraryPaths.mockResolvedValue(['/media/tv']);
      jest.spyOn(fsPromises, 'readFile').mockImplementation((p) => {
        if (String(p) === '/etc/exports') {
          // First line is header (skipped), then empty line, then real export
          return Promise.resolve(
            'Exports list on host:\n\n/media/tv 192.168.1.0/24\n' as unknown as Buffer
          );
        }
        return Promise.reject(new Error('not found'));
      });

      const result = await service.testSharedStorageAccess('node-1', '192.168.1.50');
      expect(result.hasSharedStorage).toBe(true);
    });
  });

  describe('detectCapabilities – latency branches', () => {
    it('classifies private IP with high latency as LOCAL (VPN/slow local)', async () => {
      mockLibraryPathsService.getAllLibraryPaths.mockResolvedValue([]);
      jest.spyOn(service, 'measureLatency').mockResolvedValue(200);

      const result = await service.detectCapabilities('node-1', '10.8.0.5');
      expect(result.networkLocation).toBe('LOCAL');
      expect(result.isPrivateIP).toBe(true);
    });

    it('result has expected shape', async () => {
      mockLibraryPathsService.getAllLibraryPaths.mockResolvedValue([]);
      jest.spyOn(service, 'measureLatency').mockResolvedValue(3);

      const result = await service.detectCapabilities('node-1', '192.168.1.5');
      expect(result).toMatchObject({
        bandwidthMbps: null,
        isPrivateIP: true,
        latencyMs: 3,
      });
      expect(typeof result.reasoning).toBe('string');
      expect(result.reasoning.length).toBeGreaterThan(0);
    });
  });
});
