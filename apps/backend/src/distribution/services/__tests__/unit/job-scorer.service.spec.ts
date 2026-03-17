import { Test, type TestingModule } from '@nestjs/testing';
import type { Job, Node } from '@prisma/client';
import { PrismaService } from '../../../../prisma/prisma.service';
import { createMockPrismaService } from '../../../../testing/mock-providers';
import { JobScorerService } from '../../job-scorer.service';
import { LoadMonitorService } from '../../load-monitor.service';

type NodeWithCounts = Node & {
  _count: { jobs: number; failureLogs?: number };
};

type JobWithRelations = Job & {
  library: { nodeId: string };
};

describe('JobScorerService', () => {
  let service: JobScorerService;
  let prisma: ReturnType<typeof createMockPrismaService>;
  let loadMonitor: Record<string, jest.Mock>;

  const defaultConfig = {
    id: 'default',
    isActive: true,
    weightRealTimeLoad: 1.0,
    weightQueueDepth: 1.0,
    weightHardware: 1.0,
    weightPerformance: 1.0,
    weightCodecMatch: 1.0,
    weightLibraryAffinity: 1.0,
    weightETABalance: 1.0,
    weightFileSizeSpread: 1.0,
    weightStickiness: 1.0,
    weightTransferCost: 1.0,
    weightReliability: 1.0,
    stickinessMinutes: 30,
    failureWindow24h: true,
    enableETABalancing: true,
    enableFileSizeSpread: true,
    enableLibraryAffinity: true,
    migrationScoreThreshold: 15,
    maxMigrationsPerJob: 3,
    highLoadThreshold: 0.8,
    scoreCacheTtlSeconds: 60,
  };

  beforeEach(async () => {
    prisma = createMockPrismaService();
    loadMonitor = {
      getNodeLoad: jest.fn().mockResolvedValue(null),
      calculateLoadScore: jest.fn().mockReturnValue(15),
    } as Record<string, jest.Mock>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JobScorerService,
        { provide: PrismaService, useValue: prisma },
        { provide: LoadMonitorService, useValue: loadMonitor },
      ],
    }).compile();

    service = module.get<JobScorerService>(JobScorerService);

    jest.spyOn((service as any).logger, 'log').mockImplementation();
    jest.spyOn((service as any).logger, 'warn').mockImplementation();
    jest.spyOn((service as any).logger, 'debug').mockImplementation();
    jest.spyOn((service as any).logger, 'error').mockImplementation();

    // Default config
    prisma.distributionConfig.findFirst.mockResolvedValue(defaultConfig);
  });

  afterEach(() => {
    jest.clearAllMocks();
    service.clearCaches();
  });

  const createNode = (overrides: Partial<NodeWithCounts> = {}): NodeWithCounts =>
    ({
      id: 'node-1',
      name: 'Test Node',
      cpuCores: 8,
      hasGpu: false,
      acceleration: undefined,
      maxWorkers: 2,
      avgEncodingSpeed: null,
      estimatedFreeAt: null,
      hasSharedStorage: true,
      recentFailureCount: 0,
      scheduleEnabled: false,
      scheduleWindows: null,
      loadThresholdMultiplier: 3.0,
      _count: { jobs: 0 },
      ...overrides,
    }) as unknown as NodeWithCounts;

  const createJob = (overrides: Partial<JobWithRelations> = {}): JobWithRelations =>
    ({
      id: 'job-1',
      filePath: '/media/movie.mkv',
      fileLabel: 'movie.mkv',
      sourceCodec: 'H264',
      targetCodec: 'HEVC',
      stage: 'QUEUED',
      progress: 0,
      beforeSizeBytes: BigInt(2 * 1024 * 1024 * 1024), // 2GB
      nodeId: undefined,
      libraryId: 'lib-1',
      policyId: 'policy-1',
      stickyUntil: null,
      migrationCount: 0,
      library: { nodeId: 'node-1' },
      ...overrides,
    }) as unknown as JobWithRelations;

  describe('calculateScore', () => {
    it('should return 0 score when node schedule is not available', async () => {
      const node = createNode({
        scheduleEnabled: true,
        scheduleWindows: [{ dayOfWeek: 1, startHour: 9, endHour: 17 }] as any,
      });
      const job = createJob();

      // Set time to Sunday midnight (day 0) - outside Mon 9-17 window
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-02-22T00:00:00Z')); // Sunday

      prisma.job.count.mockResolvedValue(0);
      prisma.node.aggregate.mockResolvedValue({ _max: { avgEncodingSpeed: 0 } });

      const score = await service.calculateScore(node, job);
      expect(score.totalScore).toBe(0);
      expect(score.factors.scheduleAvailable).toBe(false);

      jest.useRealTimers();
    });

    it('should calculate positive score for available node', async () => {
      const node = createNode();
      const job = createJob();

      prisma.job.count.mockResolvedValue(0);
      prisma.node.aggregate.mockResolvedValue({ _max: { avgEncodingSpeed: 0 } });

      const score = await service.calculateScore(node, job);
      expect(score.totalScore).toBeGreaterThan(0);
      expect(score.nodeId).toBe('node-1');
      expect(score.nodeName).toBe('Test Node');
      expect(score.factors.scheduleAvailable).toBe(true);
    });

    it('should never return negative total score', async () => {
      // Create a node that would score poorly
      const node = createNode({
        hasGpu: false,
        recentFailureCount: 10,
        hasSharedStorage: false,
      });
      const job = createJob({
        nodeId: 'other-node',
        migrationCount: 2,
        stickyUntil: new Date(Date.now() + 60000),
        library: { nodeId: 'other-node' },
      });

      prisma.job.count.mockResolvedValue(10);
      prisma.node.aggregate.mockResolvedValue({ _max: { avgEncodingSpeed: 100 } });
      loadMonitor.calculateLoadScore.mockReturnValue(0);

      const score = await service.calculateScore(node, job);
      expect(score.totalScore).toBeGreaterThanOrEqual(0);
    });
  });

  describe('calculateHardware (private, via calculateScore)', () => {
    it('should give 15 points for GPU', async () => {
      const node = createNode({ hasGpu: true, cpuCores: 0 });
      const job = createJob();

      prisma.job.count.mockResolvedValue(0);
      prisma.node.aggregate.mockResolvedValue({ _max: { avgEncodingSpeed: 0 } });

      const score = await service.calculateScore(node, job);
      expect(score.factors.hardware).toBe(15);
    });

    it('should give up to 10 points for CPU cores', async () => {
      const node = createNode({ hasGpu: false, cpuCores: 16 });
      const job = createJob();

      prisma.job.count.mockResolvedValue(0);
      prisma.node.aggregate.mockResolvedValue({ _max: { avgEncodingSpeed: 0 } });

      const score = await service.calculateScore(node, job);
      expect(score.factors.hardware).toBe(10); // No GPU + 16 cores max = 10
    });

    it('should give 25 points for GPU + 16 cores', async () => {
      const node = createNode({ hasGpu: true, cpuCores: 16 });
      const job = createJob();

      prisma.job.count.mockResolvedValue(0);
      prisma.node.aggregate.mockResolvedValue({ _max: { avgEncodingSpeed: 0 } });

      const score = await service.calculateScore(node, job);
      expect(score.factors.hardware).toBe(25);
    });

    it('should cap CPU score at 10 for >16 cores', async () => {
      const node = createNode({ hasGpu: false, cpuCores: 32 });
      const job = createJob();

      prisma.job.count.mockResolvedValue(0);
      prisma.node.aggregate.mockResolvedValue({ _max: { avgEncodingSpeed: 0 } });

      const score = await service.calculateScore(node, job);
      expect(score.factors.hardware).toBe(10); // Capped at 10
    });
  });

  describe('calculateCodecMatch (private, via calculateScore)', () => {
    it('should give 20 points for NVIDIA + HEVC', async () => {
      const node = createNode({ hasGpu: true, acceleration: 'NVIDIA' as any });
      const job = createJob({ targetCodec: 'HEVC' });

      prisma.job.count.mockResolvedValue(0);
      prisma.node.aggregate.mockResolvedValue({ _max: { avgEncodingSpeed: 0 } });

      const score = await service.calculateScore(node, job);
      expect(score.factors.codecMatch).toBe(20);
    });

    it('should give 15 points for NVIDIA + AV1', async () => {
      const node = createNode({ hasGpu: true, acceleration: 'NVIDIA' as any });
      const job = createJob({ targetCodec: 'AV1' });

      prisma.job.count.mockResolvedValue(0);
      prisma.node.aggregate.mockResolvedValue({ _max: { avgEncodingSpeed: 0 } });

      const score = await service.calculateScore(node, job);
      expect(score.factors.codecMatch).toBe(15);
    });

    it('should give 18 points for Intel QSV + HEVC', async () => {
      const node = createNode({ hasGpu: true, acceleration: 'INTEL_QSV' as any });
      const job = createJob({ targetCodec: 'HEVC' });

      prisma.job.count.mockResolvedValue(0);
      prisma.node.aggregate.mockResolvedValue({ _max: { avgEncodingSpeed: 0 } });

      const score = await service.calculateScore(node, job);
      expect(score.factors.codecMatch).toBe(18);
    });

    it('should give 18 points for Intel QSV + AV1', async () => {
      const node = createNode({ hasGpu: true, acceleration: 'INTEL_QSV' as any });
      const job = createJob({ targetCodec: 'AV1' });

      prisma.job.count.mockResolvedValue(0);
      prisma.node.aggregate.mockResolvedValue({ _max: { avgEncodingSpeed: 0 } });

      const score = await service.calculateScore(node, job);
      expect(score.factors.codecMatch).toBe(18);
    });

    it('should give 20 points for Apple M + HEVC', async () => {
      const node = createNode({ hasGpu: true, acceleration: 'APPLE_M' as any });
      const job = createJob({ targetCodec: 'HEVC' });

      prisma.job.count.mockResolvedValue(0);
      prisma.node.aggregate.mockResolvedValue({ _max: { avgEncodingSpeed: 0 } });

      const score = await service.calculateScore(node, job);
      expect(score.factors.codecMatch).toBe(20);
    });

    it('should give 0 for no GPU', async () => {
      const node = createNode({ hasGpu: false });
      const job = createJob({ targetCodec: 'HEVC' });

      prisma.job.count.mockResolvedValue(0);
      prisma.node.aggregate.mockResolvedValue({ _max: { avgEncodingSpeed: 0 } });

      const score = await service.calculateScore(node, job);
      expect(score.factors.codecMatch).toBe(0);
    });

    it('should give 0 for GPU without matching codec', async () => {
      const node = createNode({ hasGpu: true, acceleration: 'APPLE_M' as any });
      const job = createJob({ targetCodec: 'AV1' }); // Apple M doesn't support AV1

      prisma.job.count.mockResolvedValue(0);
      prisma.node.aggregate.mockResolvedValue({ _max: { avgEncodingSpeed: 0 } });

      const score = await service.calculateScore(node, job);
      expect(score.factors.codecMatch).toBe(0);
    });

    it('should give 18 points for AMD + HEVC', async () => {
      const node = createNode({ hasGpu: true, acceleration: 'AMD' as any });
      const job = createJob({ targetCodec: 'HEVC' });

      prisma.job.count.mockResolvedValue(0);
      prisma.node.aggregate.mockResolvedValue({ _max: { avgEncodingSpeed: 0 } });

      const score = await service.calculateScore(node, job);
      expect(score.factors.codecMatch).toBe(18);
    });
  });

  describe('calculatePerformance (private, via calculateScore)', () => {
    it('should give baseline score (12) with no performance data', async () => {
      const node = createNode({ avgEncodingSpeed: null });
      const job = createJob();

      prisma.job.count.mockResolvedValue(0);
      prisma.node.aggregate.mockResolvedValue({ _max: { avgEncodingSpeed: 0 } });

      const score = await service.calculateScore(node, job);
      expect(score.factors.performance).toBe(12);
    });

    it('should give 25 points for fastest node', async () => {
      const node = createNode({ avgEncodingSpeed: 100 });
      const job = createJob();

      prisma.job.count.mockResolvedValue(0);
      prisma.node.aggregate.mockResolvedValue({ _max: { avgEncodingSpeed: 100 } });

      const score = await service.calculateScore(node, job);
      expect(score.factors.performance).toBe(25);
    });

    it('should give proportional score for slower nodes', async () => {
      const node = createNode({ avgEncodingSpeed: 50 });
      const job = createJob();

      prisma.job.count.mockResolvedValue(0);
      prisma.node.aggregate.mockResolvedValue({ _max: { avgEncodingSpeed: 100 } });

      const score = await service.calculateScore(node, job);
      expect(score.factors.performance).toBe(13); // 50/100 * 25 = 12.5 -> 13
    });
  });

  describe('calculateQueueDepth (private, via calculateScore)', () => {
    it('should give 20 points for empty queue', async () => {
      const node = createNode({ maxWorkers: 2 });
      const job = createJob();

      // Return 0 for queued jobs count
      prisma.job.count.mockResolvedValue(0);
      prisma.node.aggregate.mockResolvedValue({ _max: { avgEncodingSpeed: 0 } });

      const score = await service.calculateScore(node, job);
      expect(score.factors.queueDepth).toBe(20);
    });

    it('should give 0 points for full queue', async () => {
      const node = createNode({ maxWorkers: 2 });
      const job = createJob();

      // Queue count returns 4 (2x maxWorkers = full)
      prisma.job.count
        .mockResolvedValueOnce(4) // queueDepth query
        .mockResolvedValue(0);
      prisma.node.aggregate.mockResolvedValue({ _max: { avgEncodingSpeed: 0 } });

      const score = await service.calculateScore(node, job);
      expect(score.factors.queueDepth).toBe(0);
    });
  });

  describe('calculateStickiness (private, via calculateScore)', () => {
    it('should give 0 penalty for unassigned job', async () => {
      const node = createNode();
      const job = createJob({ nodeId: undefined });

      prisma.job.count.mockResolvedValue(0);
      prisma.node.aggregate.mockResolvedValue({ _max: { avgEncodingSpeed: 0 } });

      const score = await service.calculateScore(node, job);
      expect(score.factors.stickiness).toBe(0);
    });

    it('should give 0 penalty for same node assignment', async () => {
      const node = createNode({ id: 'node-1' });
      const job = createJob({ nodeId: 'node-1' });

      prisma.job.count.mockResolvedValue(0);
      prisma.node.aggregate.mockResolvedValue({ _max: { avgEncodingSpeed: 0 } });

      const score = await service.calculateScore(node, job);
      expect(score.factors.stickiness).toBe(0);
    });

    it('should give -20 penalty during sticky period', async () => {
      const node = createNode({ id: 'node-2' });
      const job = createJob({
        nodeId: 'node-1',
        stickyUntil: new Date(Date.now() + 60000), // Still sticky
      });

      prisma.job.count.mockResolvedValue(0);
      prisma.node.aggregate.mockResolvedValue({ _max: { avgEncodingSpeed: 0 } });

      const score = await service.calculateScore(node, job);
      expect(score.factors.stickiness).toBe(-20);
    });

    it('should give graduated penalty based on migration count', async () => {
      const node = createNode({ id: 'node-2' });
      const job = createJob({
        nodeId: 'node-1',
        stickyUntil: null,
        migrationCount: 2,
      });

      prisma.job.count.mockResolvedValue(0);
      prisma.node.aggregate.mockResolvedValue({ _max: { avgEncodingSpeed: 0 } });

      const score = await service.calculateScore(node, job);
      expect(score.factors.stickiness).toBe(-10); // 2 * -5
    });

    it('should block migration when max migrations reached', async () => {
      const node = createNode({ id: 'node-2' });
      const job = createJob({
        nodeId: 'node-1',
        stickyUntil: null,
        migrationCount: 3, // At max
      });

      prisma.job.count.mockResolvedValue(0);
      prisma.node.aggregate.mockResolvedValue({ _max: { avgEncodingSpeed: 0 } });

      const score = await service.calculateScore(node, job);
      expect(score.factors.stickiness).toBe(-20);
    });
  });

  describe('calculateTransferCost (private, via calculateScore)', () => {
    it('should give 0 penalty for shared storage', async () => {
      const node = createNode({ hasSharedStorage: true });
      const job = createJob({ library: { nodeId: 'other-node' } });

      prisma.job.count.mockResolvedValue(0);
      prisma.node.aggregate.mockResolvedValue({ _max: { avgEncodingSpeed: 0 } });

      const score = await service.calculateScore(node, job);
      expect(score.factors.transferCost).toBe(0);
    });

    it('should give 0 penalty for local library', async () => {
      const node = createNode({ id: 'node-1', hasSharedStorage: false });
      const job = createJob({ library: { nodeId: 'node-1' } });

      prisma.job.count.mockResolvedValue(0);
      prisma.node.aggregate.mockResolvedValue({ _max: { avgEncodingSpeed: 0 } });

      const score = await service.calculateScore(node, job);
      expect(score.factors.transferCost).toBe(0);
    });

    it('should give -25 penalty for remote library without shared storage', async () => {
      const node = createNode({ id: 'node-1', hasSharedStorage: false });
      const job = createJob({ library: { nodeId: 'node-2' } });

      prisma.job.count.mockResolvedValue(0);
      prisma.node.aggregate.mockResolvedValue({ _max: { avgEncodingSpeed: 0 } });

      const score = await service.calculateScore(node, job);
      expect(score.factors.transferCost).toBe(-25);
    });
  });

  describe('calculateReliability (private, via calculateScore)', () => {
    it('should give 0 penalty for reliable node', async () => {
      const node = createNode({ recentFailureCount: 0 });
      const job = createJob();

      prisma.job.count.mockResolvedValue(0);
      prisma.node.aggregate.mockResolvedValue({ _max: { avgEncodingSpeed: 0 } });

      const score = await service.calculateScore(node, job);
      expect(score.factors.reliability).toBe(0);
    });

    it('should give -5 for 1-2 failures', async () => {
      const node = createNode({ recentFailureCount: 2 });
      const job = createJob();

      prisma.job.count.mockResolvedValue(0);
      prisma.node.aggregate.mockResolvedValue({ _max: { avgEncodingSpeed: 0 } });

      const score = await service.calculateScore(node, job);
      expect(score.factors.reliability).toBe(-5);
    });

    it('should give -10 for 3-5 failures', async () => {
      const node = createNode({ recentFailureCount: 4 });
      const job = createJob();

      prisma.job.count.mockResolvedValue(0);
      prisma.node.aggregate.mockResolvedValue({ _max: { avgEncodingSpeed: 0 } });

      const score = await service.calculateScore(node, job);
      expect(score.factors.reliability).toBe(-10);
    });

    it('should give -15 for 5+ failures', async () => {
      const node = createNode({ recentFailureCount: 8 });
      const job = createJob();

      prisma.job.count.mockResolvedValue(0);
      prisma.node.aggregate.mockResolvedValue({ _max: { avgEncodingSpeed: 0 } });

      const score = await service.calculateScore(node, job);
      expect(score.factors.reliability).toBe(-15);
    });
  });

  describe('calculateETABalance (private)', () => {
    it('should give 15 for node with no estimatedFreeAt', async () => {
      const node = createNode({ estimatedFreeAt: null });
      const job = createJob();

      prisma.job.count.mockResolvedValue(0);
      prisma.node.aggregate.mockResolvedValue({ _max: { avgEncodingSpeed: 0 } });

      const score = await service.calculateScore(node, job);
      expect(score.factors.etaBalance).toBe(15);
    });

    it('should give 15 for node already free', async () => {
      const node = createNode({
        estimatedFreeAt: new Date(Date.now() - 60000), // 1 minute ago
      });
      const job = createJob();

      prisma.job.count.mockResolvedValue(0);
      prisma.node.aggregate.mockResolvedValue({ _max: { avgEncodingSpeed: 0 } });

      const score = await service.calculateScore(node, job);
      expect(score.factors.etaBalance).toBe(15);
    });

    it('should give 12 for node free within 1 hour', async () => {
      const node = createNode({
        estimatedFreeAt: new Date(Date.now() + 30 * 60 * 1000), // 30 min
      });
      const job = createJob();

      prisma.job.count.mockResolvedValue(0);
      prisma.node.aggregate.mockResolvedValue({ _max: { avgEncodingSpeed: 0 } });

      const score = await service.calculateScore(node, job);
      expect(score.factors.etaBalance).toBe(12);
    });

    it('should give 0 for node busy for 8+ hours', async () => {
      const node = createNode({
        estimatedFreeAt: new Date(Date.now() + 10 * 60 * 60 * 1000), // 10 hours
      });
      const job = createJob();

      prisma.job.count.mockResolvedValue(0);
      prisma.node.aggregate.mockResolvedValue({ _max: { avgEncodingSpeed: 0 } });

      const score = await service.calculateScore(node, job);
      expect(score.factors.etaBalance).toBe(0);
    });
  });

  describe('calculateFileSizeSpread (private)', () => {
    it('should give neutral score (8) for small files', async () => {
      const node = createNode();
      const job = createJob({
        beforeSizeBytes: BigInt(2 * 1024 * 1024 * 1024), // 2GB
      });

      prisma.job.count.mockResolvedValue(0);
      prisma.node.aggregate.mockResolvedValue({ _max: { avgEncodingSpeed: 0 } });

      const score = await service.calculateScore(node, job);
      expect(score.factors.fileSizeSpread).toBe(8);
    });

    it('should give 15 for large file on node with no other large files', async () => {
      const node = createNode();
      const job = createJob({
        beforeSizeBytes: BigInt(10 * 1024 * 1024 * 1024), // 10GB
      });

      // First count call (queueDepth) returns 0, second (libraryAffinity) returns 0,
      // third (fileSizeSpread) returns 0
      prisma.job.count.mockResolvedValue(0);
      prisma.node.aggregate.mockResolvedValue({ _max: { avgEncodingSpeed: 0 } });

      const score = await service.calculateScore(node, job);
      expect(score.factors.fileSizeSpread).toBe(15);
    });
  });

  describe('shouldMigrate', () => {
    it('should not migrate when max migrations reached', async () => {
      const job = createJob({ migrationCount: 3 });
      const current = createNode({ id: 'current' });
      const candidate = createNode({ id: 'candidate' });

      const result = await service.shouldMigrate(job, current, candidate);
      expect(result.shouldMigrate).toBe(false);
      expect(result.reason).toContain('Max migrations');
    });

    it('should not migrate during sticky period', async () => {
      const job = createJob({
        migrationCount: 0,
        stickyUntil: new Date(Date.now() + 60000),
      });
      const current = createNode({ id: 'current' });
      const candidate = createNode({ id: 'candidate' });

      const result = await service.shouldMigrate(job, current, candidate);
      expect(result.shouldMigrate).toBe(false);
      expect(result.reason).toContain('sticky period');
    });

    it('should not migrate when score improvement is below threshold', async () => {
      const job = createJob({ migrationCount: 0, nodeId: 'current' });
      const current = createNode({ id: 'current' });
      const candidate = createNode({ id: 'candidate' });

      prisma.job.count.mockResolvedValue(0);
      prisma.node.aggregate.mockResolvedValue({ _max: { avgEncodingSpeed: 0 } });

      const result = await service.shouldMigrate(job, current, candidate);
      // Both nodes score similarly, so delta should be below threshold
      expect(result.shouldMigrate).toBe(false);
    });

    it('should migrate when candidate has significantly better score', async () => {
      const job = createJob({ migrationCount: 0, nodeId: 'current' });

      const current = createNode({
        id: 'current',
        hasGpu: false,
        cpuCores: 2,
        recentFailureCount: 5,
        hasSharedStorage: false,
      });

      const candidate = createNode({
        id: 'candidate',
        hasGpu: true,
        acceleration: 'NVIDIA' as any,
        cpuCores: 16,
        recentFailureCount: 0,
        hasSharedStorage: true,
      });

      // Make candidate much better
      prisma.job.count.mockResolvedValue(0);
      prisma.node.aggregate.mockResolvedValue({ _max: { avgEncodingSpeed: 0 } });
      loadMonitor.calculateLoadScore.mockReturnValue(30); // High score for both

      const result = await service.shouldMigrate(job, current, candidate);
      expect(result.scoreDelta).toBeGreaterThan(0);
    });
  });

  describe('getConfig (private)', () => {
    it('should create default config if none exists', async () => {
      prisma.distributionConfig.findFirst.mockResolvedValue(null);
      prisma.distributionConfig.create.mockResolvedValue(defaultConfig);

      const node = createNode();
      const job = createJob();

      prisma.job.count.mockResolvedValue(0);
      prisma.node.aggregate.mockResolvedValue({ _max: { avgEncodingSpeed: 0 } });

      await service.calculateScore(node, job);

      expect(prisma.distributionConfig.create).toHaveBeenCalledWith({
        data: { id: 'default' },
      });
    });

    it('should cache config for 1 minute', async () => {
      const node = createNode();
      const job = createJob();

      prisma.job.count.mockResolvedValue(0);
      prisma.node.aggregate.mockResolvedValue({ _max: { avgEncodingSpeed: 0 } });

      await service.calculateScore(node, job);
      await service.calculateScore(node, job);

      // Config should be fetched only once
      expect(prisma.distributionConfig.findFirst).toHaveBeenCalledTimes(1);
    });
  });

  describe('clearCaches', () => {
    it('should clear all caches', async () => {
      const node = createNode();
      const job = createJob();

      prisma.job.count.mockResolvedValue(0);
      prisma.node.aggregate.mockResolvedValue({ _max: { avgEncodingSpeed: 0 } });

      await service.calculateScore(node, job);

      service.clearCaches();

      await service.calculateScore(node, job);

      // Should have fetched config twice (before and after cache clear)
      expect(prisma.distributionConfig.findFirst).toHaveBeenCalledTimes(2);
    });
  });

  describe('config weight application', () => {
    it('should disable optional factors when config flags are false', async () => {
      prisma.distributionConfig.findFirst.mockResolvedValue({
        ...defaultConfig,
        enableLibraryAffinity: false,
        enableETABalancing: false,
        enableFileSizeSpread: false,
      });

      const node = createNode();
      const job = createJob();

      prisma.job.count.mockResolvedValue(0);
      prisma.node.aggregate.mockResolvedValue({ _max: { avgEncodingSpeed: 0 } });

      const score = await service.calculateScore(node, job);

      // Disabled factors should be 0
      expect(score.factors.libraryAffinity).toBe(0);
      expect(score.factors.etaBalance).toBe(0);
      expect(score.factors.fileSizeSpread).toBe(0);
    });
  });
});
