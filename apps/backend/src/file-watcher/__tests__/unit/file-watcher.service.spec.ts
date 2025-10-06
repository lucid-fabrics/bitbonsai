import { EventEmitter2 } from '@nestjs/event-emitter';
import { Test, TestingModule } from '@nestjs/testing';
import type { Library } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { FileWatcherService } from '../../file-watcher.service';

describe('FileWatcherService', () => {
  let service: FileWatcherService;
  let prisma: PrismaService;
  let eventEmitter: EventEmitter2;

  const mockLibrary: Library = {
    id: 'test-lib-1',
    name: 'Test Library',
    path: '/media/test',
    nodeId: 'test-node-1',
    enabled: true,
    watchEnabled: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FileWatcherService,
        {
          provide: PrismaService,
          useValue: {
            library: {
              findMany: jest.fn(),
              findUnique: jest.fn(),
              update: jest.fn(),
            },
          },
        },
        {
          provide: EventEmitter2,
          useValue: {
            emit: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<FileWatcherService>(FileWatcherService);
    prisma = module.get<PrismaService>(PrismaService);
    eventEmitter = module.get<EventEmitter2>(EventEmitter2);
  });

  afterEach(async () => {
    await service.onModuleDestroy();
  });

  describe('onModuleInit', () => {
    it('should initialize watchers for enabled libraries', async () => {
      jest.spyOn(prisma.library, 'findMany').mockResolvedValue([mockLibrary]);
      const startWatcherSpy = jest.spyOn(service, 'startWatcher');

      await service.onModuleInit();

      expect(prisma.library.findMany).toHaveBeenCalledWith({
        where: {
          enabled: true,
          watchEnabled: true,
        },
        include: {
          node: true,
        },
      });
      expect(startWatcherSpy).toHaveBeenCalledWith(mockLibrary.id, mockLibrary.path);
    });

    it('should start 0 watchers when no libraries have watchEnabled=true', async () => {
      jest.spyOn(prisma.library, 'findMany').mockResolvedValue([]);

      await service.onModuleInit();

      expect(prisma.library.findMany).toHaveBeenCalled();
      expect(service.getAllWatcherStatuses()).toHaveLength(0);
    });

    it('should not fail if findMany throws error', async () => {
      jest.spyOn(prisma.library, 'findMany').mockRejectedValue(new Error('DB error'));

      await expect(service.onModuleInit()).resolves.not.toThrow();
    });
  });

  describe('enableWatcher', () => {
    it('should enable watcher and update database', async () => {
      jest.spyOn(prisma.library, 'findUnique').mockResolvedValue(mockLibrary);
      jest.spyOn(prisma.library, 'update').mockResolvedValue(mockLibrary);
      const startWatcherSpy = jest.spyOn(service, 'startWatcher').mockResolvedValue();

      await service.enableWatcher(mockLibrary.id);

      expect(prisma.library.update).toHaveBeenCalledWith({
        where: { id: mockLibrary.id },
        data: { watchEnabled: true },
      });
      expect(startWatcherSpy).toHaveBeenCalledWith(mockLibrary.id, mockLibrary.path);
    });

    it('should throw error if library not found', async () => {
      jest.spyOn(prisma.library, 'findUnique').mockResolvedValue(null);

      await expect(service.enableWatcher('invalid-id')).rejects.toThrow(
        'Library invalid-id not found'
      );
    });

    it('should throw error if library is disabled', async () => {
      const disabledLibrary = { ...mockLibrary, enabled: false };
      jest.spyOn(prisma.library, 'findUnique').mockResolvedValue(disabledLibrary);

      await expect(service.enableWatcher(mockLibrary.id)).rejects.toThrow(
        `Library ${mockLibrary.id} is disabled`
      );
    });
  });

  describe('disableWatcher', () => {
    it('should disable watcher and update database', async () => {
      jest.spyOn(prisma.library, 'update').mockResolvedValue(mockLibrary);
      const stopWatcherSpy = jest.spyOn(service, 'stopWatcher').mockResolvedValue();

      await service.disableWatcher(mockLibrary.id);

      expect(prisma.library.update).toHaveBeenCalledWith({
        where: { id: mockLibrary.id },
        data: { watchEnabled: false },
      });
      expect(stopWatcherSpy).toHaveBeenCalledWith(mockLibrary.id);
    });
  });

  describe('getWatcherStatus', () => {
    it('should return inactive status for non-existent watcher', () => {
      const status = service.getWatcherStatus('non-existent');

      expect(status).toEqual({
        active: false,
        path: undefined,
      });
    });
  });

  describe('getAllWatcherStatuses', () => {
    it('should return empty array when no watchers active', () => {
      const statuses = service.getAllWatcherStatuses();

      expect(statuses).toEqual([]);
    });
  });

  describe('video file extension filtering', () => {
    it('should support all major video formats', () => {
      const supportedExtensions = [
        '.mkv',
        '.mp4',
        '.avi',
        '.mov',
        '.wmv',
        '.flv',
        '.webm',
        '.m4v',
        '.mpg',
        '.mpeg',
        '.m2ts',
        '.ts',
      ];

      // This test verifies that the service's videoExtensions Set includes all expected formats
      // Access private property for testing (this is a white-box test)
      const service = new FileWatcherService(prisma, eventEmitter);
      const videoExtensions = (service as any).videoExtensions;

      supportedExtensions.forEach((ext) => {
        expect(videoExtensions.has(ext)).toBe(true);
      });
    });
  });
});
