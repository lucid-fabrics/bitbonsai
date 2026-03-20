import { Test, type TestingModule } from '@nestjs/testing';
import { FileFailureRecordRepository } from '../../../../common/repositories/file-failure-record.repository';
import { PrismaService } from '../../../../prisma/prisma.service';
import { FileFailureTrackingService } from '../../file-failure-tracking.service';

describe('FileFailureTrackingService', () => {
  let service: FileFailureTrackingService;
  let prisma: {
    $queryRaw: jest.Mock;
    $executeRaw: jest.Mock;
  };
  let fileFailureRecordRepository: {
    isBlacklisted: jest.Mock;
    getBlacklistedPaths: jest.Mock;
    clearBlacklist: jest.Mock;
    getFailureCount: jest.Mock;
  };

  beforeEach(async () => {
    prisma = {
      $queryRaw: jest.fn(),
      $executeRaw: jest.fn(),
    };

    fileFailureRecordRepository = {
      isBlacklisted: jest.fn().mockResolvedValue(false),
      getBlacklistedPaths: jest.fn().mockResolvedValue(new Set()),
      clearBlacklist: jest.fn().mockResolvedValue(undefined),
      getFailureCount: jest.fn().mockResolvedValue(0),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FileFailureTrackingService,
        { provide: PrismaService, useValue: prisma },
        { provide: FileFailureRecordRepository, useValue: fileFailureRecordRepository },
      ],
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

    it('should return false when autoBlacklisted is true but totalFailures below threshold', async () => {
      prisma.$queryRaw.mockResolvedValue([
        { id: 'record-1', totalFailures: 3, autoBlacklisted: true },
      ]);

      const result = await service.recordFailure(filePath, libraryId, 'error');

      expect(result).toBe(false);
    });
  });

  describe('isBlacklisted', () => {
    const filePath = '/mnt/user/media/Movies/Test.mkv';
    const libraryId = 'lib-1';

    it('should return false when no record exists', async () => {
      fileFailureRecordRepository.isBlacklisted.mockResolvedValue(false);

      const result = await service.isBlacklisted(filePath, libraryId);

      expect(result).toBe(false);
      expect(fileFailureRecordRepository.isBlacklisted).toHaveBeenCalledWith(
        filePath,
        libraryId,
        undefined
      );
    });

    it('should return true when blacklisted by path', async () => {
      fileFailureRecordRepository.isBlacklisted.mockResolvedValue(true);

      const result = await service.isBlacklisted(filePath, libraryId);

      expect(result).toBe(true);
    });

    it('should return true when blacklisted by contentFingerprint', async () => {
      fileFailureRecordRepository.isBlacklisted.mockResolvedValue(true);

      const result = await service.isBlacklisted(filePath, libraryId, 'fingerprint-abc123');

      expect(result).toBe(true);
      expect(fileFailureRecordRepository.isBlacklisted).toHaveBeenCalledWith(
        filePath,
        libraryId,
        'fingerprint-abc123'
      );
    });

    it('should return false when contentFingerprint not provided and path not blacklisted', async () => {
      fileFailureRecordRepository.isBlacklisted.mockResolvedValue(false);

      const result = await service.isBlacklisted(filePath, libraryId);

      expect(result).toBe(false);
    });
  });

  describe('getBlacklistedPaths', () => {
    const libraryId = 'lib-1';

    it('should return empty set for empty input', async () => {
      fileFailureRecordRepository.getBlacklistedPaths.mockResolvedValue(new Set());

      const result = await service.getBlacklistedPaths([], libraryId);

      expect(result).toEqual(new Set());
      expect(fileFailureRecordRepository.getBlacklistedPaths).toHaveBeenCalledWith([], libraryId);
    });

    it('should return set of blacklisted paths', async () => {
      const paths = ['/path/a.mkv', '/path/b.mkv', '/path/c.mkv'];
      fileFailureRecordRepository.getBlacklistedPaths.mockResolvedValue(
        new Set(['/path/a.mkv', '/path/c.mkv'])
      );

      const result = await service.getBlacklistedPaths(paths, libraryId);

      expect(result).toEqual(new Set(['/path/a.mkv', '/path/c.mkv']));
      expect(result.has('/path/b.mkv')).toBe(false);
    });

    it('should delegate to repository with correct arguments', async () => {
      const paths = ['/path/a.mkv'];
      fileFailureRecordRepository.getBlacklistedPaths.mockResolvedValue(new Set(['/path/a.mkv']));

      await service.getBlacklistedPaths(paths, libraryId);

      expect(fileFailureRecordRepository.getBlacklistedPaths).toHaveBeenCalledWith(
        paths,
        libraryId
      );
    });
  });

  describe('clearBlacklist', () => {
    const filePath = '/mnt/user/media/Movies/Test.mkv';
    const libraryId = 'lib-1';

    it('should delegate to repository', async () => {
      await service.clearBlacklist(filePath, libraryId);

      expect(fileFailureRecordRepository.clearBlacklist).toHaveBeenCalledWith(filePath, libraryId);
    });

    it('should log the clear action', async () => {
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
      fileFailureRecordRepository.getFailureCount.mockResolvedValue(0);

      const result = await service.getFailureCount(filePath, libraryId);

      expect(result).toBe(0);
      expect(fileFailureRecordRepository.getFailureCount).toHaveBeenCalledWith(filePath, libraryId);
    });

    it('should return correct count when record exists', async () => {
      fileFailureRecordRepository.getFailureCount.mockResolvedValue(3);

      const result = await service.getFailureCount(filePath, libraryId);

      expect(result).toBe(3);
    });
  });
});
