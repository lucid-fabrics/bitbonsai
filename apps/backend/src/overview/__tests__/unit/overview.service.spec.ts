import { Test, type TestingModule } from '@nestjs/testing';
import { JobStage, NodeStatus } from '@prisma/client';
import { JobRepository } from '../../../common/repositories/job.repository';
import { LibraryRepository } from '../../../common/repositories/library.repository';
import { NodeRepository } from '../../../common/repositories/node.repository';
import { OverviewService } from '../../overview.service';

const mockJobRepository = {
  groupByStageCount: jest.fn(),
  aggregateSumWhere: jest.fn(),
  findManyWithInclude: jest.fn(),
  groupByNodeIdCount: jest.fn(),
  groupByNodeIdSum: jest.fn(),
  findManySelect: jest.fn(),
  groupByLibraryIdCount: jest.fn(),
  groupByLibraryIdSum: jest.fn(),
};

const mockNodeRepository = {
  groupByStatusCount: jest.fn(),
  findManyWithJobCountOrdered: jest.fn(),
};

const mockLibraryRepository = {
  aggregateTotalSizeBytes: jest.fn(),
  findManyWithJobCountOrdered: jest.fn(),
};

describe('OverviewService', () => {
  let service: OverviewService;

  beforeEach(async () => {
    jest.clearAllMocks();

    // Defaults so callers that don't need specific data don't throw
    mockNodeRepository.groupByStatusCount.mockResolvedValue([]);
    mockNodeRepository.findManyWithJobCountOrdered.mockResolvedValue([]);
    mockLibraryRepository.aggregateTotalSizeBytes.mockResolvedValue({
      _sum: { totalSizeBytes: BigInt(0) },
    });
    mockLibraryRepository.findManyWithJobCountOrdered.mockResolvedValue([]);
    mockJobRepository.groupByStageCount.mockResolvedValue([]);
    mockJobRepository.aggregateSumWhere.mockResolvedValue({
      _sum: { savedBytes: BigInt(0), beforeSizeBytes: BigInt(1) },
    });
    mockJobRepository.findManyWithInclude.mockResolvedValue([]);
    mockJobRepository.groupByNodeIdCount.mockResolvedValue([]);
    mockJobRepository.groupByNodeIdSum.mockResolvedValue([]);
    mockJobRepository.findManySelect.mockResolvedValue([]);
    mockJobRepository.groupByLibraryIdCount.mockResolvedValue([]);
    mockJobRepository.groupByLibraryIdSum.mockResolvedValue([]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OverviewService,
        { provide: JobRepository, useValue: mockJobRepository },
        { provide: NodeRepository, useValue: mockNodeRepository },
        { provide: LibraryRepository, useValue: mockLibraryRepository },
      ],
    }).compile();

    service = module.get<OverviewService>(OverviewService);
  });

  describe('getSystemHealth', () => {
    it('should return HEALTHY status when all nodes are online', async () => {
      mockNodeRepository.groupByStatusCount.mockResolvedValue([
        { status: NodeStatus.ONLINE, _count: { status: 3 } },
      ]);
      mockLibraryRepository.aggregateTotalSizeBytes.mockResolvedValue({
        _sum: { totalSizeBytes: BigInt('2251799813685248') }, // ~2TB
      });

      const result = await service.getSystemHealth();

      expect(result.status).toBe('HEALTHY');
      expect(result.activeNodes).toBe(3);
      expect(result.offlineNodes).toBe(0);
      expect(result.usedStorage).toBe('2251799813685248');
      expect(result.storagePercent).toBeGreaterThan(0);
    });

    it('should return DEGRADED status when some nodes are offline', async () => {
      mockNodeRepository.groupByStatusCount.mockResolvedValue([
        { status: NodeStatus.ONLINE, _count: { status: 2 } },
        { status: NodeStatus.OFFLINE, _count: { status: 1 } },
      ]);
      mockLibraryRepository.aggregateTotalSizeBytes.mockResolvedValue({
        _sum: { totalSizeBytes: BigInt('1125899906842624') },
      });

      const result = await service.getSystemHealth();

      expect(result.status).toBe('DEGRADED');
      expect(result.activeNodes).toBe(2);
      expect(result.offlineNodes).toBe(1);
    });

    it('should return OFFLINE status when no nodes are online', async () => {
      mockNodeRepository.groupByStatusCount.mockResolvedValue([
        { status: NodeStatus.OFFLINE, _count: { status: 2 } },
        { status: NodeStatus.ERROR, _count: { status: 1 } },
      ]);
      mockLibraryRepository.aggregateTotalSizeBytes.mockResolvedValue({
        _sum: { totalSizeBytes: BigInt(0) },
      });

      const result = await service.getSystemHealth();

      expect(result.status).toBe('OFFLINE');
      expect(result.activeNodes).toBe(0);
      expect(result.offlineNodes).toBe(3);
    });

    it('should handle nodes in ERROR state as offline', async () => {
      mockNodeRepository.groupByStatusCount.mockResolvedValue([
        { status: NodeStatus.ONLINE, _count: { status: 1 } },
        { status: NodeStatus.ERROR, _count: { status: 2 } },
      ]);
      mockLibraryRepository.aggregateTotalSizeBytes.mockResolvedValue({
        _sum: { totalSizeBytes: BigInt('500000000000') },
      });

      const result = await service.getSystemHealth();

      expect(result.status).toBe('DEGRADED');
      expect(result.offlineNodes).toBe(2);
    });
  });

  describe('getQueueSummary', () => {
    it('should aggregate job counts by stage correctly', async () => {
      mockJobRepository.groupByStageCount.mockResolvedValue([
        { stage: JobStage.QUEUED, _count: 25 },
        { stage: JobStage.ENCODING, _count: 8 },
        { stage: JobStage.COMPLETED, _count: 342 },
        { stage: JobStage.FAILED, _count: 5 },
      ]);
      mockJobRepository.aggregateSumWhere.mockResolvedValue({
        _sum: {
          savedBytes: BigInt('45097156608000'),
          beforeSizeBytes: BigInt('128102389432320'),
        },
      });

      const result = await service.getQueueSummary();

      expect(result.queued).toBe(25);
      expect(result.encoding).toBe(8);
      expect(result.completed).toBe(342);
      expect(result.failed).toBe(5);
      expect(result.totalSavedBytes).toBe('45097156608000');
      expect(result.totalSavedPercent).toBeCloseTo(35.2, 0);
    });

    it('should handle empty queue correctly', async () => {
      mockJobRepository.groupByStageCount.mockResolvedValue([]);
      mockJobRepository.aggregateSumWhere.mockResolvedValue({
        _sum: { savedBytes: BigInt(0), beforeSizeBytes: BigInt(1) },
      });

      const result = await service.getQueueSummary();

      expect(result.queued).toBe(0);
      expect(result.encoding).toBe(0);
      expect(result.completed).toBe(0);
      expect(result.failed).toBe(0);
      expect(result.totalSavedPercent).toBe(0);
    });

    it('should handle negative savings correctly', async () => {
      mockJobRepository.groupByStageCount.mockResolvedValue([
        { stage: JobStage.COMPLETED, _count: 10 },
      ]);
      mockJobRepository.aggregateSumWhere.mockResolvedValue({
        _sum: {
          savedBytes: BigInt('-5000000000'),
          beforeSizeBytes: BigInt('100000000000'),
        },
      });

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
        completedAt: new Date(Date.now() - i * 3600000),
        updatedAt: new Date(),
        progress: null,
        library: { name: `Library ${i}` },
      }));
      mockJobRepository.findManyWithInclude.mockResolvedValue(mockJobs);

      const result = await service.getRecentActivity();

      expect(result).toHaveLength(10);
      expect(result[0].id).toBe('job-0');
      expect(result[0].fileLabel).toBe('Movie 0.mkv');
      expect(result[0].libraryName).toBe('Library 0');
      expect(result[0].savedBytes).toBe('1342177280');
      expect(result[0].savedPercent).toBe(42.5);
    });

    it('should handle fewer than 10 jobs', async () => {
      mockJobRepository.findManyWithInclude.mockResolvedValue([
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
          updatedAt: new Date(),
          progress: null,
          library: { name: 'Main Library' },
        },
      ]);

      const result = await service.getRecentActivity();

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('job-1');
    });

    it('should handle null savedBytes gracefully', async () => {
      mockJobRepository.findManyWithInclude.mockResolvedValue([
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
          updatedAt: new Date(),
          progress: null,
          library: { name: 'Test Library' },
        },
      ]);

      const result = await service.getRecentActivity();

      expect(result[0].savedBytes).toBeNull();
      expect(result[0].savedPercent).toBeNull();
    });
  });

  describe('getTopLibraries', () => {
    it('should return top 5 libraries by job count', async () => {
      mockLibraryRepository.findManyWithJobCountOrdered.mockResolvedValue([
        {
          id: 'lib-1',
          name: 'Main Movies',
          path: '/media/movies',
          mediaType: 'MOVIE',
          _count: { jobs: 127 },
        },
        {
          id: 'lib-2',
          name: 'TV Shows',
          path: '/media/tv',
          mediaType: 'TV_SHOW',
          _count: { jobs: 98 },
        },
        {
          id: 'lib-3',
          name: 'Anime',
          path: '/media/anime',
          mediaType: 'ANIME',
          _count: { jobs: 45 },
        },
      ]);
      // groupByLibraryIdCount called twice: completed, then encoding
      mockJobRepository.groupByLibraryIdCount
        .mockResolvedValueOnce([
          { libraryId: 'lib-1', _count: { id: 3 } },
          { libraryId: 'lib-2', _count: { id: 2 } },
          { libraryId: 'lib-3', _count: { id: 1 } },
        ])
        .mockResolvedValueOnce([]);
      mockJobRepository.groupByLibraryIdSum.mockResolvedValue([
        {
          libraryId: 'lib-1',
          _sum: { savedBytes: BigInt('10000000000'), beforeSizeBytes: BigInt('20000000000') },
        },
        {
          libraryId: 'lib-2',
          _sum: { savedBytes: BigInt('5000000000'), beforeSizeBytes: BigInt('10000000000') },
        },
        {
          libraryId: 'lib-3',
          _sum: { savedBytes: BigInt('2500000000'), beforeSizeBytes: BigInt('5000000000') },
        },
      ]);

      const result = await service.getTopLibraries();

      expect(result).toHaveLength(3);
      expect(result[0].id).toBe('lib-1');
      expect(result[0].name).toBe('Main Movies');
      expect(result[0].jobCount).toBe(127);
      expect(result[0].completedJobs).toBe(3);
      expect(result[0].totalSavedBytes).toBe('10000000000');
      expect(result[1].jobCount).toBe(98);
      expect(result[1].completedJobs).toBe(2);
    });

    it('should handle libraries with no completed jobs', async () => {
      mockLibraryRepository.findManyWithJobCountOrdered.mockResolvedValue([
        {
          id: 'lib-1',
          name: 'Empty Library',
          path: '/media/empty',
          mediaType: 'MOVIE',
          _count: { jobs: 15 },
        },
      ]);
      mockJobRepository.groupByLibraryIdCount.mockResolvedValue([]);
      mockJobRepository.groupByLibraryIdSum.mockResolvedValue([]);

      const result = await service.getTopLibraries();

      expect(result).toHaveLength(1);
      expect(result[0].completedJobs).toBe(0);
      expect(result[0].totalSavedBytes).toBe('0');
    });

    it('should return empty array when no libraries exist', async () => {
      mockLibraryRepository.findManyWithJobCountOrdered.mockResolvedValue([]);

      const result = await service.getTopLibraries();

      expect(result).toEqual([]);
    });
  });

  describe('getOverviewStats', () => {
    it('should aggregate all statistics in parallel', async () => {
      mockNodeRepository.groupByStatusCount.mockResolvedValue([
        { status: NodeStatus.ONLINE, _count: { status: 3 } },
      ]);
      mockLibraryRepository.aggregateTotalSizeBytes.mockResolvedValue({
        _sum: { totalSizeBytes: BigInt('2000000000000') },
      });
      mockJobRepository.groupByStageCount.mockResolvedValue([
        { stage: JobStage.QUEUED, _count: 10 },
        { stage: JobStage.COMPLETED, _count: 100 },
      ]);
      mockJobRepository.aggregateSumWhere.mockResolvedValue({
        _sum: { savedBytes: BigInt('10000000000'), beforeSizeBytes: BigInt('50000000000') },
      });
      mockJobRepository.findManyWithInclude.mockResolvedValue([
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
          updatedAt: new Date(),
          progress: null,
          library: { name: 'Movies' },
        },
      ]);
      mockLibraryRepository.findManyWithJobCountOrdered.mockResolvedValue([
        {
          id: 'lib-1',
          name: 'Main Library',
          path: '/media',
          mediaType: 'MOVIE',
          _count: { jobs: 50 },
        },
      ]);
      mockJobRepository.groupByLibraryIdCount.mockResolvedValue([]);
      mockJobRepository.groupByLibraryIdSum.mockResolvedValue([]);

      const result = await service.getOverviewStats();

      expect(result.systemHealth).not.toBeNull();
      expect(result.queueStats).not.toBeNull();
      expect(result.recentActivity).not.toBeNull();
      expect(result.topLibraries).not.toBeNull();
      expect(result.timestamp).toBeInstanceOf(Date);
      expect(result.systemHealth.activeNodes).toBe(3);
      expect(result.queueStats.queued).toBe(10);
      expect(result.recentActivity).toHaveLength(1);
      expect(result.topLibraries).toHaveLength(1);
    });

    it('should handle errors gracefully when individual methods fail', async () => {
      mockNodeRepository.groupByStatusCount.mockRejectedValue(new Error('Database error'));

      await expect(service.getOverviewStats()).rejects.toThrow('Database error');
    });
  });

  describe('getOverview', () => {
    it('should return overview in snake_case format with correct transformations', async () => {
      const now = new Date();

      // getSystemHealth
      mockNodeRepository.groupByStatusCount.mockResolvedValue([
        { status: NodeStatus.ONLINE, _count: { status: 3 } },
        { status: NodeStatus.OFFLINE, _count: { status: 2 } },
      ]);
      mockLibraryRepository.aggregateTotalSizeBytes.mockResolvedValue({
        _sum: { totalSizeBytes: BigInt('2000000000000') },
      });

      // getQueueSummary
      mockJobRepository.groupByStageCount.mockResolvedValue([
        { stage: JobStage.QUEUED, _count: 25 },
        { stage: JobStage.ENCODING, _count: 8 },
        { stage: JobStage.COMPLETED, _count: 342 },
        { stage: JobStage.FAILED, _count: 5 },
      ]);
      mockJobRepository.aggregateSumWhere.mockResolvedValue({
        _sum: { savedBytes: BigInt('2748779069440'), beforeSizeBytes: BigInt('100000000000') },
      });

      // getNodeStatus
      mockNodeRepository.findManyWithJobCountOrdered.mockResolvedValue([
        {
          id: 'n1',
          name: 'Node 1',
          status: 'ONLINE',
          role: 'MAIN',
          acceleration: 'CPU',
          maxWorkers: 4,
          lastHeartbeat: now,
          uptimeSeconds: 3600,
          currentSystemLoad: 0.5,
          currentMemoryFreeGB: 8,
          queuedJobCount: 2,
          recentFailureCount: 0,
          failureRate24h: 0,
        },
      ]);
      mockJobRepository.groupByNodeIdCount.mockResolvedValue([]);
      mockJobRepository.groupByNodeIdSum.mockResolvedValue([]);
      mockJobRepository.findManySelect.mockResolvedValue([]);

      // getRecentActivity
      mockJobRepository.findManyWithInclude.mockResolvedValue([
        {
          id: 'job-1',
          fileLabel: 'Movie.mkv',
          sourceCodec: 'H.264',
          targetCodec: 'HEVC',
          stage: JobStage.COMPLETED,
          beforeSizeBytes: BigInt('10000000000'),
          afterSizeBytes: BigInt('5000000000'),
          savedBytes: BigInt('1342177280'),
          savedPercent: 40.0,
          completedAt: new Date('2025-09-30T21:45:32.123Z'),
          updatedAt: new Date('2025-09-30T21:45:32.123Z'),
          progress: null,
          library: { name: 'Movies' },
        },
      ]);

      // getTopLibraries
      mockLibraryRepository.findManyWithJobCountOrdered.mockResolvedValue([
        {
          id: 'lib-1',
          name: 'Main Library',
          path: '/media',
          mediaType: 'MOVIE',
          _count: { jobs: 127 },
        },
      ]);
      mockJobRepository.groupByLibraryIdCount
        .mockResolvedValueOnce([{ libraryId: 'lib-1', _count: { id: 100 } }])
        .mockResolvedValueOnce([{ libraryId: 'lib-1', _count: { id: 5 } }]);
      mockJobRepository.groupByLibraryIdSum.mockResolvedValue([
        {
          libraryId: 'lib-1',
          _sum: { savedBytes: BigInt('16106127360'), beforeSizeBytes: BigInt('32000000000') },
        },
      ]);

      const result = await service.getOverview();

      // Verify snake_case structure
      expect(result.system_health).not.toBeNull();
      expect(result.queue_summary).not.toBeNull();
      expect(result.recent_activity).not.toBeNull();
      expect(result.top_libraries).not.toBeNull();

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
      expect(result.recent_activity[0].completed_at).toBe('2025-09-30T21:45:32.123Z');

      // Verify top libraries
      expect(result.top_libraries).toHaveLength(1);
      expect(result.top_libraries[0].name).toBe('Main Library');
      expect(result.top_libraries[0].job_count).toBe(127);
      expect(result.top_libraries[0].total_savings_bytes).toBe(16106127360);
    });

    it('should handle zero stats correctly', async () => {
      const result = await service.getOverview();

      expect(result.system_health.active_nodes.current).toBe(0);
      expect(result.system_health.active_nodes.total).toBe(0);
      expect(result.system_health.success_rate.percentage).toBe(0);
      expect(result.queue_summary.queued).toBe(0);
      expect(result.recent_activity).toEqual([]);
      expect(result.top_libraries).toEqual([]);
    });

    it('should handle errors from underlying methods', async () => {
      mockNodeRepository.groupByStatusCount.mockRejectedValue(
        new Error('Database connection failed')
      );

      await expect(service.getOverview()).rejects.toThrow('Database connection failed');
    });
  });
});
