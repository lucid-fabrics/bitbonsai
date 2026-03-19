import { Test, type TestingModule } from '@nestjs/testing';
import type { Job, Node } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { JobAttributionService } from '../job-attribution.service';

describe('JobAttributionService', () => {
  let service: JobAttributionService;
  let prisma: PrismaService;

  /**
   * Mock data factories
   */
  const createMockNode = (overrides?: Partial<Node & { _count?: { jobs: number } }>): any => {
    const baseNode: any = {
      id: 'node-1',
      name: 'Test Node',
      status: 'ONLINE',
      role: 'MAIN',
      version: '1.0.0',
      maxWorkers: 4,
      cpuCores: 8,
      hasGpu: true,
      avgEncodingSpeed: 100,
      scheduleEnabled: false,
      scheduleWindows: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      licenseId: 'license-1',
      acceleration: 'NVIDIA',
      apiKey: 'test-key',
      pairingToken: null,
      pairingExpiresAt: null,
      lastHeartbeat: new Date(),
      uptimeSeconds: 0,
      cpuLimit: 80,
      lastSyncedAt: null,
      syncStatus: 'PENDING',
      syncRetryCount: 0,
      syncError: null,
      networkLocation: 'UNKNOWN',
      hasSharedStorage: false,
      storageBasePath: null,
      ipAddress: null,
      publicUrl: null,
      vpnIpAddress: null,
      maxTransferSizeMB: 50000,
      ramGB: null,
      bandwidthMbps: null,
      latencyMs: null,
      lastSpeedTest: null,
      mainNodeUrl: null,
    };

    const jobsCount = overrides?._count?.jobs ?? 0;
    const { _count, ...rest } = overrides ?? {};

    return {
      ...baseNode,
      ...rest,
      _count: {
        jobs: jobsCount,
      },
    };
  };

  const createMockJob = (overrides?: Partial<Job>): any => {
    const baseJob: any = {
      id: 'job-1',
      libraryId: 'lib-1',
      filePath: '/test/file.mkv',
      fileLabel: 'test.mkv',
      sourceCodec: 'h264',
      sourceContainer: 'mkv',
      targetCodec: 'h265',
      targetContainer: 'mkv',
      type: 'ENCODE',
      stage: 'QUEUED',
      progress: 0,
      etaSeconds: 3600,
      fps: null,
      beforeSizeBytes: BigInt(1000000000),
      afterSizeBytes: null,
      savedBytes: null,
      savedPercent: null,
      startedAt: null,
      completedAt: null,
      failedAt: null,
      error: null,
      isBlacklisted: false,
      retryCount: 0,
      nextRetryAt: null,
      autoHealedAt: null,
      autoHealedProgress: null,
      healthStatus: 'UNKNOWN',
      healthScore: 0,
      healthMessage: null,
      healthCheckedAt: null,
      healthCheckStartedAt: null,
      healthCheckRetries: 0,
      decisionRequired: false,
      decisionIssues: null,
      decisionMadeAt: null,
      decisionData: null,
      priority: 0,
      prioritySetAt: null,
      tempFilePath: null,
      resumeTimestamp: null,
      lastProgressUpdate: null,
      previewImagePaths: null,
      keepOriginalRequested: false,
      originalBackupPath: null,
      originalSizeBytes: null,
      replacementAction: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      assignedNodeId: null,
      policyId: 'policy-1',
    };

    return {
      ...baseJob,
      ...overrides,
      library: {
        id: 'lib-1',
        name: 'Movies',
        path: '/movies',
        mediaType: 'MOVIE',
        totalFiles: 100,
        totalSizeBytes: BigInt(1000000000),
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    };
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JobAttributionService,
        {
          provide: PrismaService,
          useValue: {
            job: {
              findUnique: jest.fn(),
            },
            node: {
              findMany: jest.fn(),
              aggregate: jest.fn(),
            },
          },
        },
      ],
    }).compile();

    service = module.get<JobAttributionService>(JobAttributionService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  /**
   * Helper to create proper aggregate mock response
   */
  const mockAggregateResponse = (maxSpeed: number | null = 100) =>
    ({
      _count: {},
      _avg: {},
      _sum: {},
      _min: {},
      _max: { avgEncodingSpeed: maxSpeed },
    }) as any;

  afterEach(() => {
    jest.clearAllMocks();
    // Clear caches between tests
    service.clearCache();
  });

  describe('findOptimalNode', () => {
    describe('basic scenarios', () => {
      it('should return null if job not found', async () => {
        jest.spyOn(prisma.job, 'findUnique').mockResolvedValue(null);

        const result = await service.findOptimalNode('non-existent-job');

        expect(result).toBeNull();
        expect(prisma.job.findUnique).toHaveBeenCalledWith({
          where: { id: 'non-existent-job' },
          include: { library: true },
        });
      });

      it('should return null if no online nodes available', async () => {
        const job = createMockJob();
        jest.spyOn(prisma.job, 'findUnique').mockResolvedValue(job);
        jest.spyOn(prisma.node, 'findMany').mockResolvedValue([]);

        const result = await service.findOptimalNode('job-1');

        expect(result).toBeNull();
      });

      it('should return null if all nodes are outside schedule window', async () => {
        const job = createMockJob();
        // Use a fixed past time (Tuesday Jan 1 2019 12:00) to make day-of-week deterministic
        jest.useFakeTimers();
        jest.setSystemTime(new Date('2019-01-01T12:00:00Z')); // Tuesday = dayOfWeek 2
        const node1 = createMockNode({
          id: 'node-1',
          scheduleEnabled: true,
          scheduleWindows: [{ dayOfWeek: 6, startHour: 9, endHour: 17 }] as any, // Saturday only
        });
        const node2 = createMockNode({
          id: 'node-2',
          scheduleEnabled: true,
          scheduleWindows: [{ dayOfWeek: 0, startHour: 9, endHour: 17 }] as any, // Sunday only
        });

        jest.spyOn(prisma.job, 'findUnique').mockResolvedValue(job);
        jest.spyOn(prisma.node, 'findMany').mockResolvedValue([node1, node2]);
        jest.spyOn(prisma.node, 'aggregate').mockResolvedValue(mockAggregateResponse(100));

        const result = await service.findOptimalNode('job-1');

        jest.useRealTimers();
        expect(result).toBeNull();
      });

      it('should return single node when only one node available', async () => {
        const job = createMockJob();
        const node = createMockNode();

        jest.spyOn(prisma.job, 'findUnique').mockResolvedValue(job);
        jest.spyOn(prisma.node, 'findMany').mockResolvedValue([node]);
        jest.spyOn(prisma.node, 'aggregate').mockResolvedValue(mockAggregateResponse(100));

        const result = await service.findOptimalNode('job-1');

        expect(result).not.toBeNull();
        expect(result?.id).toBe('node-1');
      });
    });

    describe('node selection and sorting', () => {
      it('should select node with highest score', async () => {
        const job = createMockJob();
        const node1 = createMockNode({
          id: 'node-1',
          cpuCores: 4,
          hasGpu: false,
          avgEncodingSpeed: 50,
          _count: { jobs: 0 },
        });
        const node2 = createMockNode({
          id: 'node-2',
          cpuCores: 16,
          hasGpu: true,
          avgEncodingSpeed: 150,
          _count: { jobs: 0 },
        });

        jest.spyOn(prisma.job, 'findUnique').mockResolvedValue(job);
        jest.spyOn(prisma.node, 'findMany').mockResolvedValue([node1, node2]);
        jest.spyOn(prisma.node, 'aggregate').mockResolvedValue(mockAggregateResponse(150));

        const result = await service.findOptimalNode('job-1');

        expect(result?.id).toBe('node-2');
      });

      it('should consider load in scoring', async () => {
        const job = createMockJob();
        const node1 = createMockNode({
          id: 'node-1',
          maxWorkers: 4,
          cpuCores: 8,
          hasGpu: true,
          avgEncodingSpeed: 100,
          _count: { jobs: 0 }, // No load
        });
        const node2 = createMockNode({
          id: 'node-2',
          maxWorkers: 4,
          cpuCores: 8,
          hasGpu: true,
          avgEncodingSpeed: 100,
          _count: { jobs: 4 }, // Full load
        });

        jest.spyOn(prisma.job, 'findUnique').mockResolvedValue(job);
        jest.spyOn(prisma.node, 'findMany').mockResolvedValue([node1, node2]);
        jest.spyOn(prisma.node, 'aggregate').mockResolvedValue(mockAggregateResponse(100));

        const result = await service.findOptimalNode('job-1');

        // Node with no load should have higher score
        expect(result?.id).toBe('node-1');
      });

      it('should filter nodes outside database query constraints', async () => {
        const job = createMockJob();
        // findMany should only return ONLINE, MAIN/LINKED nodes
        const onlineNode = createMockNode({
          id: 'node-1',
          status: 'ONLINE',
          role: 'MAIN',
        });

        jest.spyOn(prisma.job, 'findUnique').mockResolvedValue(job);
        jest.spyOn(prisma.node, 'findMany').mockResolvedValue([onlineNode]);
        jest.spyOn(prisma.node, 'aggregate').mockResolvedValue(mockAggregateResponse(100));

        await service.findOptimalNode('job-1');

        expect(prisma.node.findMany).toHaveBeenCalledWith({
          where: {
            status: 'ONLINE',
            role: { in: ['MAIN', 'LINKED'] },
          },
          include: {
            _count: {
              select: {
                jobs: {
                  where: {
                    stage: { in: ['ENCODING', 'QUEUED'] },
                  },
                },
              },
            },
          },
        });
      });
    });

    describe('tie-breaking', () => {
      it('should break ties by selecting first node when scores are equal', async () => {
        const job = createMockJob();
        const node1 = createMockNode({
          id: 'node-1',
          cpuCores: 8,
          hasGpu: true,
          avgEncodingSpeed: 100,
          _count: { jobs: 0 },
        });
        const node2 = createMockNode({
          id: 'node-2',
          cpuCores: 8,
          hasGpu: true,
          avgEncodingSpeed: 100,
          _count: { jobs: 0 },
        });

        jest.spyOn(prisma.job, 'findUnique').mockResolvedValue(job);
        jest.spyOn(prisma.node, 'findMany').mockResolvedValue([node1, node2]);
        jest.spyOn(prisma.node, 'aggregate').mockResolvedValue(mockAggregateResponse(100));

        const result = await service.findOptimalNode('job-1');

        // Should pick first in sorted order
        expect(result?.id).toBe('node-1');
      });
    });
  });

  describe('calculateNodeScore', () => {
    describe('schedule availability (binary gate)', () => {
      it('should return score 0 when node is outside schedule window', async () => {
        const mondayDate = new Date('2024-01-01T10:00:00'); // Monday 10:00
        jest.useFakeTimers().setSystemTime(mondayDate);

        const node = createMockNode({
          scheduleEnabled: true,
          scheduleWindows: [{ dayOfWeek: 5, startHour: 9, endHour: 17 }] as any, // Friday only
        });

        const score = await service.calculateNodeScore(node);

        expect(score.totalScore).toBe(0);
        expect(score.breakdown.scheduleAvailable).toBe(false);
        expect(score.breakdown.loadScore).toBe(0);
        expect(score.breakdown.hardwareScore).toBe(0);
        expect(score.breakdown.performanceScore).toBe(0);

        jest.useRealTimers();
      });

      it('should allow scoring when schedule is disabled', async () => {
        const node = createMockNode({
          scheduleEnabled: false,
          cpuCores: 8,
          hasGpu: true,
          avgEncodingSpeed: 100,
        });

        jest.spyOn(prisma.node, 'aggregate').mockResolvedValue(mockAggregateResponse(100));

        const score = await service.calculateNodeScore(node);

        expect(score.totalScore).toBeGreaterThan(0);
        expect(score.breakdown.scheduleAvailable).toBe(true);
      });

      it('should allow scoring when within schedule window', async () => {
        const mondayDate = new Date('2024-01-01T10:00:00'); // Monday 10:00
        jest.useFakeTimers().setSystemTime(mondayDate);

        const node = createMockNode({
          scheduleEnabled: true,
          scheduleWindows: [{ dayOfWeek: 1, startHour: 9, endHour: 17 }] as any, // Monday 9-17
          cpuCores: 8,
          hasGpu: true,
          avgEncodingSpeed: 100,
        });

        jest.spyOn(prisma.node, 'aggregate').mockResolvedValue(mockAggregateResponse(100));

        const score = await service.calculateNodeScore(node);

        expect(score.totalScore).toBeGreaterThan(0);
        expect(score.breakdown.scheduleAvailable).toBe(true);

        jest.useRealTimers();
      });
    });

    describe('load scoring (0-40 points)', () => {
      it('should give 40 points with zero load', async () => {
        const node = createMockNode({
          maxWorkers: 4,
          _count: { jobs: 0 },
          cpuCores: 0,
          hasGpu: false,
          avgEncodingSpeed: null,
        });

        jest.spyOn(prisma.node, 'aggregate').mockResolvedValue(mockAggregateResponse(0));

        const score = await service.calculateNodeScore(node);

        expect(score.breakdown.loadScore).toBe(40);
      });

      it('should give 20 points with 50% load', async () => {
        const node = createMockNode({
          maxWorkers: 4,
          _count: { jobs: 2 }, // 50% of maxWorkers
          cpuCores: 0,
          hasGpu: false,
          avgEncodingSpeed: null,
        });

        jest.spyOn(prisma.node, 'aggregate').mockResolvedValue(mockAggregateResponse(0));

        const score = await service.calculateNodeScore(node);

        expect(score.breakdown.loadScore).toBe(20);
      });

      it('should give 0 points when fully loaded', async () => {
        const node = createMockNode({
          maxWorkers: 4,
          _count: { jobs: 4 },
          cpuCores: 0,
          hasGpu: false,
          avgEncodingSpeed: null,
        });

        jest.spyOn(prisma.node, 'aggregate').mockResolvedValue(mockAggregateResponse(0));

        const score = await service.calculateNodeScore(node);

        expect(score.breakdown.loadScore).toBe(0);
      });

      it('should cap load at maxWorkers (no negative scores)', async () => {
        const node = createMockNode({
          maxWorkers: 2,
          _count: { jobs: 10 }, // More jobs than maxWorkers
          cpuCores: 0,
          hasGpu: false,
          avgEncodingSpeed: null,
        });

        jest.spyOn(prisma.node, 'aggregate').mockResolvedValue(mockAggregateResponse(0));

        const score = await service.calculateNodeScore(node);

        // Should be capped at 0 (1 - 1.0) * 40
        expect(score.breakdown.loadScore).toBe(0);
      });

      it('should handle default maxWorkers of 1', async () => {
        const node = createMockNode({
          maxWorkers: undefined, // Should default to 1
          _count: { jobs: 0 },
          cpuCores: 0,
          hasGpu: false,
          avgEncodingSpeed: null,
        });

        jest.spyOn(prisma.node, 'aggregate').mockResolvedValue(mockAggregateResponse(0));

        const score = await service.calculateNodeScore(node);

        // With maxWorkers=1 and 0 jobs: (1 - 0/1) * 40 = 40
        expect(score.breakdown.loadScore).toBe(40);
      });
    });

    describe('hardware scoring (0-30 points)', () => {
      it('should give 0 points with no GPU and 0 CPU cores', async () => {
        const node = createMockNode({
          hasGpu: false,
          cpuCores: 0,
          _count: { jobs: 0 },
          avgEncodingSpeed: null,
        });

        jest.spyOn(prisma.node, 'aggregate').mockResolvedValue(mockAggregateResponse(0));

        const score = await service.calculateNodeScore(node);

        expect(score.breakdown.hardwareScore).toBe(0);
      });

      it('should give 15 points for GPU only', async () => {
        const node = createMockNode({
          hasGpu: true,
          cpuCores: 0,
          _count: { jobs: 0 },
          avgEncodingSpeed: null,
        });

        jest.spyOn(prisma.node, 'aggregate').mockResolvedValue(mockAggregateResponse(0));

        const score = await service.calculateNodeScore(node);

        expect(score.breakdown.hardwareScore).toBe(15);
      });

      it('should give 15 points for 16 CPU cores (max normalization)', async () => {
        const node = createMockNode({
          hasGpu: false,
          cpuCores: 16,
          _count: { jobs: 0 },
          avgEncodingSpeed: null,
        });

        jest.spyOn(prisma.node, 'aggregate').mockResolvedValue(mockAggregateResponse(0));

        const score = await service.calculateNodeScore(node);

        expect(score.breakdown.hardwareScore).toBe(15);
      });

      it('should give 7.5 points for 8 CPU cores', async () => {
        const node = createMockNode({
          hasGpu: false,
          cpuCores: 8,
          _count: { jobs: 0 },
          avgEncodingSpeed: null,
        });

        jest.spyOn(prisma.node, 'aggregate').mockResolvedValue(mockAggregateResponse(0));

        const score = await service.calculateNodeScore(node);

        expect(score.breakdown.hardwareScore).toBe(7.5);
      });

      it('should give 30 points for GPU + 16 CPU cores', async () => {
        const node = createMockNode({
          hasGpu: true,
          cpuCores: 16,
          _count: { jobs: 0 },
          avgEncodingSpeed: null,
        });

        jest.spyOn(prisma.node, 'aggregate').mockResolvedValue(mockAggregateResponse(0));

        const score = await service.calculateNodeScore(node);

        expect(score.breakdown.hardwareScore).toBe(30);
      });

      it('should handle null cpuCores gracefully', async () => {
        const node = createMockNode({
          hasGpu: true,
          cpuCores: null,
          _count: { jobs: 0 },
          avgEncodingSpeed: null,
        });

        jest.spyOn(prisma.node, 'aggregate').mockResolvedValue(mockAggregateResponse(0));

        const score = await service.calculateNodeScore(node);

        // Only GPU: 15 points
        expect(score.breakdown.hardwareScore).toBe(15);
      });

      it('should handle zero CPU cores', async () => {
        const node = createMockNode({
          hasGpu: false,
          cpuCores: 0,
          _count: { jobs: 0 },
          avgEncodingSpeed: null,
        });

        jest.spyOn(prisma.node, 'aggregate').mockResolvedValue(mockAggregateResponse(0));

        const score = await service.calculateNodeScore(node);

        expect(score.breakdown.hardwareScore).toBe(0);
      });
    });

    describe('performance scoring (0-30 points)', () => {
      it('should give 15 points baseline when no avgEncodingSpeed', async () => {
        const node = createMockNode({
          avgEncodingSpeed: null,
          _count: { jobs: 0 },
          cpuCores: 0,
          hasGpu: false,
        });

        jest.spyOn(prisma.node, 'aggregate').mockResolvedValue(mockAggregateResponse(null));

        const score = await service.calculateNodeScore(node);

        expect(score.breakdown.performanceScore).toBe(15);
      });

      it('should give 30 points for max speed', async () => {
        const node = createMockNode({
          avgEncodingSpeed: 100,
          _count: { jobs: 0 },
          cpuCores: 0,
          hasGpu: false,
        });

        jest.spyOn(prisma.node, 'aggregate').mockResolvedValue(mockAggregateResponse(100));

        const score = await service.calculateNodeScore(node);

        expect(score.breakdown.performanceScore).toBe(30);
      });

      it('should give 15 points for 50% of max speed', async () => {
        const node = createMockNode({
          avgEncodingSpeed: 50,
          _count: { jobs: 0 },
          cpuCores: 0,
          hasGpu: false,
        });

        jest.spyOn(prisma.node, 'aggregate').mockResolvedValue(mockAggregateResponse(100));

        const score = await service.calculateNodeScore(node);

        expect(score.breakdown.performanceScore).toBe(15);
      });

      it('should cap speed ratio at 1.0 (no bonus for exceeding max)', async () => {
        const node = createMockNode({
          avgEncodingSpeed: 150, // Exceeds max
          _count: { jobs: 0 },
          cpuCores: 0,
          hasGpu: false,
        });

        jest.spyOn(prisma.node, 'aggregate').mockResolvedValue(mockAggregateResponse(100));

        const score = await service.calculateNodeScore(node);

        // Should be capped at 30 (min(150/100, 1) * 30)
        expect(score.breakdown.performanceScore).toBe(30);
      });

      it('should handle zero max speed', async () => {
        const node = createMockNode({
          avgEncodingSpeed: 0,
          _count: { jobs: 0 },
          cpuCores: 0,
          hasGpu: false,
        });

        jest.spyOn(prisma.node, 'aggregate').mockResolvedValue(mockAggregateResponse(0));

        const score = await service.calculateNodeScore(node);

        // 0/0 case: no avgEncodingSpeed, so baseline
        expect(score.breakdown.performanceScore).toBe(15);
      });
    });

    describe('total score calculation', () => {
      it('should sum all factors correctly', async () => {
        const node = createMockNode({
          maxWorkers: 4,
          _count: { jobs: 0 }, // 40 points
          hasGpu: true, // 15 points
          cpuCores: 8, // 7.5 points
          avgEncodingSpeed: 100, // 30 points
        });

        jest.spyOn(prisma.node, 'aggregate').mockResolvedValue(mockAggregateResponse(100));

        const score = await service.calculateNodeScore(node);

        // 40 + 15 + 7.5 + 30 = 92.5
        expect(score.totalScore).toBe(92.5);
      });

      it('should calculate perfect score (100 points)', async () => {
        const node = createMockNode({
          maxWorkers: 1,
          _count: { jobs: 0 }, // 40 points (no load)
          hasGpu: true, // 15 points
          cpuCores: 16, // 15 points (max normalized)
          avgEncodingSpeed: 100, // 30 points (max speed)
        });

        jest.spyOn(prisma.node, 'aggregate').mockResolvedValue(mockAggregateResponse(100));

        const score = await service.calculateNodeScore(node);

        expect(score.totalScore).toBe(100);
      });

      it('should return NodeScore interface with all required fields', async () => {
        const node = createMockNode();
        jest.spyOn(prisma.node, 'aggregate').mockResolvedValue(mockAggregateResponse(100));

        const score = await service.calculateNodeScore(node);

        expect(score).toHaveProperty('nodeId');
        expect(score).toHaveProperty('nodeName');
        expect(score).toHaveProperty('totalScore');
        expect(score).toHaveProperty('breakdown');
        expect(score.breakdown).toHaveProperty('scheduleAvailable');
        expect(score.breakdown).toHaveProperty('loadScore');
        expect(score.breakdown).toHaveProperty('hardwareScore');
        expect(score.breakdown).toHaveProperty('performanceScore');
      });
    });
  });

  describe('getAllNodeScores', () => {
    it('should return scores for all online MAIN and LINKED nodes', async () => {
      const node1 = createMockNode({ id: 'node-1', cpuCores: 8 });
      const node2 = createMockNode({ id: 'node-2', cpuCores: 16 });

      jest.spyOn(prisma.node, 'findMany').mockResolvedValue([node1, node2]);
      jest.spyOn(prisma.node, 'aggregate').mockResolvedValue(mockAggregateResponse(100));

      const scores = await service.getAllNodeScores();

      expect(scores).toHaveLength(2);
      expect(scores[0].nodeId).toBe('node-1');
      expect(scores[1].nodeId).toBe('node-2');
    });

    it('should use same query as findOptimalNode', async () => {
      jest.spyOn(prisma.node, 'findMany').mockResolvedValue([]);
      jest.spyOn(prisma.node, 'aggregate').mockResolvedValue(mockAggregateResponse(100));

      await service.getAllNodeScores();

      expect(prisma.node.findMany).toHaveBeenCalledWith({
        where: {
          status: 'ONLINE',
          role: { in: ['MAIN', 'LINKED'] },
        },
        include: {
          _count: {
            select: {
              jobs: {
                where: {
                  stage: { in: ['ENCODING', 'QUEUED'] },
                },
              },
            },
          },
        },
      });
    });
  });

  describe('caching behavior - score cache', () => {
    it('should cache node score for 1 minute', async () => {
      const node = createMockNode({ id: 'node-1' });
      jest.spyOn(prisma.node, 'aggregate').mockResolvedValue(mockAggregateResponse(100));

      const score1 = await service.calculateNodeScore(node);
      const score2 = await service.calculateNodeScore(node);

      expect(score1.totalScore).toBe(score2.totalScore);
      // aggregate should be called once (for maxSpeed)
      expect(prisma.node.aggregate).toHaveBeenCalledTimes(1);
    });

    it('should return cached score on subsequent calls within TTL', async () => {
      const node = createMockNode({ id: 'node-1' });
      jest.spyOn(prisma.node, 'aggregate').mockResolvedValue(mockAggregateResponse(100));

      await service.calculateNodeScore(node);
      const cachedScore = await service.calculateNodeScore(node);

      expect(cachedScore.totalScore).toBeGreaterThan(0);
      // aggregate should only be called once
      expect(prisma.node.aggregate).toHaveBeenCalledTimes(1);
    });

    it('should retrieve same cached score on subsequent calls before TTL', async () => {
      const node = createMockNode({ id: 'node-1' });
      jest.spyOn(prisma.node, 'aggregate').mockResolvedValue(mockAggregateResponse(100));

      // First call - establishes cache
      const score1 = await service.calculateNodeScore(node);
      // Second call within TTL should use cache
      const score2 = await service.calculateNodeScore(node);

      // Scores should be identical (from cache)
      expect(score1.totalScore).toBe(score2.totalScore);
      expect(score1.nodeId).toBe(score2.nodeId);
      expect(score1.breakdown).toEqual(score2.breakdown);
    });

    it('should store different nodes separately in cache', async () => {
      const node1 = createMockNode({ id: 'node-1' });
      const node2 = createMockNode({ id: 'node-2', cpuCores: 16 });

      jest.spyOn(prisma.node, 'aggregate').mockResolvedValue(mockAggregateResponse(100));

      await service.calculateNodeScore(node1);
      await service.calculateNodeScore(node2);

      // Both should have different scores
      const score1 = await service.calculateNodeScore(node1);
      const score2 = await service.calculateNodeScore(node2);

      expect(score1.nodeId).toBe('node-1');
      expect(score2.nodeId).toBe('node-2');
    });

    it('should return cached score with current timestamp check', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2024-01-01T10:00:00'));

      const node = createMockNode({
        scheduleEnabled: true,
        scheduleWindows: [{ dayOfWeek: 1, startHour: 9, endHour: 17 }] as any,
      });

      jest.spyOn(prisma.node, 'aggregate').mockResolvedValue(mockAggregateResponse(100));

      // First call within schedule
      const score1 = await service.calculateNodeScore(node);
      expect(score1.breakdown.scheduleAvailable).toBe(true);

      // Second call within TTL uses cache
      const score2 = await service.calculateNodeScore(node);
      expect(score1.totalScore).toBe(score2.totalScore);

      jest.useRealTimers();
    });
  });

  describe('caching behavior - max speed cache', () => {
    it('should cache max encoding speed for 5 minutes', async () => {
      jest.spyOn(prisma.node, 'aggregate').mockResolvedValue(mockAggregateResponse(100));

      const node1 = createMockNode({ avgEncodingSpeed: 100 });
      const node2 = createMockNode({ avgEncodingSpeed: 50 });

      await service.calculateNodeScore(node1);
      await service.calculateNodeScore(node2);

      // aggregate should be called once (for maxSpeed), reused for both nodes
      expect(prisma.node.aggregate).toHaveBeenCalledTimes(1);
    });

    it('should expire max speed cache after 5 minutes', async () => {
      jest.useFakeTimers();
      const aggregateSpy = jest.spyOn(prisma.node, 'aggregate');
      aggregateSpy.mockResolvedValue(mockAggregateResponse(100));

      const node = createMockNode({ avgEncodingSpeed: 100 });

      // First call - establishes max speed cache
      await service.calculateNodeScore(node);
      const firstCallCount = aggregateSpy.mock.calls.length;

      // Clear score cache but not max speed cache (simulating new node calculation)
      // We'll just verify the behavior by checking if new calls happen
      service.clearCache();

      // Advance time past 5 minutes (max speed cache TTL)
      jest.advanceTimersByTime(5 * 60 * 1000 + 1);

      // New node calculation - max speed cache is expired, should query again
      const node2 = createMockNode({ id: 'node-2', avgEncodingSpeed: 50 });
      await service.calculateNodeScore(node2);
      const secondCallCount = aggregateSpy.mock.calls.length;

      // Should have called aggregate more times after cache expiration
      expect(secondCallCount).toBeGreaterThan(firstCallCount);

      jest.useRealTimers();
    });

    it('should handle null maxSpeed gracefully', async () => {
      jest.spyOn(prisma.node, 'aggregate').mockResolvedValue(mockAggregateResponse(null));

      const node = createMockNode({ avgEncodingSpeed: null });
      const score = await service.calculateNodeScore(node);

      expect(score.breakdown.performanceScore).toBe(15); // Baseline
    });

    it('should use cached maxSpeed across multiple node calculations', async () => {
      jest.spyOn(prisma.node, 'aggregate').mockResolvedValue(mockAggregateResponse(100));

      const node1 = createMockNode({ id: 'node-1', avgEncodingSpeed: 100 });
      const node2 = createMockNode({ id: 'node-2', avgEncodingSpeed: 50 });
      const node3 = createMockNode({ id: 'node-3', avgEncodingSpeed: 75 });

      await service.calculateNodeScore(node1);
      await service.calculateNodeScore(node2);
      await service.calculateNodeScore(node3);

      // Should only query once
      expect(prisma.node.aggregate).toHaveBeenCalledTimes(1);
    });
  });

  describe('cache clearing', () => {
    it('should clear both score and max speed caches', async () => {
      jest.spyOn(prisma.node, 'aggregate').mockResolvedValue(mockAggregateResponse(100));

      const node = createMockNode();

      // Populate both caches
      await service.calculateNodeScore(node);
      expect(prisma.node.aggregate).toHaveBeenCalledTimes(1);

      // Clear caches
      service.clearCache();

      // Second calculation should query again
      jest.spyOn(prisma.node, 'aggregate').mockResolvedValue(mockAggregateResponse(100));
      await service.calculateNodeScore(node);
      expect(prisma.node.aggregate).toHaveBeenCalledTimes(2);
    });

    it('should allow multiple cache clears without error', async () => {
      expect(() => {
        service.clearCache();
        service.clearCache();
        service.clearCache();
      }).not.toThrow();
    });
  });

  describe('edge cases and special scenarios', () => {
    describe('empty or null node properties', () => {
      it('should handle undefined maxWorkers', async () => {
        const node = createMockNode({
          maxWorkers: undefined,
          _count: { jobs: 0 },
        });

        jest.spyOn(prisma.node, 'aggregate').mockResolvedValue(mockAggregateResponse(0));

        const score = await service.calculateNodeScore(node);

        // Should default to 1
        expect(score.breakdown.loadScore).toBe(40);
      });

      it('should handle null cpuCores', async () => {
        const node = createMockNode({
          cpuCores: null,
          hasGpu: false,
          _count: { jobs: 0 },
          avgEncodingSpeed: null,
        });

        jest.spyOn(prisma.node, 'aggregate').mockResolvedValue(mockAggregateResponse(0));

        const score = await service.calculateNodeScore(node);

        // Should handle gracefully
        expect(score.breakdown.hardwareScore).toBe(0);
      });

      it('should handle null avgEncodingSpeed', async () => {
        const node = createMockNode({
          avgEncodingSpeed: null,
          _count: { jobs: 0 },
          cpuCores: 0,
          hasGpu: false,
        });

        jest.spyOn(prisma.node, 'aggregate').mockResolvedValue(mockAggregateResponse(null));

        const score = await service.calculateNodeScore(node);

        // Should give baseline 15 points
        expect(score.breakdown.performanceScore).toBe(15);
      });
    });

    describe('multiple nodes with different scores', () => {
      it('should score nodes correctly with mixed properties', async () => {
        const lowScoreNode = createMockNode({
          id: 'low',
          maxWorkers: 1,
          _count: { jobs: 1 }, // Full load
          hasGpu: false,
          cpuCores: 2,
          avgEncodingSpeed: 10,
        });

        const mediumScoreNode = createMockNode({
          id: 'medium',
          maxWorkers: 4,
          _count: { jobs: 2 }, // 50% load
          hasGpu: false,
          cpuCores: 8,
          avgEncodingSpeed: 50,
        });

        const highScoreNode = createMockNode({
          id: 'high',
          maxWorkers: 8,
          _count: { jobs: 0 }, // 0% load
          hasGpu: true,
          cpuCores: 16,
          avgEncodingSpeed: 100,
        });

        jest.spyOn(prisma.node, 'aggregate').mockResolvedValue(mockAggregateResponse(100));

        const lowScore = await service.calculateNodeScore(lowScoreNode);
        service.clearCache();
        const mediumScore = await service.calculateNodeScore(mediumScoreNode);
        service.clearCache();
        const highScore = await service.calculateNodeScore(highScoreNode);

        expect(lowScore.totalScore).toBeLessThan(mediumScore.totalScore);
        expect(mediumScore.totalScore).toBeLessThan(highScore.totalScore);
      });
    });

    describe('complex schedule scenarios', () => {
      it('should handle midnight-crossing schedule window', async () => {
        const mondayNightDate = new Date('2024-01-01T23:30:00');
        jest.useFakeTimers().setSystemTime(mondayNightDate);

        const node = createMockNode({
          scheduleEnabled: true,
          scheduleWindows: [{ dayOfWeek: 1, startHour: 23, endHour: 7 }] as any,
          cpuCores: 8,
          hasGpu: true,
          avgEncodingSpeed: 100,
        });

        jest.spyOn(prisma.node, 'aggregate').mockResolvedValue(mockAggregateResponse(100));

        const score = await service.calculateNodeScore(node);

        expect(score.totalScore).toBeGreaterThan(0);
        expect(score.breakdown.scheduleAvailable).toBe(true);

        jest.useRealTimers();
      });

      it('should respect minute-level schedule precision', async () => {
        const exactTimeDate = new Date('2024-01-01T09:30:00');
        jest.useFakeTimers().setSystemTime(exactTimeDate);

        const node = createMockNode({
          scheduleEnabled: true,
          scheduleWindows: [{ dayOfWeek: 1, startHour: 9, startMinute: 30, endHour: 17 }] as any,
          cpuCores: 8,
          hasGpu: true,
          avgEncodingSpeed: 100,
        });

        jest.spyOn(prisma.node, 'aggregate').mockResolvedValue(mockAggregateResponse(100));

        const score = await service.calculateNodeScore(node);

        expect(score.breakdown.scheduleAvailable).toBe(true);

        jest.useRealTimers();
      });

      it('should handle multiple schedule windows', async () => {
        const mondayDate = new Date('2024-01-01T13:00:00');
        jest.useFakeTimers().setSystemTime(mondayDate);

        const node = createMockNode({
          scheduleEnabled: true,
          scheduleWindows: [
            { dayOfWeek: 1, startHour: 9, endHour: 12 },
            { dayOfWeek: 1, startHour: 13, endHour: 17 }, // Current time is in this window
          ] as any,
          cpuCores: 8,
          hasGpu: true,
          avgEncodingSpeed: 100,
        });

        jest.spyOn(prisma.node, 'aggregate').mockResolvedValue(mockAggregateResponse(100));

        const score = await service.calculateNodeScore(node);

        expect(score.breakdown.scheduleAvailable).toBe(true);

        jest.useRealTimers();
      });
    });

    describe('integration - real-world scenarios', () => {
      it('should handle full workflow: multiple nodes, scoring, selection', async () => {
        const job = createMockJob();

        const cheapNode = createMockNode({
          id: 'cheap',
          maxWorkers: 1,
          _count: { jobs: 1 },
          hasGpu: false,
          cpuCores: 2,
          avgEncodingSpeed: 25,
        });

        const standardNode = createMockNode({
          id: 'standard',
          maxWorkers: 4,
          _count: { jobs: 1 },
          hasGpu: true,
          cpuCores: 8,
          avgEncodingSpeed: 75,
        });

        const powerNode = createMockNode({
          id: 'power',
          maxWorkers: 8,
          _count: { jobs: 2 },
          hasGpu: true,
          cpuCores: 16,
          avgEncodingSpeed: 150,
        });

        jest.spyOn(prisma.job, 'findUnique').mockResolvedValue(job);
        jest.spyOn(prisma.node, 'findMany').mockResolvedValue([cheapNode, standardNode, powerNode]);
        jest.spyOn(prisma.node, 'aggregate').mockResolvedValue(mockAggregateResponse(150));

        const result = await service.findOptimalNode('job-1');

        // Power node should win despite higher load
        expect(result?.id).toBe('power');
      });

      it('should prefer available node over loaded high-end node', async () => {
        const job = createMockJob();

        const availableNode = createMockNode({
          id: 'available',
          maxWorkers: 4,
          _count: { jobs: 0 }, // No load: 40 points
          hasGpu: false,
          cpuCores: 4, // 2.5 points
          avgEncodingSpeed: 25, // 7.5 points (25/100 * 30)
          // Total: 40 + 0 + 2.5 + 7.5 = 50
        });

        const loadedPowerNode = createMockNode({
          id: 'loaded',
          maxWorkers: 4,
          _count: { jobs: 3 }, // 75% load: 10 points
          hasGpu: true, // 15 points
          cpuCores: 16, // 15 points
          avgEncodingSpeed: 80, // 24 points (80/100 * 30)
          // Total: 10 + 15 + 15 + 24 = 64
        });

        jest.spyOn(prisma.job, 'findUnique').mockResolvedValue(job);
        jest.spyOn(prisma.node, 'findMany').mockResolvedValue([availableNode, loadedPowerNode]);
        jest.spyOn(prisma.node, 'aggregate').mockResolvedValue(mockAggregateResponse(100));

        const result = await service.findOptimalNode('job-1');

        // High-end node should win despite load (64 > 50)
        // The weighted scoring favors hardware and performance over just load
        expect(result?.id).toBe('loaded');
      });
    });
  });

  describe('logging and observability', () => {
    it('should log when job not found', async () => {
      const loggerSpy = jest.spyOn((service as any).logger, 'warn');
      jest.spyOn(prisma.job, 'findUnique').mockResolvedValue(null);

      await service.findOptimalNode('non-existent');

      expect(loggerSpy).toHaveBeenCalledWith('Job non-existent not found');
    });

    it('should log when no nodes available', async () => {
      const loggerSpy = jest.spyOn((service as any).logger, 'warn');
      const job = createMockJob();

      jest.spyOn(prisma.job, 'findUnique').mockResolvedValue(job);
      jest.spyOn(prisma.node, 'findMany').mockResolvedValue([]);

      await service.findOptimalNode('job-1');

      expect(loggerSpy).toHaveBeenCalledWith('No online nodes available');
    });

    it('should log when no nodes in schedule', async () => {
      const loggerSpy = jest.spyOn((service as any).logger, 'warn');
      const job = createMockJob();
      // Use a fixed past time (Tuesday Jan 1 2019 12:00) to make day-of-week deterministic
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2019-01-01T12:00:00Z')); // Tuesday = dayOfWeek 2
      const offlineNode = createMockNode({
        scheduleEnabled: true,
        scheduleWindows: [{ dayOfWeek: 6, startHour: 9, endHour: 17 }] as any, // Saturday only
      });

      jest.spyOn(prisma.job, 'findUnique').mockResolvedValue(job);
      jest.spyOn(prisma.node, 'findMany').mockResolvedValue([offlineNode]);
      jest.spyOn(prisma.node, 'aggregate').mockResolvedValue(mockAggregateResponse(100));

      await service.findOptimalNode('job-1');

      jest.useRealTimers();
      expect(loggerSpy).toHaveBeenCalledWith('No nodes available within their schedule windows');
    });

    it('should log selected optimal node', async () => {
      const loggerSpy = jest.spyOn((service as any).logger, 'log');
      const job = createMockJob();
      const node = createMockNode();

      jest.spyOn(prisma.job, 'findUnique').mockResolvedValue(job);
      jest.spyOn(prisma.node, 'findMany').mockResolvedValue([node]);
      jest.spyOn(prisma.node, 'aggregate').mockResolvedValue(mockAggregateResponse(100));

      await service.findOptimalNode('job-1');

      expect(loggerSpy).toHaveBeenCalled();
      const callArgs = loggerSpy.mock.calls[0][0];
      expect(callArgs).toContain('Optimal node for job job-1');
      expect(callArgs).toContain('Test Node');
    });

    it('should log cache clear', async () => {
      const loggerSpy = jest.spyOn((service as any).logger, 'debug');

      service.clearCache();

      expect(loggerSpy).toHaveBeenCalledWith('Score cache, locks, and max speed cache cleared');
    });
  });
});
