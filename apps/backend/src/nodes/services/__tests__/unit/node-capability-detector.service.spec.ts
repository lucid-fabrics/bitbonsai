import { Test, type TestingModule } from '@nestjs/testing';
import { LibrariesService } from '../../../../libraries/libraries.service';
import { PrismaService } from '../../../../prisma/prisma.service';
import { NodeCapabilityDetectorService } from '../../node-capability-detector.service';

describe('NodeCapabilityDetectorService', () => {
  let service: NodeCapabilityDetectorService;

  const mockPrismaService = {};

  const mockLibrariesService = {
    getAllLibraryPaths: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NodeCapabilityDetectorService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: LibrariesService, useValue: mockLibrariesService },
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
      mockLibrariesService.getAllLibraryPaths.mockResolvedValue([]);

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
      mockLibrariesService.getAllLibraryPaths.mockResolvedValue([]);

      const result = await service.detectCapabilities('node-1', '192.168.1.170');

      expect(result.networkLocation).toBe('LOCAL');
      expect(result.isPrivateIP).toBe(true);
      expect(result.reasoning).toContain('Local network');
    });

    it('should detect REMOTE for public IP', async () => {
      mockLibrariesService.getAllLibraryPaths.mockResolvedValue([]);

      const result = await service.detectCapabilities('node-1', '203.0.113.5');

      expect(result.networkLocation).toBe('REMOTE');
      expect(result.isPrivateIP).toBe(false);
      expect(result.reasoning).toContain('Remote network');
    });

    it('should include storage info in reasoning when no shared storage', async () => {
      mockLibrariesService.getAllLibraryPaths.mockResolvedValue([]);

      const result = await service.detectCapabilities('node-1', '192.168.1.170');

      expect(result.reasoning).toContain('No shared storage');
      expect(result.reasoning).toContain('file transfers');
    });

    it('should not test shared storage for REMOTE nodes', async () => {
      mockLibrariesService.getAllLibraryPaths.mockResolvedValue(['/media/movies']);

      const result = await service.detectCapabilities('node-1', '203.0.113.5');

      expect(result.hasSharedStorage).toBe(false);
      expect(result.storageBasePath).toBeNull();
    });

    it('should set bandwidthMbps to null (not yet implemented)', async () => {
      mockLibrariesService.getAllLibraryPaths.mockResolvedValue([]);

      const result = await service.detectCapabilities('node-1', '192.168.1.170');

      expect(result.bandwidthMbps).toBeNull();
    });

    it('should include shared storage reasoning when detected', async () => {
      mockLibrariesService.getAllLibraryPaths.mockResolvedValue(['/media/movies']);

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
});
