import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../../../prisma/prisma.service';
import { FileFailureTrackingService } from '../../file-failure-tracking.service';

describe('FileFailureTrackingService', () => {
  let service: FileFailureTrackingService;
  let prisma: {
    $queryRaw: jest.Mock;
    $executeRaw: jest.Mock;
    fileFailureRecord: {
      findFirst: jest.Mock;
      findMany: jest.Mock;
      findUnique: jest.Mock;
      updateMany: jest.Mock;
    };
  };

  beforeEach(async () => {
    prisma = {
      $queryRaw: jest.fn(),
      $executeRaw: jest.fn(),
      fileFailureRecord: {
        findFirst: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn(),
        updateMany: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [FileFailureTrackingService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get<FileFailureTrackingService>(FileFailureTrackingService);

    jest.spyOn((service as any).logger, 'log').mockImplementation();
    jest.spyOn((service as any).logger, 'warn').mockImplementation();
    jest.spyOn((service as any).logger, 'debug').mockImplementation();
    jest.spyOn((service as any).logger, 'error').mockImplementation();
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  describe('recordFailure', () => {
    const filePath = '/mnt/user/media/Movies/Test.mkv';
    const libraryId = 'lib-1';

    it('should record first failure with totalFailures=1 and return false', async () => {
      prisma.$queryRaw.mockResolvedValue([
        { id: 'record-1', totalFailures: 1, autoBlacklisted: false },
      ]);

      const result = await service.recordFailure(filePath, libraryId, 'encode error');

      expect(result).toBe(false);
      expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    });

    it('should increment failure count on subsequent calls and return false when below threshold', async () => {
      prisma.$queryRaw.mockResolvedValue([
        { id: 'record-1', totalFailures: 3, autoBlacklisted: false },
      ]);

      const result = await service.recordFailure(filePath, libraryId, 'encode error');

      expect(result).toBe(false);
    });

    it('should return true when threshold (5) is reached and autoBlacklisted is set', async () => {
      prisma.$queryRaw.mockResolvedValue([
        { id: 'record-1', totalFailures: 5, autoBlacklisted: true },
      ]);

      const result = await service.recordFailure(filePath, libraryId, 'encode error');

      expect(result).toBe(true);
      expect((service as any).logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Auto-blacklisted file after 5 failures')
      );
    });

    it('should return true when failures exceed threshold', async () => {
      prisma.$queryRaw.mockResolvedValue([
        { id: 'record-1', totalFailures: 7, autoBlacklisted: true },
      ]);

      const result = await service.recordFailure(filePath, libraryId, 'encode error');

      expect(result).toBe(true);
    });

    it('should handle contentFingerprint parameter', async () => {
      prisma.$queryRaw.mockResolvedValue([
        { id: 'record-1', totalFailures: 1, autoBlacklisted: false },
      ]);

      const result = await service.recordFailure(
        filePath,
        libraryId,
        'encode error',
        'fingerprint-abc123'
      );

      expect(result).toBe(false);
      expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    });

    it('should handle null error parameter', async () => {
      prisma.$queryRaw.mockResolvedValue([
        { id: 'record-1', totalFailures: 1, autoBlacklisted: false },
      ]);

      const result = await service.recordFailure(filePath, libraryId);

      expect(result).toBe(false);
      expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    });

    it('should return false when query returns empty array', async () => {
      prisma.$queryRaw.mockResolvedValue([]);

      const result = await service.recordFailure(filePath, libraryId, 'error');

      expect(result).toBe(false);
    });
  });

  describe('isBlacklisted', () => {
    const filePath = '/mnt/user/media/Movies/Test.mkv';
    const libraryId = 'lib-1';

    it('should return false when no record exists', async () => {
      prisma.fileFailureRecord.findFirst.mockResolvedValue(null);

      const result = await service.isBlacklisted(filePath, libraryId);

      expect(result).toBe(false);
      expect(prisma.fileFailureRecord.findFirst).toHaveBeenCalledWith({
        where: {
          autoBlacklisted: true,
          OR: [{ filePath, libraryId }],
        },
        select: { id: true },
      });
    });

    it('should return false when record exists but not blacklisted', async () => {
      prisma.fileFailureRecord.findFirst.mockResolvedValue(null);

      const result = await service.isBlacklisted(filePath, libraryId);

      expect(result).toBe(false);
    });

    it('should return true when blacklisted by path', async () => {
      prisma.fileFailureRecord.findFirst.mockResolvedValue({ id: 'record-1' });

      const result = await service.isBlacklisted(filePath, libraryId);

      expect(result).toBe(true);
    });

    it('should return true when blacklisted by contentFingerprint', async () => {
      prisma.fileFailureRecord.findFirst.mockResolvedValue({ id: 'record-1' });

      const result = await service.isBlacklisted(filePath, libraryId, 'fingerprint-abc123');

      expect(result).toBe(true);
      expect(prisma.fileFailureRecord.findFirst).toHaveBeenCalledWith({
        where: {
          autoBlacklisted: true,
          OR: [{ filePath, libraryId }, { contentFingerprint: 'fingerprint-abc123' }],
        },
        select: { id: true },
      });
    });

    it('should return false when contentFingerprint not provided and path not blacklisted', async () => {
      prisma.fileFailureRecord.findFirst.mockResolvedValue(null);

      const result = await service.isBlacklisted(filePath, libraryId);

      expect(result).toBe(false);
      expect(prisma.fileFailureRecord.findFirst).toHaveBeenCalledWith({
        where: {
          autoBlacklisted: true,
          OR: [{ filePath, libraryId }],
        },
        select: { id: true },
      });
    });
  });

  describe('getBlacklistedPaths', () => {
    const libraryId = 'lib-1';

    it('should return empty set for empty input', async () => {
      const result = await service.getBlacklistedPaths([], libraryId);

      expect(result).toEqual(new Set());
      expect(prisma.fileFailureRecord.findMany).not.toHaveBeenCalled();
    });

    it('should return set of blacklisted paths', async () => {
      const paths = ['/path/a.mkv', '/path/b.mkv', '/path/c.mkv'];
      prisma.fileFailureRecord.findMany.mockResolvedValue([
        { filePath: '/path/a.mkv' },
        { filePath: '/path/c.mkv' },
      ]);

      const result = await service.getBlacklistedPaths(paths, libraryId);

      expect(result).toEqual(new Set(['/path/a.mkv', '/path/c.mkv']));
      expect(result.has('/path/b.mkv')).toBe(false);
    });

    it('should filter by libraryId', async () => {
      const paths = ['/path/a.mkv'];
      prisma.fileFailureRecord.findMany.mockResolvedValue([{ filePath: '/path/a.mkv' }]);

      await service.getBlacklistedPaths(paths, libraryId);

      expect(prisma.fileFailureRecord.findMany).toHaveBeenCalledWith({
        where: {
          libraryId,
          autoBlacklisted: true,
          filePath: { in: paths },
        },
        select: { filePath: true },
      });
    });
  });

  describe('clearBlacklist', () => {
    const filePath = '/mnt/user/media/Movies/Test.mkv';
    const libraryId = 'lib-1';

    it('should reset totalFailures and autoBlacklisted', async () => {
      prisma.fileFailureRecord.updateMany.mockResolvedValue({ count: 1 });

      await service.clearBlacklist(filePath, libraryId);

      expect(prisma.fileFailureRecord.updateMany).toHaveBeenCalledWith({
        where: { filePath, libraryId },
        data: { totalFailures: 0, autoBlacklisted: false },
      });
    });

    it('should log the clear action', async () => {
      prisma.fileFailureRecord.updateMany.mockResolvedValue({ count: 1 });

      await service.clearBlacklist(filePath, libraryId);

      expect((service as any).logger.log).toHaveBeenCalledWith(
        `Cleared failure record for: ${filePath}`
      );
    });
  });

  describe('getFailureCount', () => {
    const filePath = '/mnt/user/media/Movies/Test.mkv';
    const libraryId = 'lib-1';

    it('should return 0 when no record exists', async () => {
      prisma.fileFailureRecord.findUnique.mockResolvedValue(null);

      const result = await service.getFailureCount(filePath, libraryId);

      expect(result).toBe(0);
      expect(prisma.fileFailureRecord.findUnique).toHaveBeenCalledWith({
        where: { filePath_libraryId: { filePath, libraryId } },
        select: { totalFailures: true },
      });
    });

    it('should return correct count when record exists', async () => {
      prisma.fileFailureRecord.findUnique.mockResolvedValue({ totalFailures: 3 });

      const result = await service.getFailureCount(filePath, libraryId);

      expect(result).toBe(3);
    });
  });
});
