import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../../prisma/prisma.service';
import { BackupCleanupWorker } from '../../backup-cleanup.worker';

// Mock fs
jest.mock('node:fs', () => ({
  existsSync: jest.fn(),
  promises: {
    readdir: jest.fn(),
    stat: jest.fn(),
    unlink: jest.fn(),
  },
}));

import { existsSync, promises as fsMock } from 'node:fs';

describe('BackupCleanupWorker', () => {
  let worker: BackupCleanupWorker;

  const mockPrismaService = {
    library: {
      findMany: jest.fn(),
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [BackupCleanupWorker, { provide: PrismaService, useValue: mockPrismaService }],
    }).compile();

    worker = module.get<BackupCleanupWorker>(BackupCleanupWorker);
  });

  it('should be defined', () => {
    expect(worker).toBeDefined();
  });

  describe('onModuleInit', () => {
    it('should call start', async () => {
      // Mock start to prevent infinite loop
      const startSpy = jest.spyOn(worker as any, 'start').mockImplementation(() => {});

      await worker.onModuleInit();

      expect(startSpy).toHaveBeenCalled();
    });
  });

  describe('stop', () => {
    it('should set isRunning to false', async () => {
      await worker.stop();

      expect((worker as any).isRunning).toBe(false);
    });
  });

  describe('cleanupOrphanedBackups (private, tested via reflection)', () => {
    it('should skip when no enabled libraries', async () => {
      mockPrismaService.library.findMany.mockResolvedValue([]);

      await (worker as any).cleanupOrphanedBackups();

      expect(existsSync).not.toHaveBeenCalled();
    });

    it('should skip when library path does not exist', async () => {
      mockPrismaService.library.findMany.mockResolvedValue([
        { id: 'l1', name: 'Movies', path: '/media/movies' },
      ]);
      (existsSync as jest.Mock).mockReturnValue(false);

      await (worker as any).cleanupOrphanedBackups();

      expect(fsMock.readdir).not.toHaveBeenCalled();
    });

    it('should delete old backup files', async () => {
      mockPrismaService.library.findMany.mockResolvedValue([
        { id: 'l1', name: 'Movies', path: '/media/movies' },
      ]);
      (existsSync as jest.Mock).mockReturnValue(true);

      const oldTime = Date.now() - 48 * 60 * 60 * 1000; // 48 hours ago
      (fsMock.readdir as jest.Mock).mockResolvedValue([
        { name: 'movie.mkv.backup', isFile: () => true, isDirectory: () => false },
      ]);
      (fsMock.stat as jest.Mock).mockResolvedValue({
        mtimeMs: oldTime,
        size: 1024 * 1024 * 100, // 100MB
      });
      (fsMock.unlink as jest.Mock).mockResolvedValue(undefined);

      await (worker as any).cleanupOrphanedBackups();

      expect(fsMock.unlink).toHaveBeenCalledWith('/media/movies/movie.mkv.backup');
    });

    it('should skip recent backup files', async () => {
      mockPrismaService.library.findMany.mockResolvedValue([
        { id: 'l1', name: 'Movies', path: '/media/movies' },
      ]);
      (existsSync as jest.Mock).mockReturnValue(true);

      (fsMock.readdir as jest.Mock).mockResolvedValue([
        { name: 'recent.mkv.backup', isFile: () => true, isDirectory: () => false },
      ]);
      (fsMock.stat as jest.Mock).mockResolvedValue({
        mtimeMs: Date.now() - 1000, // 1 second ago
        size: 1024,
      });

      await (worker as any).cleanupOrphanedBackups();

      expect(fsMock.unlink).not.toHaveBeenCalled();
    });

    it('should skip non-backup files', async () => {
      mockPrismaService.library.findMany.mockResolvedValue([
        { id: 'l1', name: 'Movies', path: '/media/movies' },
      ]);
      (existsSync as jest.Mock).mockReturnValue(true);

      (fsMock.readdir as jest.Mock).mockResolvedValue([
        { name: 'movie.mkv', isFile: () => true, isDirectory: () => false },
        { name: 'poster.jpg', isFile: () => true, isDirectory: () => false },
      ]);

      await (worker as any).cleanupOrphanedBackups();

      expect(fsMock.stat).not.toHaveBeenCalled();
      expect(fsMock.unlink).not.toHaveBeenCalled();
    });

    it('should recurse into subdirectories', async () => {
      mockPrismaService.library.findMany.mockResolvedValue([
        { id: 'l1', name: 'Movies', path: '/media/movies' },
      ]);
      (existsSync as jest.Mock).mockReturnValue(true);

      (fsMock.readdir as jest.Mock)
        .mockResolvedValueOnce([
          { name: 'subfolder', isFile: () => false, isDirectory: () => true },
        ])
        .mockResolvedValueOnce([
          { name: 'deep.mkv.backup', isFile: () => true, isDirectory: () => false },
        ]);

      const oldTime = Date.now() - 48 * 60 * 60 * 1000;
      (fsMock.stat as jest.Mock).mockResolvedValue({ mtimeMs: oldTime, size: 500 });
      (fsMock.unlink as jest.Mock).mockResolvedValue(undefined);

      await (worker as any).cleanupOrphanedBackups();

      expect(fsMock.unlink).toHaveBeenCalledWith('/media/movies/subfolder/deep.mkv.backup');
    });

    it('should continue on individual file errors', async () => {
      mockPrismaService.library.findMany.mockResolvedValue([
        { id: 'l1', name: 'Movies', path: '/media/movies' },
      ]);
      (existsSync as jest.Mock).mockReturnValue(true);

      (fsMock.readdir as jest.Mock).mockResolvedValue([
        { name: 'bad.mkv.backup', isFile: () => true, isDirectory: () => false },
        { name: 'good.mkv.backup', isFile: () => true, isDirectory: () => false },
      ]);

      const oldTime = Date.now() - 48 * 60 * 60 * 1000;
      (fsMock.stat as jest.Mock)
        .mockRejectedValueOnce(new Error('Permission denied'))
        .mockResolvedValueOnce({ mtimeMs: oldTime, size: 500 });
      (fsMock.unlink as jest.Mock).mockResolvedValue(undefined);

      await (worker as any).cleanupOrphanedBackups();

      // Should still process the second file
      expect(fsMock.unlink).toHaveBeenCalledTimes(1);
    });
  });
});
