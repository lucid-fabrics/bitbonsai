import { Test, type TestingModule } from '@nestjs/testing';
import { JellyfinIntegrationService } from '../../../../integrations/jellyfin.service';
import { FileRelocatorService } from '../../file-relocator.service';

// Mock fs module
jest.mock('node:fs', () => ({
  existsSync: jest.fn(),
  readdirSync: jest.fn(),
  statSync: jest.fn(),
}));

import * as fs from 'node:fs';

describe('FileRelocatorService', () => {
  let service: FileRelocatorService;

  const mockJellyfinService = {
    findFileByNameAndSize: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FileRelocatorService,
        { provide: JellyfinIntegrationService, useValue: mockJellyfinService },
      ],
    }).compile();

    service = module.get<FileRelocatorService>(FileRelocatorService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('relocateFile', () => {
    it('should return jellyfin match when found and file exists', async () => {
      mockJellyfinService.findFileByNameAndSize.mockResolvedValue({
        found: true,
        path: '/media/movies/new-name.mkv',
      });
      (fs.existsSync as jest.Mock).mockReturnValue(true);

      const result = await service.relocateFile('/media/movies/old-name.mkv', 1024);

      expect(result.found).toBe(true);
      expect(result.matchType).toBe('jellyfin');
      expect(result.confidence).toBe(98);
      expect(result.newPath).toBe('/media/movies/new-name.mkv');
      expect(result.source).toBe('jellyfin');
    });

    it('should fall back to filesystem when jellyfin path does not exist', async () => {
      mockJellyfinService.findFileByNameAndSize.mockResolvedValue({
        found: true,
        path: '/media/movies/ghost.mkv',
      });
      // First call: jellyfin path check returns false; subsequent: dir checks
      (fs.existsSync as jest.Mock).mockReturnValue(false);

      const result = await service.relocateFile('/media/movies/old-name.mkv', 1024);

      expect(result.found).toBe(false);
      expect(result.source).toBe('filesystem');
    });

    it('should fall back to filesystem when jellyfin throws', async () => {
      mockJellyfinService.findFileByNameAndSize.mockRejectedValue(new Error('API error'));
      (fs.existsSync as jest.Mock).mockReturnValue(false);

      const result = await service.relocateFile('/media/movies/old-name.mkv', 1024);

      expect(result.found).toBe(false);
    });

    it('should find file by exact size match via filesystem', async () => {
      mockJellyfinService.findFileByNameAndSize.mockResolvedValue({ found: false });
      (fs.existsSync as jest.Mock).mockImplementation((p: string) => {
        // Only original dir exists
        return p === '/media/movies';
      });

      (fs.readdirSync as jest.Mock).mockImplementation((dir: string, opts?: any) => {
        if (dir === '/media/movies' && opts?.withFileTypes) {
          return [{ name: 'renamed.mkv', isFile: () => true, isDirectory: () => false }];
        }
        if (opts?.withFileTypes) {
          return []; // No sibling dirs
        }
        return [];
      });

      (fs.statSync as jest.Mock).mockReturnValue({ size: 2048 });

      const result = await service.relocateFile('/media/movies/original.mkv', 2048);

      expect(result.found).toBe(true);
      expect(result.matchType).toBe('exact_size');
      expect(result.newPath).toBe('/media/movies/renamed.mkv');
      expect(result.source).toBe('filesystem');
    });

    it('should return not found when no candidates match', async () => {
      mockJellyfinService.findFileByNameAndSize.mockResolvedValue({ found: false });
      (fs.existsSync as jest.Mock).mockReturnValue(false);

      const result = await service.relocateFile('/media/movies/gone.mkv', 1024);

      expect(result.found).toBe(false);
      expect(result.newPath).toBeNull();
      expect(result.matchType).toBeNull();
      expect(result.confidence).toBe(0);
    });

    it('should skip original path in candidates', async () => {
      mockJellyfinService.findFileByNameAndSize.mockResolvedValue({ found: false });
      (fs.existsSync as jest.Mock).mockImplementation((p: string) => p === '/media/movies');

      (fs.readdirSync as jest.Mock).mockImplementation((dir: string, opts?: any) => {
        if (dir === '/media/movies' && opts?.withFileTypes) {
          return [{ name: 'original.mkv', isFile: () => true, isDirectory: () => false }];
        }
        return [];
      });

      (fs.statSync as jest.Mock).mockReturnValue({ size: 1024 });

      const result = await service.relocateFile('/media/movies/original.mkv', 1024);

      expect(result.found).toBe(false);
    });

    it('should skip non-video files', async () => {
      mockJellyfinService.findFileByNameAndSize.mockResolvedValue({ found: false });
      (fs.existsSync as jest.Mock).mockImplementation((p: string) => p === '/media/movies');

      (fs.readdirSync as jest.Mock).mockImplementation((dir: string, opts?: any) => {
        if (dir === '/media/movies' && opts?.withFileTypes) {
          return [
            { name: 'metadata.nfo', isFile: () => true, isDirectory: () => false },
            { name: 'poster.jpg', isFile: () => true, isDirectory: () => false },
          ];
        }
        return [];
      });

      const result = await service.relocateFile('/media/movies/test.mkv', 1024);

      expect(result.found).toBe(false);
      expect(result.searchedPaths).toBe(0);
    });

    it('should handle bigint expectedSizeBytes', async () => {
      mockJellyfinService.findFileByNameAndSize.mockResolvedValue({ found: false });
      (fs.existsSync as jest.Mock).mockReturnValue(false);

      const result = await service.relocateFile('/media/movies/test.mkv', BigInt(1073741824));

      expect(result.found).toBe(false);
    });
  });
});
