import { Test, type TestingModule } from '@nestjs/testing';
import { JobStage } from '@prisma/client';
import { NodeConfigService } from '../../../../core/services/node-config.service';
import { PrismaService } from '../../../../prisma/prisma.service';
import { createMockPrismaService } from '../../../../testing/mock-providers';
import { OwnershipLeaseService } from '../../ownership-lease.service';

const NODE_ID = 'test-node';

describe('OwnershipLeaseService', () => {
  let service: OwnershipLeaseService;
  let prisma: ReturnType<typeof createMockPrismaService>;
  let nodeConfig: jest.Mocked<Pick<NodeConfigService, 'isMainNode' | 'getNodeId'>>;

  beforeEach(async () => {
    prisma = createMockPrismaService();
    nodeConfig = {
      isMainNode: jest.fn().mockReturnValue(true),
      getNodeId: jest.fn().mockReturnValue(NODE_ID),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OwnershipLeaseService,
        { provide: PrismaService, useValue: prisma },
        { provide: NodeConfigService, useValue: nodeConfig },
      ],
    }).compile();

    service = module.get<OwnershipLeaseService>(OwnershipLeaseService);

    jest.spyOn((service as any).logger, 'log').mockImplementation();
    jest.spyOn((service as any).logger, 'warn').mockImplementation();
    jest.spyOn((service as any).logger, 'debug').mockImplementation();
    jest.spyOn((service as any).logger, 'error').mockImplementation();
  });

  afterEach(() => {
    // Stop all active renewal intervals to avoid leaking handles
    for (const jobId of (service as any).renewalMap.keys()) {
      service.stopRenewing(jobId as string);
    }
    jest.clearAllMocks();
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  // ──────────────────────────────────────────────────────────────────────────
  // onModuleInit
  // ──────────────────────────────────────────────────────────────────────────

  describe('onModuleInit', () => {
    it('should call reclaimExpiredLeases on MAIN node', async () => {
      const reclaimSpy = jest.spyOn(service, 'reclaimExpiredLeases').mockResolvedValue(0);
      nodeConfig.isMainNode.mockReturnValue(true);

      await service.onModuleInit();

      expect(reclaimSpy).toHaveBeenCalledTimes(1);
    });

    it('should skip reclaimExpiredLeases on LINKED node', async () => {
      const reclaimSpy = jest.spyOn(service, 'reclaimExpiredLeases').mockResolvedValue(0);
      nodeConfig.isMainNode.mockReturnValue(false);

      await service.onModuleInit();

      expect(reclaimSpy).not.toHaveBeenCalled();
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // renewLease
  // ──────────────────────────────────────────────────────────────────────────

  describe('renewLease', () => {
    it('should return true and extend expiry when lease is still valid (null expiry)', async () => {
      prisma.job.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.renewLease('job-1', NODE_ID);

      expect(result).toBe(true);
      expect(prisma.job.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: 'job-1',
            stage: JobStage.ENCODING,
          }),
          data: { ownershipLeaseExpiry: expect.any(Date) },
        })
      );
    });

    it('should return false when lease has already been reclaimed (0 rows updated)', async () => {
      prisma.job.updateMany.mockResolvedValue({ count: 0 });

      const result = await service.renewLease('job-1', NODE_ID);

      expect(result).toBe(false);
    });

    it('should return false and not throw when DB throws', async () => {
      prisma.job.updateMany.mockRejectedValue(new Error('DB error'));

      const result = await service.renewLease('job-1', NODE_ID);

      expect(result).toBe(false);
    });

    it('should set new expiry ~60 seconds ahead of now', async () => {
      const before = Date.now();
      prisma.job.updateMany.mockResolvedValue({ count: 1 });

      await service.renewLease('job-1', NODE_ID);

      const call = prisma.job.updateMany.mock.calls[0][0];
      const expiry: Date = call.data.ownershipLeaseExpiry;
      const after = Date.now();

      expect(expiry.getTime()).toBeGreaterThanOrEqual(before + 60_000);
      expect(expiry.getTime()).toBeLessThanOrEqual(after + 60_000 + 50); // 50 ms tolerance
    });

    it('should include OR clause allowing null or non-expired lease', async () => {
      prisma.job.updateMany.mockResolvedValue({ count: 1 });

      await service.renewLease('job-1', NODE_ID);

      const where = prisma.job.updateMany.mock.calls[0][0].where;
      expect(where).toHaveProperty('OR');
      expect(where.OR).toEqual(
        expect.arrayContaining([
          { ownershipLeaseExpiry: null },
          { ownershipLeaseExpiry: { gte: expect.any(Date) } },
        ])
      );
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // startRenewing / stopRenewing
  // ──────────────────────────────────────────────────────────────────────────

  describe('startRenewing', () => {
    beforeEach(() => jest.useFakeTimers());

    it('should register an interval in the renewal map', () => {
      prisma.job.updateMany.mockResolvedValue({ count: 1 });

      service.startRenewing('job-1', NODE_ID);

      expect((service as any).renewalMap.has('job-1')).toBe(true);
    });

    it('should not register a second interval if already renewing (idempotent)', () => {
      prisma.job.updateMany.mockResolvedValue({ count: 1 });

      service.startRenewing('job-1', NODE_ID);
      service.startRenewing('job-1', NODE_ID);

      expect((service as any).renewalMap.size).toBe(1);
      expect(prisma.job.updateMany).not.toHaveBeenCalled(); // no tick yet
    });

    it('should call renewLease after RENEWAL_INTERVAL_MS', async () => {
      prisma.job.updateMany.mockResolvedValue({ count: 1 });

      service.startRenewing('job-1', NODE_ID);
      await jest.advanceTimersByTimeAsync(30_000);

      expect(prisma.job.updateMany).toHaveBeenCalledTimes(1);
    });

    it('should stop renewing automatically when renewLease returns false', async () => {
      prisma.job.updateMany.mockResolvedValue({ count: 0 });

      service.startRenewing('job-1', NODE_ID);
      await jest.advanceTimersByTimeAsync(30_000);

      expect((service as any).renewalMap.has('job-1')).toBe(false);
    });
  });

  describe('stopRenewing', () => {
    beforeEach(() => jest.useFakeTimers());

    it('should clear the interval and remove from map', () => {
      prisma.job.updateMany.mockResolvedValue({ count: 1 });

      service.startRenewing('job-1', NODE_ID);
      service.stopRenewing('job-1');

      expect((service as any).renewalMap.has('job-1')).toBe(false);
    });

    it('should be a no-op when no renewal is running', () => {
      expect(() => service.stopRenewing('job-not-started')).not.toThrow();
    });

    it('should not call renewLease after stopRenewing', async () => {
      prisma.job.updateMany.mockResolvedValue({ count: 1 });

      service.startRenewing('job-1', NODE_ID);
      service.stopRenewing('job-1');
      await jest.advanceTimersByTimeAsync(30_000);

      expect(prisma.job.updateMany).not.toHaveBeenCalled();
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // reclaimExpiredLeases
  // ──────────────────────────────────────────────────────────────────────────

  describe('reclaimExpiredLeases', () => {
    it('should return 0 when no expired leases found', async () => {
      prisma.job.findMany.mockResolvedValue([]);

      const count = await service.reclaimExpiredLeases();

      expect(count).toBe(0);
      expect(prisma.job.updateMany).not.toHaveBeenCalled();
    });

    it('should query ENCODING jobs with ownershipLeaseExpiry in the past', async () => {
      prisma.job.findMany.mockResolvedValue([]);

      await service.reclaimExpiredLeases();

      expect(prisma.job.findMany).toHaveBeenCalledWith({
        where: {
          stage: JobStage.ENCODING,
          ownershipLeaseExpiry: { lt: expect.any(Date) },
        },
        select: {
          id: true,
          nodeId: true,
          ownershipEpoch: true,
          fileLabel: true,
        },
      });
    });

    it('should reset an expired job to QUEUED and return count 1', async () => {
      const expiredJob = {
        id: 'job-1',
        nodeId: 'dead-node',
        ownershipEpoch: 3,
        fileLabel: 'v.mkv',
      };
      prisma.job.findMany.mockResolvedValue([expiredJob]);
      prisma.job.updateMany.mockResolvedValue({ count: 1 });

      const count = await service.reclaimExpiredLeases();

      expect(count).toBe(1);
      expect(prisma.job.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'job-1',
          ownershipEpoch: 3,
          ownershipLeaseExpiry: { lt: expect.any(Date) },
        },
        data: {
          stage: JobStage.QUEUED,
          ownershipLeaseExpiry: null,
          ownershipEpoch: { increment: 1 },
          progress: 0,
          startedAt: null,
          lastProgressUpdate: null,
        },
      });
    });

    it('should skip reclaim when optimistic lock fails (epoch changed — count=0)', async () => {
      const expiredJob = { id: 'job-1', nodeId: 'node-a', ownershipEpoch: 2, fileLabel: 'f.mkv' };
      prisma.job.findMany.mockResolvedValue([expiredJob]);
      // Epoch already incremented by a racing renewal → 0 rows matched
      prisma.job.updateMany.mockResolvedValue({ count: 0 });

      const count = await service.reclaimExpiredLeases();

      expect(count).toBe(0);
    });

    it('should continue reclaiming remaining jobs when one update throws', async () => {
      const jobs = [
        { id: 'job-fail', nodeId: 'node-a', ownershipEpoch: 1, fileLabel: 'a.mkv' },
        { id: 'job-ok', nodeId: 'node-b', ownershipEpoch: 2, fileLabel: 'b.mkv' },
      ];
      prisma.job.findMany.mockResolvedValue(jobs);
      prisma.job.updateMany
        .mockRejectedValueOnce(new Error('DB error'))
        .mockResolvedValueOnce({ count: 1 });

      const count = await service.reclaimExpiredLeases();

      expect(count).toBe(1);
    });

    it('should return 0 without throwing when findMany fails (outer catch)', async () => {
      prisma.job.findMany.mockRejectedValue(new Error('connection lost'));

      const count = await service.reclaimExpiredLeases();

      expect(count).toBe(0);
    });

    it('should reclaim multiple expired jobs and return correct total count', async () => {
      const jobs = [
        { id: 'job-1', nodeId: 'node-a', ownershipEpoch: 1, fileLabel: 'a.mkv' },
        { id: 'job-2', nodeId: 'node-b', ownershipEpoch: 5, fileLabel: 'b.mkv' },
        { id: 'job-3', nodeId: 'node-c', ownershipEpoch: 9, fileLabel: 'c.mkv' },
      ];
      prisma.job.findMany.mockResolvedValue(jobs);
      prisma.job.updateMany.mockResolvedValue({ count: 1 });

      const count = await service.reclaimExpiredLeases();

      expect(count).toBe(3);
      expect(prisma.job.updateMany).toHaveBeenCalledTimes(3);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // periodicLeaseReclaim (cron handler)
  // ──────────────────────────────────────────────────────────────────────────

  describe('periodicLeaseReclaim', () => {
    it('should call reclaimExpiredLeases on MAIN node', async () => {
      const reclaimSpy = jest.spyOn(service, 'reclaimExpiredLeases').mockResolvedValue(0);
      nodeConfig.isMainNode.mockReturnValue(true);

      await service.periodicLeaseReclaim();

      expect(reclaimSpy).toHaveBeenCalledTimes(1);
    });

    it('should be a no-op on LINKED node', async () => {
      const reclaimSpy = jest.spyOn(service, 'reclaimExpiredLeases').mockResolvedValue(0);
      nodeConfig.isMainNode.mockReturnValue(false);

      await service.periodicLeaseReclaim();

      expect(reclaimSpy).not.toHaveBeenCalled();
    });
  });
});
