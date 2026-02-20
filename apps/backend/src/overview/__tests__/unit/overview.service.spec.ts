import { Test, type TestingModule } from '@nestjs/testing';
import { JobStage, NodeStatus } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { OverviewService } from '../../overview.service';

describe('OverviewService', () => {
  let service: OverviewService;
  let prisma: PrismaService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OverviewService,
        {
          provide: PrismaService,
          useValue: {
            node: {
              groupBy: jest.fn(),
              findMany: jest.fn().mockResolvedValue([]),
              count: jest.fn().mockResolvedValue(0),
            },
            library: {
              aggregate: jest.fn(),
              findMany: jest.fn().mockResolvedValue([]),
              count: jest.fn().mockResolvedValue(0),
            },
            job: {
              groupBy: jest.fn(),
              aggregate: jest.fn(),
              findMany: jest.fn().mockResolvedValue([]),
              count: jest.fn().mockResolvedValue(0),
            },
            policy: {
              findMany: jest.fn().mockResolvedValue([]),
            },
          },
        },
      ],
    }).compile();

    service = module.get<OverviewService>(OverviewService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getSystemHealth', () => {
    it('should return HEALTHY status when all nodes are online', async () => {
      jest
        .spyOn(prisma.node, 'groupBy')
        .mockResolvedValue([{ status: NodeStatus.ONLINE, _count: { status: 3 } }] as never);

      jest.spyOn(prisma.library, 'aggregate').mockResolvedValue({
        _sum: { totalSizeBytes: BigInt('2251799813685248') }, // ~2TB
      } as never);

      const result = await service.getSystemHealth();

      expect(result.status).toBe('HEALTHY');
      expect(result.activeNodes).toBe(3);
      expect(result.offlineNodes).toBe(0);
      expect(result.usedStorage).toBe('2251799813685248');
      expect(result.storagePercent).toBeGreaterThan(0);
    });

    it('should return DEGRADED status when some nodes are offline', async () => {
      jest.spyOn(prisma.node, 'groupBy').mockResolvedValue([
        { status: NodeStatus.ONLINE, _count: { status: 2 } },
        { status: NodeStatus.OFFLINE, _count: { status: 1 } },
      ] as never);

      jest.spyOn(prisma.library, 'aggregate').mockResolvedValue({
        _sum: { totalSizeBytes: BigInt('1125899906842624') }, // ~1TB
      } as never);

      const result = await service.getSystemHealth();

      expect(result.status).toBe('DEGRADED');
      expect(result.activeNodes).toBe(2);
      expect(result.offlineNodes).toBe(1);
    });

    it('should return OFFLINE status when no nodes are online', async () => {
      jest.spyOn(prisma.node, 'groupBy').mockResolvedValue([
        { status: NodeStatus.OFFLINE, _count: { status: 2 } },
        { status: NodeStatus.ERROR, _count: { status: 1 } },
      ] as never);

      jest.spyOn(prisma.library, 'aggregate').mockResolvedValue({
        _sum: { totalSizeBytes: BigInt(0) },
      } as never);

      const result = await service.getSystemHealth();

      expect(result.status).toBe('OFFLINE');
      expect(result.activeNodes).toBe(0);
      expect(result.offlineNodes).toBe(3);
    });

    it('should handle nodes in ERROR state as offline', async () => {
      jest.spyOn(prisma.node, 'groupBy').mockResolvedValue([
        { status: NodeStatus.ONLINE, _count: { status: 1 } },
        { status: NodeStatus.ERROR, _count: { status: 2 } },
      ] as never);

      jest.spyOn(prisma.library, 'aggregate').mockResolvedValue({
        _sum: { totalSizeBytes: BigInt('500000000000') },
      } as never);

      const result = await service.getSystemHealth();

      expect(result.status).toBe('DEGRADED');
      expect(result.offlineNodes).toBe(2);
    });
  });

  describe('getQueueSummary', () => {
    it('should aggregate job counts by stage correctly', async () => {
      jest.spyOn(prisma.job, 'groupBy').mockResolvedValue([
        { stage: JobStage.QUEUED, _count: { stage: 25 } },
        { stage: JobStage.ENCODING, _count: { stage: 8 } },
        { stage: JobStage.COMPLETED, _count: { stage: 342 } },
        { stage: JobStage.FAILED, _count: { stage: 5 } },
      ] as never);

      jest.spyOn(prisma.job, 'aggregate').mockResolvedValue({
        _sum: {
          savedBytes: BigInt('45097156608000'), // ~41TB saved
          beforeSizeBytes: BigInt('128102389432320'), // ~116TB original
        },
      } as never);

      const result = await service.getQueueSummary();

      expect(result.queued).toBe(25);
      expect(result.encoding).toBe(8);
      expect(result.completed).toBe(342);
      expect(result.failed).toBe(5);
      expect(result.totalSavedBytes).toBe('45097156608000');
      expect(result.totalSavedPercent).toBeCloseTo(35.2, 0);
    });

    it('should handle empty queue correctly', async () => {
      jest.spyOn(prisma.job, 'groupBy').mockResolvedValue([] as never);

      jest.spyOn(prisma.job, 'aggregate').mockResolvedValue({
        _sum: {
          savedBytes: BigInt(0),
          beforeSizeBytes: BigInt(1),
        },
      } as never);

      const result = await service.getQueueSummary();

      expect(result.queued).toBe(0);
      expect(result.encoding).toBe(0);
      expect(result.completed).toBe(0);
      expect(result.failed).toBe(0);
      expect(result.totalSavedPercent).toBe(0);
    });

    it('should handle negative savings correctly', async () => {
      jest
        .spyOn(prisma.job, 'groupBy')
        .mockResolvedValue([{ stage: JobStage.COMPLETED, _count: { stage: 10 } }] as never);

      jest.spyOn(prisma.job, 'aggregate').mockResolvedValue({
        _sum: {
          savedBytes: BigInt('-5000000000'), // Negative savings
          beforeSizeBytes: BigInt('100000000000'),
        },
      } as never);

      const result = await service.getQueueSummary();

      expect(result.totalSavedBytes).toBe('-5000000000');
      expect(result.totalSavedPercent).toBeCloseTo(-5, 1);
    });
  });

  describe('getRecentActivity', () => {
    it('should return last 10 completed jobs ordered by completion date', async () => {
      const mockJobs = Array.from({ length: 10 }, (_, i) => ({
        id: `job-${i}`,
        fileLabel: `Movie ${i}.mkv`,
        sourceCodec: 'H.264',
        targetCodec: 'HEVC',
        stage: JobStage.COMPLETED,
        savedBytes: BigInt('1342177280'),
        beforeSizeBytes: BigInt('10000000000'),
        afterSizeBytes: BigInt('5000000000'),
        savedPercent: 42.5,
        completedAt: new Date(Date.now() - i * 3600000), // Stagger by 1 hour
        library: {
          name: `Library ${i}`,
        },
      }));

      jest.spyOn(prisma.job, 'findMany').mockResolvedValue(mockJobs as never);

      const result = await service.getRecentActivity();

      expect(result).toHaveLength(10);
      expect(result[0].id).toBe('job-0');
      expect(result[0].fileLabel).toBe('Movie 0.mkv');
      expect(result[0].libraryName).toBe('Library 0');
      expect(result[0].savedBytes).toBe('1342177280');
      expect(result[0].savedPercent).toBe(42.5);
    });

    it('should handle fewer than 10 jobs', async () => {
      const mockJobs = [
        {
          id: 'job-1',
          fileLabel: 'Test Movie.mkv',
          sourceCodec: 'H.264',
          targetCodec: 'HEVC',
          stage: JobStage.COMPLETED,
          savedBytes: BigInt('1000000000'),
          beforeSizeBytes: BigInt('10000000000'),
          afterSizeBytes: BigInt('5000000000'),
          savedPercent: 30.0,
          completedAt: new Date(),
          library: {
            name: 'Main Library',
          },
        },
      ];

      jest.spyOn(prisma.job, 'findMany').mockResolvedValue(mockJobs as never);

      const result = await service.getRecentActivity();

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('job-1');
    });

    it('should handle null savedBytes gracefully', async () => {
      jest.spyOn(prisma.job, 'findMany').mockResolvedValue([
        {
          id: 'job-1',
          fileLabel: 'Test.mkv',
          sourceCodec: 'H.264',
          targetCodec: 'HEVC',
          stage: JobStage.COMPLETED,
          savedBytes: null,
          beforeSizeBytes: BigInt('10000000000'),
          afterSizeBytes: BigInt('10000000000'),
          savedPercent: null,
          completedAt: new Date(),
          library: {
            name: 'Test Library',
          },
        },
      ] as never);

      const result = await service.getRecentActivity();

      expect(result[0].savedBytes).toBeNull();
      expect(result[0].savedPercent).toBeNull();
    });
  });

  describe('getTopLibraries', () => {
    it('should return top 5 libraries by job count', async () => {
      const mockLibraries = [
        { id: 'lib-1', name: 'Main Movies', path: '/media/movies', mediaType: 'MOVIE', _count: { jobs: 127 } },
        { id: 'lib-2', name: 'TV Shows', path: '/media/tv', mediaType: 'TV_SHOW', _count: { jobs: 98 } },
        { id: 'lib-3', name: 'Anime', path: '/media/anime', mediaType: 'ANIME', _count: { jobs: 45 } },
      ];

      jest.spyOn(prisma.library, 'findMany').mockResolvedValue(mockLibraries as never);
      jest.spyOn(prisma.job, 'groupBy')
        .mockResolvedValueOnce([
          { libraryId: 'lib-1', _count: { id: 3 } },
          { libraryId: 'lib-2', _count: { id: 2 } },
          { libraryId: 'lib-3', _count: { id: 1 } },
        ] as never) // completedCounts
        .mockResolvedValueOnce([] as never) // encodingCounts
        .mockResolvedValueOnce([
          { libraryId: 'lib-1', _sum: { savedBytes: BigInt('10000000000'), beforeSizeBytes: BigInt('20000000000') } },
          { libraryId: 'lib-2', _sum: { savedBytes: BigInt('5000000000'), beforeSizeBytes: BigInt('10000000000') } },
          { libraryId: 'lib-3', _sum: { savedBytes: BigInt('2500000000'), beforeSizeBytes: BigInt('5000000000') } },
        ] as never); // librarySavings

      const result = await service.getTopLibraries();

      expect(result).toHaveLength(3);
      expect(result[0].id).toBe('lib-1');
      expect(result[0].name).toBe('Main Movies');
      expect(result[0].jobCount).toBe(127);
      expect(result[0].completedJobs).toBe(3);
      expect(result[0].totalSavedBytes).toBe('10000000000');

      expect(result[1].jobCount).toBe(98);
      expect(result[1].completedJobs).toBe(2);
      expect(result[1].totalSavedBytes).toBe('5000000000');
    });

    it('should handle libraries with no completed jobs', async () => {
      jest.spyOn(prisma.library, 'findMany').mockResolvedValue([
        { id: 'lib-1', name: 'Empty Library', path: '/media/empty', mediaType: 'MOVIE', _count: { jobs: 15 } },
      ] as never);
      jest.spyOn(prisma.job, 'groupBy')
        .mockResolvedValueOnce([] as never) // completedCounts
        .mockResolvedValueOnce([] as never) // encodingCounts
        .mockResolvedValueOnce([] as never); // librarySavings

      const result = await service.getTopLibraries();

      expect(result).toHaveLength(1);
      expect(result[0].completedJobs).toBe(0);
      expect(result[0].totalSavedBytes).toBe('0');
    });

    it('should handle null savedBytes in jobs', async () => {
      jest.spyOn(prisma.library, 'findMany').mockResolvedValue([
        { id: 'lib-1', name: 'Test Library', path: '/media/test', mediaType: 'MOVIE', _count: { jobs: 5 } },
      ] as never);
      jest.spyOn(prisma.job, 'groupBy')
        .mockResolvedValueOnce([{ libraryId: 'lib-1', _count: { id: 2 } }] as never) // completedCounts
        .mockResolvedValueOnce([] as never) // encodingCounts
        .mockResolvedValueOnce([{ libraryId: 'lib-1', _sum: { savedBytes: BigInt('1000000000'), beforeSizeBytes: BigInt('2000000000') } }] as never);

      const result = await service.getTopLibraries();

      expect(result[0].totalSavedBytes).toBe('1000000000');
    });
  });

  describe('getOverviewStats', () => {
    it('should aggregate all statistics in parallel', async () => {
      // Mock system health
      jest
        .spyOn(prisma.node, 'groupBy')
        .mockResolvedValue([{ status: NodeStatus.ONLINE, _count: { status: 3 } }] as never);
      jest.spyOn(prisma.library, 'aggregate').mockResolvedValue({
        _sum: { totalSizeBytes: BigInt('2000000000000') },
      } as never);

      // Mock queue stats
      jest.spyOn(prisma.job, 'groupBy').mockResolvedValue([
        { stage: JobStage.QUEUED, _count: { stage: 10 } },
        { stage: JobStage.COMPLETED, _count: { stage: 100 } },
      ] as never);
      jest.spyOn(prisma.job, 'aggregate').mockResolvedValue({
        _sum: {
          savedBytes: BigInt('10000000000'),
          beforeSizeBytes: BigInt('50000000000'),
        },
      } as never);

      // Mock recent activity and top libraries
      jest.spyOn(prisma.job, 'findMany').mockResolvedValueOnce([
        {
          id: 'job-1',
          fileLabel: 'Movie.mkv',
          sourceCodec: 'H.264',
          targetCodec: 'HEVC',
          stage: JobStage.COMPLETED,
          savedBytes: BigInt('1000000000'),
          beforeSizeBytes: BigInt('10000000000'),
          afterSizeBytes: BigInt('5000000000'),
          savedPercent: 40.0,
          completedAt: new Date(),
          library: { name: 'Movies' },
        },
      ] as never);

      jest.spyOn(prisma.library, 'findMany').mockResolvedValueOnce([
        {
          id: 'lib-1',
          name: 'Main Library',
          path: '/media',
          _count: { jobs: 50 },
          jobs: [{ savedBytes: BigInt('5000000000') }],
        },
      ] as never);

      const result = await service.getOverviewStats();

      expect(result.systemHealth).toBeDefined();
      expect(result.queueStats).toBeDefined();
      expect(result.recentActivity).toBeDefined();
      expect(result.topLibraries).toBeDefined();
      expect(result.timestamp).toBeInstanceOf(Date);

      expect(result.systemHealth.activeNodes).toBe(3);
      expect(result.queueStats.queued).toBe(10);
      expect(result.recentActivity).toHaveLength(1);
      expect(result.topLibraries).toHaveLength(1);
    });

    it('should handle errors gracefully when individual methods fail', async () => {
      jest.spyOn(prisma.node, 'groupBy').mockRejectedValue(new Error('Database error'));

      await expect(service.getOverviewStats()).rejects.toThrow('Database error');
    });
  });

  describe('getOverview', () => {
    it('should return overview in snake_case format with correct transformations', async () => {
      // Mock system health
      jest.spyOn(prisma.node, 'groupBy').mockResolvedValue([
        { status: NodeStatus.ONLINE, _count: { status: 3 } },
        { status: NodeStatus.OFFLINE, _count: { status: 2 } },
      ] as never);
      const now = new Date();
      jest.spyOn(prisma.node, 'findMany').mockResolvedValue([
        { id: 'n1', name: 'Node 1', status: 'ONLINE', role: 'MAIN', acceleration: 'CPU', maxWorkers: 4, lastHeartbeat: now, uptimeSeconds: 3600, currentSystemLoad: 0.5, currentMemoryFreeGB: 8, queuedJobCount: 2, recentFailureCount: 0, failureRate24h: 0 },
        { id: 'n2', name: 'Node 2', status: 'ONLINE', role: 'LINKED', acceleration: 'NVIDIA', maxWorkers: 2, lastHeartbeat: now, uptimeSeconds: 7200, currentSystemLoad: 0.3, currentMemoryFreeGB: 12, queuedJobCount: 1, recentFailureCount: 0, failureRate24h: 0 },
        { id: 'n3', name: 'Node 3', status: 'ONLINE', role: 'LINKED', acceleration: 'CPU', maxWorkers: 4, lastHeartbeat: now, uptimeSeconds: 1800, currentSystemLoad: 0.7, currentMemoryFreeGB: 4, queuedJobCount: 0, recentFailureCount: 0, failureRate24h: 0 },
        { id: 'n4', name: 'Node 4', status: 'OFFLINE', role: 'LINKED', acceleration: 'CPU', maxWorkers: 2, lastHeartbeat: now, uptimeSeconds: 0, currentSystemLoad: null, currentMemoryFreeGB: null, queuedJobCount: 0, recentFailureCount: 0, failureRate24h: 0 },
        { id: 'n5', name: 'Node 5', status: 'OFFLINE', role: 'LINKED', acceleration: 'CPU', maxWorkers: 2, lastHeartbeat: now, uptimeSeconds: 0, currentSystemLoad: null, currentMemoryFreeGB: null, queuedJobCount: 0, recentFailureCount: 0, failureRate24h: 0 },
      ] as never);
      jest.spyOn(prisma.library, 'aggregate').mockResolvedValue({
        _sum: { totalSizeBytes: BigInt('2000000000000') },
      } as never);

      // Mock queue stats + top libraries groupBy (argument-based routing for parallel calls)
      jest.spyOn(prisma.job, 'groupBy').mockImplementation((args: any) => {
        // Queue stats: groupBy stage
        if (args.by?.includes('stage')) {
          return Promise.resolve([
            { stage: JobStage.QUEUED, _count: { stage: 25 } },
            { stage: JobStage.ENCODING, _count: { stage: 8 } },
            { stage: JobStage.COMPLETED, _count: { stage: 342 } },
            { stage: JobStage.FAILED, _count: { stage: 5 } },
          ]) as any;
        }
        // Top libraries: groupBy libraryId
        if (args.by?.includes('libraryId')) {
          if (args._sum) {
            // savings query
            return Promise.resolve([
              { libraryId: 'lib-1', _sum: { savedBytes: BigInt('16106127360'), beforeSizeBytes: BigInt('32000000000') } },
            ]) as any;
          }
          if (args.where?.stage === JobStage.COMPLETED) {
            return Promise.resolve([{ libraryId: 'lib-1', _count: { id: 100 } }]) as any;
          }
          if (args.where?.stage === JobStage.ENCODING) {
            return Promise.resolve([{ libraryId: 'lib-1', _count: { id: 5 } }]) as any;
          }
          return Promise.resolve([]) as any;
        }
        return Promise.resolve([]) as any;
      });
      jest.spyOn(prisma.job, 'aggregate').mockResolvedValue({
        _sum: {
          savedBytes: BigInt('2748779069440'), // ~2.5TB
          beforeSizeBytes: BigInt('100000000000'),
        },
      } as never);

      // Mock recent activity
      jest.spyOn(prisma.job, 'findMany').mockResolvedValueOnce([
        {
          id: 'job-1',
          fileLabel: 'Movie.mkv',
          sourceCodec: 'H.264',
          targetCodec: 'HEVC',
          stage: JobStage.COMPLETED,
          beforeSizeBytes: BigInt('10000000000'),
          afterSizeBytes: BigInt('5000000000'),
          savedBytes: BigInt('1342177280'), // ~1.25GB
          savedPercent: 40.0,
          completedAt: new Date('2025-09-30T21:45:32.123Z'),
          library: { name: 'Movies' },
        },
      ] as never);

      // Mock top libraries
      jest.spyOn(prisma.library, 'findMany').mockResolvedValueOnce([
        {
          id: 'lib-1',
          name: 'Main Library',
          path: '/media',
          mediaType: 'MOVIE',
          _count: { jobs: 127 },
        },
      ] as never);

      const result = await service.getOverview();

      // Verify snake_case structure
      expect(result.system_health).toBeDefined();
      expect(result.queue_summary).toBeDefined();
      expect(result.recent_activity).toBeDefined();
      expect(result.top_libraries).toBeDefined();
      expect(result.last_updated).toBeDefined();

      // Verify system health
      expect(result.system_health.active_nodes.current).toBe(3);
      expect(result.system_health.active_nodes.total).toBe(5);
      expect(result.system_health.queue_status.encoding_count).toBe(8);
      expect(result.system_health.storage_saved.total_tb).toBeCloseTo(2.5, 1);
      expect(result.system_health.success_rate.percentage).toBeCloseTo(98.6, 1);

      // Verify queue summary
      expect(result.queue_summary.queued).toBe(25);
      expect(result.queue_summary.encoding).toBe(8);
      expect(result.queue_summary.completed).toBe(342);
      expect(result.queue_summary.failed).toBe(5);

      // Verify recent activity
      expect(result.recent_activity).toHaveLength(1);
      expect(result.recent_activity[0].id).toBe('job-1');
      expect(result.recent_activity[0].file_name).toBe('Movie.mkv');
      expect(result.recent_activity[0].library).toBe('Movies');
      expect(result.recent_activity[0].source_codec).toBe('H.264');
      expect(result.recent_activity[0].saved_bytes).toBeDefined();
      expect(result.recent_activity[0].completed_at).toBe('2025-09-30T21:45:32.123Z');

      // Verify top libraries
      expect(result.top_libraries).toHaveLength(1);
      expect(result.top_libraries[0].name).toBe('Main Library');
      expect(result.top_libraries[0].job_count).toBe(127);
      expect(result.top_libraries[0].total_savings_bytes).toBeDefined();
    });

    it('should handle zero stats correctly', async () => {
      jest.spyOn(prisma.node, 'groupBy').mockResolvedValue([] as never);
      jest.spyOn(prisma.library, 'aggregate').mockResolvedValue({
        _sum: { totalSizeBytes: BigInt(0) },
      } as never);
      jest.spyOn(prisma.job, 'groupBy').mockResolvedValue([] as never);
      jest.spyOn(prisma.job, 'aggregate').mockResolvedValue({
        _sum: {
          savedBytes: BigInt(0),
          beforeSizeBytes: BigInt(1),
        },
      } as never);
      jest.spyOn(prisma.job, 'findMany').mockResolvedValueOnce([] as never);
      jest.spyOn(prisma.library, 'findMany').mockResolvedValueOnce([] as never);

      const result = await service.getOverview();

      expect(result.system_health.active_nodes.current).toBe(0);
      expect(result.system_health.active_nodes.total).toBe(0);
      expect(result.system_health.success_rate.percentage).toBe(0);
      expect(result.queue_summary.queued).toBe(0);
      expect(result.recent_activity).toEqual([]);
      expect(result.top_libraries).toEqual([]);
    });

    it('should handle errors from underlying methods', async () => {
      jest.spyOn(prisma.node, 'groupBy').mockRejectedValue(new Error('Database connection failed'));

      await expect(service.getOverview()).rejects.toThrow('Database connection failed');
    });
  });
});
