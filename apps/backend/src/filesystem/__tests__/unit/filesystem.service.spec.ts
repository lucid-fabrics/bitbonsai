import * as fs from 'node:fs/promises';
import { BadRequestException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { FilesystemService } from '../../filesystem.service';

jest.mock('node:fs/promises');

describe('FilesystemService', () => {
  let service: FilesystemService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [FilesystemService],
    }).compile();

    service = module.get<FilesystemService>(FilesystemService);

    jest.spyOn((service as any).logger, 'log').mockImplementation();
    jest.spyOn((service as any).logger, 'error').mockImplementation();
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  describe('listDirectories', () => {
    it('should list directories in a path', async () => {
      const mockEntries = [
        { name: 'movies', isDirectory: () => true },
        { name: 'tv', isDirectory: () => true },
        { name: 'file.txt', isDirectory: () => false },
        { name: '.hidden', isDirectory: () => true },
      ];

      (fs.readdir as jest.Mock).mockResolvedValue(mockEntries);
      (fs.stat as jest.Mock).mockResolvedValue({});

      const result = await service.listDirectories('/media');

      expect(result.directories).toHaveLength(2); // movies and tv, not file.txt or .hidden
      expect(result.directories[0].name).toBe('movies');
      expect(result.directories[1].name).toBe('tv');
    });

    it('should sort directories alphabetically', async () => {
      const mockEntries = [
        { name: 'zebra', isDirectory: () => true },
        { name: 'alpha', isDirectory: () => true },
        { name: 'middle', isDirectory: () => true },
      ];

      (fs.readdir as jest.Mock).mockResolvedValue(mockEntries);
      (fs.stat as jest.Mock).mockResolvedValue({});

      const result = await service.listDirectories('/test');

      expect(result.directories.map((d) => d.name)).toEqual(['alpha', 'middle', 'zebra']);
    });

    it('should mark inaccessible directories', async () => {
      const mockEntries = [
        { name: 'accessible', isDirectory: () => true },
        { name: 'restricted', isDirectory: () => true },
      ];

      (fs.readdir as jest.Mock).mockResolvedValue(mockEntries);
      (fs.stat as jest.Mock)
        .mockResolvedValueOnce({}) // accessible
        .mockRejectedValueOnce(new Error('Permission denied')); // restricted

      const result = await service.listDirectories('/test');

      expect(result.directories[0].isAccessible).toBe(true);
      expect(result.directories[1].isAccessible).toBe(false);
    });

    it('should return parent path for non-root paths', async () => {
      (fs.readdir as jest.Mock).mockResolvedValue([]);

      const result = await service.listDirectories('/media/movies');

      expect(result.parentPath).toBe('/media');
    });

    it('should return null parent for root path', async () => {
      (fs.readdir as jest.Mock).mockResolvedValue([]);

      const result = await service.listDirectories('/');

      expect(result.parentPath).toBeNull();
    });

    it('should exclude hidden directories', async () => {
      const mockEntries = [
        { name: '.config', isDirectory: () => true },
        { name: '.cache', isDirectory: () => true },
        { name: 'visible', isDirectory: () => true },
      ];

      (fs.readdir as jest.Mock).mockResolvedValue(mockEntries);
      (fs.stat as jest.Mock).mockResolvedValue({});

      const result = await service.listDirectories('/home');

      expect(result.directories).toHaveLength(1);
      expect(result.directories[0].name).toBe('visible');
    });

    it('should throw on read error', async () => {
      (fs.readdir as jest.Mock).mockRejectedValue(new Error('ENOENT'));

      await expect(service.listDirectories('/nonexistent')).rejects.toThrow();
    });
  });

  describe('sanitizePath (private)', () => {
    it('should reject null bytes', async () => {
      (fs.readdir as jest.Mock).mockResolvedValue([]);

      await expect(service.listDirectories('/test\0path')).rejects.toThrow(BadRequestException);
    });

    it('should block sensitive system directories', async () => {
      (fs.readdir as jest.Mock).mockResolvedValue([]);

      await expect(service.listDirectories('/etc/shadow')).rejects.toThrow(BadRequestException);
      await expect(service.listDirectories('/etc/passwd')).rejects.toThrow(BadRequestException);
      await expect(service.listDirectories('/root/.ssh')).rejects.toThrow(BadRequestException);
    });

    it('should normalize path with double slashes', async () => {
      (fs.readdir as jest.Mock).mockResolvedValue([]);

      const result = await service.listDirectories('/media//movies');

      expect(result.currentPath).toBe('/media/movies');
    });

    it('should handle empty path as root', async () => {
      (fs.readdir as jest.Mock).mockResolvedValue([]);

      // Empty path normalizes to cwd, which should still work
      await expect(service.listDirectories('')).resolves.toBeDefined();
    });
  });
});
