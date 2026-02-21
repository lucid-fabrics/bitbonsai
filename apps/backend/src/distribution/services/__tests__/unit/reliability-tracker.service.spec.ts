import { Test, type TestingModule } from '@nestjs/testing';
import type { Job, JobStage } from '@prisma/client';
import { PrismaService } from '../../../../prisma/prisma.service';
import { createMockPrismaService } from '../../../../testing/mock-providers';
import { ReliabilityTrackerService } from '../../reliability-tracker.service';

describe('ReliabilityTrackerService', () => {
  let service: ReliabilityTrackerService;
  let prisma: ReturnType<typeof createMockPrismaService>;

  beforeEach(async () => {
    prisma = createMockPrismaService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [ReliabilityTrackerService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get<ReliabilityTrackerService>(ReliabilityTrackerService);

    jest.spyOn((service as any).logger, 'log').mockImplementation();
    jest.spyOn((service as any).logger, 'warn').mockImplementation();
    jest.spyOn((service as any).logger, 'debug').mockImplementation();
    jest.spyOn((service as any).logger, 'error').mockImplementation();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  const createMockJob = (overrides: Partial<Job> = {}): Job =>
    ({
      id: 'job-1',
      filePath: '/media/movie.mkv',
      fileLabel: 'movie.mkv',
      stage: 'ENCODING' as JobStage,
      progress: 50,
      beforeSizeBytes: BigInt(5 * 1024 * 1024 * 1024),
      ...overrides,
    }) as unknown as Job;

  describe('recordFailure', () => {
    it('should create a failure log entry and update node stats', async () => {
      prisma.nodeFailureLog.create.mockResolvedValue({});
      prisma.nodeFailureLog.count.mockResolvedValue(3);
      prisma.nodeFailureLog.findFirst.mockResolvedValue({ createdAt: new Date() });
      prisma.job.count.mockResolvedValue(10);
      prisma.node.update.mockResolvedValue({});

      const job = createMockJob();
      await service.recordFailure('node-1', job, 'FFmpeg crash', 'SIGKILL');

      expect(prisma.nodeFailureLog.create).toHaveBeenCalledWith({
        data: {
          nodeId: 'node-1',
          reason: 'FFmpeg crash',
          errorCode: 'SIGKILL',
          stage: 'ENCODING',
          progress: 50,
          jobId: 'job-1',
          filePath: '/media/movie.mkv',
          fileSize: BigInt(5 * 1024 * 1024 * 1024),
        },
      });
    });

    it('should handle missing errorCode', async () => {
      prisma.nodeFailureLog.create.mockResolvedValue({});
      prisma.nodeFailureLog.count.mockResolvedValue(1);
      prisma.nodeFailureLog.findFirst.mockResolvedValue({ createdAt: new Date() });
      prisma.job.count.mockResolvedValue(5);
      prisma.node.update.mockResolvedValue({});

      const job = createMockJob();
      await service.recordFailure('node-1', job, 'Disk full');

      expect(prisma.nodeFailureLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          errorCode: undefined,
        }),
      });
    });

    it('should handle database errors gracefully', async () => {
      prisma.nodeFailureLog.create.mockRejectedValue(new Error('DB error'));

      const job = createMockJob();
      await service.recordFailure('node-1', job, 'FFmpeg crash');

      expect((service as any).logger.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to record failure'),
        expect.any(Error)
      );
    });
  });

  describe('updateNodeFailureStats', () => {
    it('should calculate and update failure stats', async () => {
      prisma.nodeFailureLog.count.mockResolvedValue(5);
      prisma.nodeFailureLog.findFirst.mockResolvedValue({
        createdAt: new Date('2026-02-21T10:00:00Z'),
      });
      prisma.job.count.mockResolvedValue(20); // 20 completed jobs
      prisma.node.update.mockResolvedValue({});

      await service.updateNodeFailureStats('node-1');

      // Failure rate: 5 / (20 + 5) * 100 = 20%
      expect(prisma.node.update).toHaveBeenCalledWith({
        where: { id: 'node-1' },
        data: {
          recentFailureCount: 5,
          lastFailureAt: new Date('2026-02-21T10:00:00Z'),
          failureRate24h: 20,
        },
      });
    });

    it('should handle zero total jobs (0% failure rate)', async () => {
      prisma.nodeFailureLog.count.mockResolvedValue(0);
      prisma.nodeFailureLog.findFirst.mockResolvedValue(null);
      prisma.job.count.mockResolvedValue(0);
      prisma.node.update.mockResolvedValue({});

      await service.updateNodeFailureStats('node-1');

      expect(prisma.node.update).toHaveBeenCalledWith({
        where: { id: 'node-1' },
        data: {
          recentFailureCount: 0,
          lastFailureAt: null,
          failureRate24h: 0,
        },
      });
    });

    it('should handle 100% failure rate', async () => {
      prisma.nodeFailureLog.count.mockResolvedValue(5);
      prisma.nodeFailureLog.findFirst.mockResolvedValue({ createdAt: new Date() });
      prisma.job.count.mockResolvedValue(0); // No completed jobs
      prisma.node.update.mockResolvedValue({});

      await service.updateNodeFailureStats('node-1');

      // Rate: 5 / (0 + 5) * 100 = 100%
      expect(prisma.node.update).toHaveBeenCalledWith({
        where: { id: 'node-1' },
        data: expect.objectContaining({
          failureRate24h: 100,
        }),
      });
    });

    it('should round failure rate to 2 decimal places', async () => {
      prisma.nodeFailureLog.count.mockResolvedValue(1);
      prisma.nodeFailureLog.findFirst.mockResolvedValue({ createdAt: new Date() });
      prisma.job.count.mockResolvedValue(2); // 2 completed + 1 failed = 3 total
      prisma.node.update.mockResolvedValue({});

      await service.updateNodeFailureStats('node-1');

      // Rate: 1/3 * 100 = 33.333... -> rounded to 33.33
      expect(prisma.node.update).toHaveBeenCalledWith({
        where: { id: 'node-1' },
        data: expect.objectContaining({
          failureRate24h: 33.33,
        }),
      });
    });
  });

  describe('getFailureSummary', () => {
    it('should return summary with top reasons', async () => {
      const now = new Date('2026-02-21T12:00:00Z');
      prisma.nodeFailureLog.findMany.mockResolvedValue([
        { reason: 'FFmpeg crash', createdAt: new Date('2026-02-21T10:00:00Z') },
        { reason: 'FFmpeg crash', createdAt: new Date('2026-02-21T11:00:00Z') },
        { reason: 'Disk full', createdAt: now },
        { reason: 'FFmpeg crash', createdAt: new Date('2026-02-21T09:00:00Z') },
      ]);
      prisma.node.findUnique.mockResolvedValue({ failureRate24h: 25 });

      const result = await service.getFailureSummary('node-1');

      expect(result.count24h).toBe(4);
      expect(result.failureRate).toBe(25);
      expect(result.lastFailure).toEqual(now);
      expect(result.topReasons).toHaveLength(2);
      expect(result.topReasons[0]).toEqual({ reason: 'FFmpeg crash', count: 3 });
      expect(result.topReasons[1]).toEqual({ reason: 'Disk full', count: 1 });
    });

    it('should return empty summary for node with no failures', async () => {
      prisma.nodeFailureLog.findMany.mockResolvedValue([]);
      prisma.node.findUnique.mockResolvedValue({ failureRate24h: 0 });

      const result = await service.getFailureSummary('node-1');

      expect(result.count24h).toBe(0);
      expect(result.failureRate).toBe(0);
      expect(result.lastFailure).toBeNull();
      expect(result.topReasons).toHaveLength(0);
    });

    it('should limit top reasons to 5', async () => {
      const reasons = Array.from({ length: 8 }, (_, i) => ({
        reason: `Error type ${i}`,
        createdAt: new Date(),
      }));
      prisma.nodeFailureLog.findMany.mockResolvedValue(reasons);
      prisma.node.findUnique.mockResolvedValue({ failureRate24h: 50 });

      const result = await service.getFailureSummary('node-1');

      expect(result.topReasons.length).toBeLessThanOrEqual(5);
    });

    it('should handle null failureRate24h on node', async () => {
      prisma.nodeFailureLog.findMany.mockResolvedValue([]);
      prisma.node.findUnique.mockResolvedValue({ failureRate24h: null });

      const result = await service.getFailureSummary('node-1');

      expect(result.failureRate).toBe(0);
    });
  });

  describe('cleanupOldFailureLogs', () => {
    it('should delete failure logs older than 7 days', async () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-02-21T12:00:00Z'));

      prisma.nodeFailureLog.deleteMany.mockResolvedValue({ count: 15 });

      await service.cleanupOldFailureLogs();

      expect(prisma.nodeFailureLog.deleteMany).toHaveBeenCalledWith({
        where: {
          createdAt: {
            lt: expect.any(Date),
          },
        },
      });

      // Verify the cutoff date is 7 days ago
      const callArg = prisma.nodeFailureLog.deleteMany.mock.calls[0][0];
      const cutoffDate = callArg.where.createdAt.lt as Date;
      const sevenDaysAgo = new Date('2026-02-14T12:00:00Z');
      expect(cutoffDate.getTime()).toBe(sevenDaysAgo.getTime());

      jest.useRealTimers();
    });

    it('should not log when no old logs found', async () => {
      prisma.nodeFailureLog.deleteMany.mockResolvedValue({ count: 0 });

      await service.cleanupOldFailureLogs();

      expect((service as any).logger.log).not.toHaveBeenCalledWith(
        expect.stringContaining('Cleaned up')
      );
    });

    it('should handle database errors gracefully', async () => {
      prisma.nodeFailureLog.deleteMany.mockRejectedValue(new Error('DB error'));

      await service.cleanupOldFailureLogs();

      expect((service as any).logger.error).toHaveBeenCalledWith(
        'Failed to cleanup old failure logs',
        expect.any(Error)
      );
    });
  });

  describe('refreshAllNodeStats', () => {
    it('should refresh stats for all online nodes', async () => {
      prisma.node.findMany.mockResolvedValue([
        { id: 'node-1' },
        { id: 'node-2' },
        { id: 'node-3' },
      ]);

      // Mock updateNodeFailureStats dependencies for each node
      prisma.nodeFailureLog.count.mockResolvedValue(0);
      prisma.nodeFailureLog.findFirst.mockResolvedValue(null);
      prisma.job.count.mockResolvedValue(0);
      prisma.node.update.mockResolvedValue({});

      await service.refreshAllNodeStats();

      // Should update each node's stats
      expect(prisma.node.update).toHaveBeenCalledTimes(3);
    });

    it('should handle empty node list', async () => {
      prisma.node.findMany.mockResolvedValue([]);

      await service.refreshAllNodeStats();

      expect(prisma.node.update).not.toHaveBeenCalled();
    });
  });

  describe('isUnreliable', () => {
    it('should return true for 5+ failures', () => {
      expect(service.isUnreliable(5, 10)).toBe(true);
      expect(service.isUnreliable(10, 10)).toBe(true);
    });

    it('should return true for failure rate > 30%', () => {
      expect(service.isUnreliable(1, 31)).toBe(true);
      expect(service.isUnreliable(2, 50)).toBe(true);
    });

    it('should return false for low failure count and rate', () => {
      expect(service.isUnreliable(0, 0)).toBe(false);
      expect(service.isUnreliable(4, 20)).toBe(false);
      expect(service.isUnreliable(3, 30)).toBe(false);
    });

    it('should handle boundary values', () => {
      expect(service.isUnreliable(4, 30)).toBe(false); // Just under both thresholds
      expect(service.isUnreliable(5, 30)).toBe(true); // At count threshold
      expect(service.isUnreliable(4, 30.01)).toBe(true); // Just over rate threshold
    });
  });
});
