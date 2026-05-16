import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { EventEmitter2, EventEmitterModule } from '@nestjs/event-emitter';
import { Test, TestingModule } from '@nestjs/testing';
import type { Library } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { FileWatcherService } from '../../file-watcher.service';

describe('FileWatcherService (Integration)', () => {
  let service: FileWatcherService;
  let prisma: PrismaService;
  let eventEmitter: EventEmitter2;
  let testDir: string;

  beforeAll(async () => {
    // Create a temporary directory for testing
    testDir = join(__dirname, '../../../../__test-watch-dir__');
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
    mkdirSync(testDir, { recursive: true });
  });

  afterAll(async () => {
    // Cleanup test directory
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [EventEmitterModule.forRoot()],
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
      ],
    }).compile();

    service = module.get<FileWatcherService>(FileWatcherService);
    prisma = module.get<PrismaService>(PrismaService);
    eventEmitter = module.get<EventEmitter2>(EventEmitter2);
  });

  afterEach(async () => {
    await service.onModuleDestroy();
  });

  describe('real file watching', () => {
    it('should detect new video file and emit event', async () => {
      const libraryId = 'test-lib-watch';
      const mockLibrary: Library = {
        id: libraryId,
        name: 'Test Watch Library',
        path: testDir,
        mediaType: 'MOVIE',
        nodeId: 'test-node',
        enabled: true,
        watchEnabled: true,
        lastScanAt: null,
        totalFiles: 0,
        totalSizeBytes: BigInt(0),
        defaultPolicyId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      jest.spyOn(prisma.library, 'findUnique').mockResolvedValue(mockLibrary);
      jest.spyOn(prisma.library, 'update').mockResolvedValue(mockLibrary);

      const emitSpy = jest.spyOn(eventEmitter, 'emit');

      // Start watcher
      await service.startWatcher(libraryId, testDir);

      // Wait for watcher to initialize
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Create a video file
      const videoPath = join(testDir, 'test-video.mp4');
      writeFileSync(videoPath, 'fake video content');

      // Wait for debounce (5 seconds) + processing time
      await new Promise((resolve) => setTimeout(resolve, 7000));

      // Verify event was emitted
      expect(emitSpy).toHaveBeenCalledWith('file.detected', {
        libraryId,
        filePath: videoPath,
        fileName: 'test-video.mp4',
      });

      // Cleanup
      rmSync(videoPath, { force: true });
    });

    it('should ignore non-video files', async () => {
      const libraryId = 'test-lib-ignore';
      const mockLibrary: Library = {
        id: libraryId,
        name: 'Test Ignore Library',
        path: testDir,
        mediaType: 'MOVIE',
        nodeId: 'test-node',
        enabled: true,
        watchEnabled: true,
        lastScanAt: null,
        totalFiles: 0,
        totalSizeBytes: BigInt(0),
        defaultPolicyId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      jest.spyOn(prisma.library, 'findUnique').mockResolvedValue(mockLibrary);
      jest.spyOn(prisma.library, 'update').mockResolvedValue(mockLibrary);

      const emitSpy = jest.spyOn(eventEmitter, 'emit');
      const _emitCallsBefore = emitSpy.mock.calls.length;

      // Start watcher
      await service.startWatcher(libraryId, testDir);

      // Wait for watcher to initialize
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Create a non-video file
      const textPath = join(testDir, 'readme.txt');
      writeFileSync(textPath, 'not a video');

      // Wait for debounce + processing
      await new Promise((resolve) => setTimeout(resolve, 7000));

      // Verify NO event was emitted for non-video file
      const emitCallsAfter = emitSpy.mock.calls.filter(
        (call) => call[0] === 'file.detected' && call[1].fileName === 'readme.txt'
      ).length;
      expect(emitCallsAfter).toBe(0);

      // Cleanup
      rmSync(textPath, { force: true });
    });

    it('should handle multiple files in subdirectories', async () => {
      const libraryId = 'test-lib-subdir';
      const mockLibrary: Library = {
        id: libraryId,
        name: 'Test Subdir Library',
        path: testDir,
        mediaType: 'MOVIE',
        nodeId: 'test-node',
        enabled: true,
        watchEnabled: true,
        lastScanAt: null,
        totalFiles: 0,
        totalSizeBytes: BigInt(0),
        defaultPolicyId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      jest.spyOn(prisma.library, 'findUnique').mockResolvedValue(mockLibrary);
      jest.spyOn(prisma.library, 'update').mockResolvedValue(mockLibrary);

      const emitSpy = jest.spyOn(eventEmitter, 'emit');

      // Start watcher
      await service.startWatcher(libraryId, testDir);

      // Wait for watcher to initialize
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Create subdirectory and video file
      const subdir = join(testDir, 'Season 1');
      mkdirSync(subdir, { recursive: true });
      const videoPath = join(subdir, 'episode1.mkv');
      writeFileSync(videoPath, 'fake mkv content');

      // Wait for debounce + processing
      await new Promise((resolve) => setTimeout(resolve, 7000));

      // Verify event was emitted for subdirectory file
      const fileDetectedCalls = emitSpy.mock.calls.filter(
        (call) => call[0] === 'file.detected' && call[1].fileName === 'episode1.mkv'
      );
      expect(fileDetectedCalls.length).toBeGreaterThan(0);

      // Cleanup
      rmSync(subdir, { recursive: true, force: true });
    });
  });

  describe('watcher lifecycle', () => {
    it('should properly stop watcher', async () => {
      const libraryId = 'test-lib-stop';

      await service.startWatcher(libraryId, testDir);
      expect(service.getWatcherStatus(libraryId).active).toBe(true);

      await service.stopWatcher(libraryId);
      expect(service.getWatcherStatus(libraryId).active).toBe(false);
    });

    it('should not create duplicate watchers for same library', async () => {
      const libraryId = 'test-lib-duplicate';

      await service.startWatcher(libraryId, testDir);
      const statusesBefore = service.getAllWatcherStatuses();

      // Try to start again
      await service.startWatcher(libraryId, testDir);
      const statusesAfter = service.getAllWatcherStatuses();

      expect(statusesAfter.length).toBe(statusesBefore.length);
    });
  });
});
