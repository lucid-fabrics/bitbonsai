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

    it('should find file by fuzzy name match when size does not match', async () => {
      mockJellyfinService.findFileByNameAndSize.mockResolvedValue({ found: false });
      (fs.existsSync as jest.Mock).mockImplementation((p: string) => p === '/media/movies');

      (fs.readdirSync as jest.Mock).mockImplementation((dir: string, opts?: any) => {
        if (dir === '/media/movies' && opts?.withFileTypes) {
          return [
            {
              name: 'The.Matrix.1999.1080p.BluRay.x264.mkv',
              isFile: () => true,
              isDirectory: () => false,
            },
          ];
        }
        return [];
      });

      // Different size to ensure fuzzy path
      (fs.statSync as jest.Mock).mockReturnValue({ size: 9999 });

      const result = await service.relocateFile('/media/movies/The Matrix (1999).mkv', 1024);

      expect(result.found).toBe(true);
      expect(result.matchType).toBe('fuzzy_name');
      expect(result.source).toBe('filesystem');
      expect(result.confidence).toBeGreaterThan(0);
    });

    it('should assign matchType "both" when size and name both match', async () => {
      mockJellyfinService.findFileByNameAndSize.mockResolvedValue({ found: false });
      (fs.existsSync as jest.Mock).mockImplementation((p: string) => p === '/media/movies');

      (fs.readdirSync as jest.Mock).mockImplementation((dir: string, opts?: any) => {
        if (dir === '/media/movies' && opts?.withFileTypes) {
          return [
            {
              name: 'The.Matrix.1999.1080p.mkv',
              isFile: () => true,
              isDirectory: () => false,
            },
          ];
        }
        return [];
      });

      (fs.statSync as jest.Mock).mockReturnValue({ size: 2048 });

      const result = await service.relocateFile('/media/movies/The Matrix (1999).mkv', 2048);

      expect(result.found).toBe(true);
      expect(result.matchType).toBe('both');
      expect(result.confidence).toBe(95);
    });

    it('should assign confidence 85 for size match with low name similarity', async () => {
      mockJellyfinService.findFileByNameAndSize.mockResolvedValue({ found: false });
      (fs.existsSync as jest.Mock).mockImplementation((p: string) => p === '/media/movies');

      (fs.readdirSync as jest.Mock).mockImplementation((dir: string, opts?: any) => {
        if (dir === '/media/movies' && opts?.withFileTypes) {
          return [
            {
              name: 'zzzzz_totally_different_name.mkv',
              isFile: () => true,
              isDirectory: () => false,
            },
          ];
        }
        return [];
      });

      (fs.statSync as jest.Mock).mockReturnValue({ size: 5000 });

      const result = await service.relocateFile('/media/movies/original.mkv', 5000);

      expect(result.found).toBe(true);
      expect(result.matchType).toBe('exact_size');
      expect(result.confidence).toBe(85);
    });

    it('should skip files where statSync throws', async () => {
      mockJellyfinService.findFileByNameAndSize.mockResolvedValue({ found: false });
      (fs.existsSync as jest.Mock).mockImplementation((p: string) => p === '/media/movies');

      (fs.readdirSync as jest.Mock).mockImplementation((dir: string, opts?: any) => {
        if (dir === '/media/movies' && opts?.withFileTypes) {
          return [{ name: 'locked.mkv', isFile: () => true, isDirectory: () => false }];
        }
        return [];
      });

      (fs.statSync as jest.Mock).mockImplementation(() => {
        throw new Error('EACCES: permission denied');
      });

      const result = await service.relocateFile('/media/movies/test.mkv', 1024);

      expect(result.found).toBe(false);
      expect(result.searchedPaths).toBe(1);
    });

    it('should skip directories where readdirSync throws', async () => {
      mockJellyfinService.findFileByNameAndSize.mockResolvedValue({ found: false });
      (fs.existsSync as jest.Mock).mockImplementation((p: string) => p === '/media/movies');

      (fs.readdirSync as jest.Mock).mockImplementation(() => {
        throw new Error('EACCES: permission denied');
      });

      const result = await service.relocateFile('/media/movies/test.mkv', 1024);

      expect(result.found).toBe(false);
    });

    it('should count searchedPaths correctly across multiple video files', async () => {
      mockJellyfinService.findFileByNameAndSize.mockResolvedValue({ found: false });
      (fs.existsSync as jest.Mock).mockImplementation((p: string) => p === '/media/movies');

      (fs.readdirSync as jest.Mock).mockImplementation((dir: string, opts?: any) => {
        if (dir === '/media/movies' && opts?.withFileTypes) {
          return [
            { name: 'movie-a.mkv', isFile: () => true, isDirectory: () => false },
            { name: 'movie-b.mp4', isFile: () => true, isDirectory: () => false },
            { name: 'movie-c.avi', isFile: () => true, isDirectory: () => false },
            { name: 'subtitle.srt', isFile: () => true, isDirectory: () => false }, // non-video
          ];
        }
        return [];
      });

      (fs.statSync as jest.Mock).mockReturnValue({ size: 999 }); // no size match

      const result = await service.relocateFile('/media/movies/missing.mkv', 1024);

      // 3 video files searched (subtitle.srt excluded), none match
      expect(result.searchedPaths).toBe(3);
      expect(result.found).toBe(false);
    });
  });

  describe('normalizeFilename (private)', () => {
    const normalize = (service: FileRelocatorService, name: string): string =>
      (service as any).normalizeFilename(name);

    it('should strip year patterns', () => {
      const result = normalize(service, 'The Matrix (1999).mkv');
      expect(result).not.toContain('1999');
    });

    it('should strip quality tags', () => {
      const result = normalize(service, 'Inception.2010.1080p.BluRay.x264.mkv');
      expect(result).not.toMatch(/1080p|bluray|x264/i);
    });

    it('should normalize dots and underscores to spaces', () => {
      const result = normalize(service, 'The.Dark.Knight.mkv');
      expect(result).toBe('the dark knight');
    });

    it('should lowercase the result', () => {
      const result = normalize(service, 'INCEPTION.mkv');
      expect(result).toBe(result.toLowerCase());
    });

    it('should collapse multiple spaces', () => {
      const result = normalize(service, 'Movie   Title.mkv');
      expect(result).not.toContain('  ');
    });
  });

  describe('calculateSimilarity (private)', () => {
    const similarity = (service: FileRelocatorService, a: string, b: string): number =>
      (service as any).calculateSimilarity(a, b);

    it('should return 1 for identical strings', () => {
      expect(similarity(service, 'the matrix', 'the matrix')).toBe(1);
    });

    it('should return 0 for empty strings', () => {
      expect(similarity(service, '', 'something')).toBe(0);
      expect(similarity(service, 'something', '')).toBe(0);
    });

    it('should return high similarity when one contains the other', () => {
      const result = similarity(service, 'the matrix', 'the matrix reloaded');
      expect(result).toBeGreaterThan(0.5);
    });

    it('should return low similarity for completely different strings', () => {
      const result = similarity(service, 'abcdefghij', 'zyxwvutsrq');
      expect(result).toBeLessThan(0.5);
    });

    it('should return value between 0 and 1', () => {
      const result = similarity(service, 'hello world', 'hello earth');
      expect(result).toBeGreaterThanOrEqual(0);
      expect(result).toBeLessThanOrEqual(1);
    });
  });
});
