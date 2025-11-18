import { Logger } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import type { Job, Node } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import * as scheduleChecker from '../../utils/schedule-checker';
import { JobAttributionService, type NodeScore } from '../job-attribution.service';
import { ScheduleEnforcementService } from '../schedule-enforcement.service';

/**
 * Mock data factories
 */
const createMockNode = (overrides?: Partial<Node>): Node & { _count?: { jobs: number } } => ({
  id: 'node-1',
  name: 'Main Node',
  status: 'ONLINE',
  role: 'MAIN',
  version: '1.0.0',
  acceleration: 'CPU',
  pairingToken: null,
  pairingExpiresAt: null,
  mainNodeUrl: null,
  apiKey: 'test-key',
  lastHeartbeat: new Date(),
  uptimeSeconds: 3600,
  maxWorkers: 4,
  cpuLimit: 80,
  lastSyncedAt: null,
  syncStatus: 'COMPLETED',
  syncRetryCount: 0,
  syncError: null,
  networkLocation: 'LOCAL',
  hasSharedStorage: false,
  storageBasePath: null,
  ipAddress: '192.168.1.1',
  publicUrl: null,
  vpnIpAddress: null,
  maxTransferSizeMB: 50000,
  cpuCores: 8,
  ramGB: 16,
  bandwidthMbps: 1000,
  latencyMs: 5,
  lastSpeedTest: null,
  hasGpu: true,
  avgEncodingSpeed: 25.5,
  scheduleEnabled: false,
  scheduleWindows: null,
  licenseId: 'license-1',
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

const createMockJob = (overrides?: Partial<Job>): Job & { node?: Partial<Node> } => ({
  id: 'job-1',
  libraryId: 'lib-1',
  type: 'ENCODE',
  filePath: '/media/test.mkv',
  fileLabel: 'test.mkv',
  sourceCodec: 'H.264',
  sourceContainer: 'mkv',
  targetCodec: 'HEVC',
  targetContainer: 'mkv',
  stage: 'QUEUED',
  progress: 0,
  etaSeconds: null,
  fps: null,
  beforeSizeBytes: BigInt(1024000000),
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
  priority: 5,
  prioritySetAt: null,
  tempFilePath: null,
  resumeTimestamp: null,
  lastProgressUpdate: null,
  previewImagePaths: null,
  keepOriginalRequested: false,
  originalBackupPath: null,
  originalSizeBytes: null,
  replacementAction: null,
  warning: null,
  resourceThrottled: false,
  resourceThrottleReason: null,
  ffmpegThreads: null,
  startedFromSeconds: null,
  healingPointSeconds: null,
  nodeId: 'node-1',
  originalNodeId: null,
  manualAssignment: false,
  policyId: 'policy-1',
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

const createMockNodeScore = (
  nodeId: string,
  totalScore: number,
  overrides?: Partial<NodeScore>
): NodeScore => ({
  nodeId,
  nodeName: `Node ${nodeId}`,
  totalScore,
  breakdown: {
    scheduleAvailable: true,
    loadScore: 20,
    hardwareScore: 20,
    performanceScore: 20,
  },
  ...overrides,
});

describe('ScheduleEnforcementService', () => {
  let service: ScheduleEnforcementService;
  let _prisma: PrismaService;
  let _jobAttribution: JobAttributionService;

  const mockPrismaService = {
    job: {
      findMany: jest.fn(),
      updateMany: jest.fn(),
    },
    node: {
      findMany: jest.fn(),
    },
    $executeRawUnsafe: jest.fn(),
  };

  const mockJobAttributionService = {
    calculateNodeScore: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ScheduleEnforcementService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
        {
          provide: JobAttributionService,
          useValue: mockJobAttributionService,
        },
      ],
    }).compile();

    service = module.get<ScheduleEnforcementService>(ScheduleEnforcementService);
    _prisma = module.get<PrismaService>(PrismaService);
    _jobAttribution = module.get<JobAttributionService>(JobAttributionService);

    // Mock logger to prevent console output during tests
    jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => {});
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});

    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ============================================================================
  // enforceSchedules() Tests
  // ============================================================================

  describe('enforceSchedules', () => {
    it('should pause jobs outside their schedule windows', async () => {
      const nodeInWindow = createMockNode({ id: 'node-1', scheduleEnabled: false });
      const nodeOutOfWindow = createMockNode({
        id: 'node-2',
        scheduleEnabled: true,
        scheduleWindows: JSON.stringify([
          { dayOfWeek: 1, startHour: 9, endHour: 17 }, // Monday 9-5
        ]),
      });

      const jobInWindow = createMockJob({
        id: 'job-1',
        stage: 'ENCODING',
        nodeId: 'node-1',
      }) as any;
      jobInWindow.node = nodeInWindow;

      const jobOutOfWindow = createMockJob({
        id: 'job-2',
        stage: 'ENCODING',
        nodeId: 'node-2',
      }) as any;
      jobOutOfWindow.node = nodeOutOfWindow;

      mockPrismaService.job.findMany.mockResolvedValue([jobInWindow, jobOutOfWindow]);

      // Mock isNodeInAllowedWindow to return true for node-1, false for node-2
      jest.spyOn(scheduleChecker, 'isNodeInAllowedWindow').mockImplementation((node: any) => {
        if (node.id === 'node-1') return true;
        if (node.id === 'node-2') return false;
        return true;
      });

      await service.enforceSchedules();

      // Should call updateMany with only job-2
      expect(mockPrismaService.job.updateMany).toHaveBeenCalledWith({
        where: {
          id: { in: ['job-2'] },
        },
        data: {
          stage: 'PAUSED',
        },
      });
    });

    it('should not call updateMany if all jobs are in schedule', async () => {
      const node = createMockNode({ id: 'node-1', scheduleEnabled: false });
      const job = createMockJob({
        id: 'job-1',
        stage: 'ENCODING',
      }) as any;
      job.node = node;

      mockPrismaService.job.findMany.mockResolvedValue([job]);

      jest.spyOn(scheduleChecker, 'isNodeInAllowedWindow').mockReturnValue(true);

      await service.enforceSchedules();

      // Should not call updateMany
      expect(mockPrismaService.job.updateMany).not.toHaveBeenCalled();
    });

    it('should handle empty job list', async () => {
      mockPrismaService.job.findMany.mockResolvedValue([]);

      await service.enforceSchedules();

      expect(mockPrismaService.job.findMany).toHaveBeenCalledWith({
        where: {
          stage: 'ENCODING',
        },
        include: {
          node: true,
        },
      });

      expect(mockPrismaService.job.updateMany).not.toHaveBeenCalled();
    });

    it('should pause multiple jobs in a single batch update', async () => {
      const node = createMockNode({
        id: 'node-out',
        scheduleEnabled: true,
        scheduleWindows: JSON.stringify([{ dayOfWeek: 1, startHour: 9, endHour: 17 }]),
      });

      const jobs = [
        createMockJob({
          id: 'job-1',
          stage: 'ENCODING',
          nodeId: 'node-out',
        }) as any,
        createMockJob({
          id: 'job-2',
          stage: 'ENCODING',
          nodeId: 'node-out',
        }) as any,
        createMockJob({
          id: 'job-3',
          stage: 'ENCODING',
          nodeId: 'node-out',
        }) as any,
      ];

      jobs.forEach((job) => {
        job.node = node;
      });

      mockPrismaService.job.findMany.mockResolvedValue(jobs);

      jest.spyOn(scheduleChecker, 'isNodeInAllowedWindow').mockReturnValue(false);

      await service.enforceSchedules();

      expect(mockPrismaService.job.updateMany).toHaveBeenCalledWith({
        where: {
          id: { in: ['job-1', 'job-2', 'job-3'] },
        },
        data: {
          stage: 'PAUSED',
        },
      });

      expect(mockPrismaService.job.updateMany).toHaveBeenCalledTimes(1);
    });

    it('should handle errors gracefully', async () => {
      const error = new Error('Database connection failed');
      mockPrismaService.job.findMany.mockRejectedValue(error);

      const errorSpy = jest.spyOn(Logger.prototype, 'error');

      await service.enforceSchedules();

      expect(errorSpy).toHaveBeenCalledWith('Error enforcing schedules:', error);
    });

    it('should query only ENCODING stage jobs', async () => {
      mockPrismaService.job.findMany.mockResolvedValue([]);

      await service.enforceSchedules();

      expect(mockPrismaService.job.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            stage: 'ENCODING',
          },
        })
      );
    });

    it('should include node data in the query', async () => {
      mockPrismaService.job.findMany.mockResolvedValue([]);

      await service.enforceSchedules();

      expect(mockPrismaService.job.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          include: {
            node: true,
          },
        })
      );
    });
  });

  // ============================================================================
  // autoAssignQueuedJobs() Tests
  // ============================================================================

  describe('autoAssignQueuedJobs', () => {
    it('should return early if no queued jobs exist', async () => {
      mockPrismaService.job.findMany.mockResolvedValue([]);

      await service.autoAssignQueuedJobs();

      expect(mockPrismaService.job.findMany).toHaveBeenCalled();
      expect(mockPrismaService.node.findMany).not.toHaveBeenCalled();
      expect(mockJobAttributionService.calculateNodeScore).not.toHaveBeenCalled();
      expect(mockPrismaService.$executeRawUnsafe).not.toHaveBeenCalled();
    });

    it('should return early if no online nodes exist', async () => {
      const job = createMockJob({ id: 'job-1', stage: 'QUEUED' });
      mockPrismaService.job.findMany.mockResolvedValue([job]);
      mockPrismaService.node.findMany.mockResolvedValue([]);

      await service.autoAssignQueuedJobs();

      expect(mockPrismaService.node.findMany).toHaveBeenCalled();
      expect(mockJobAttributionService.calculateNodeScore).not.toHaveBeenCalled();
      expect(mockPrismaService.$executeRawUnsafe).not.toHaveBeenCalled();
    });

    it('should fetch nodes only once', async () => {
      const job1 = createMockJob({ id: 'job-1', stage: 'QUEUED' });
      const job2 = createMockJob({ id: 'job-2', stage: 'QUEUED' });

      mockPrismaService.job.findMany.mockResolvedValue([job1, job2]);

      const node = createMockNode() as any;
      (node as any)._count = { jobs: 2 };
      mockPrismaService.node.findMany.mockResolvedValue([node]);

      const nodeScore = createMockNodeScore('node-1', 50);
      mockJobAttributionService.calculateNodeScore.mockResolvedValue(nodeScore);

      await service.autoAssignQueuedJobs();

      // Should call findMany only once for nodes
      expect(mockPrismaService.node.findMany).toHaveBeenCalledTimes(1);
    });

    it('should calculate node scores only once per node', async () => {
      const job1 = createMockJob({ id: 'job-1', stage: 'QUEUED' });
      const job2 = createMockJob({ id: 'job-2', stage: 'QUEUED' });

      mockPrismaService.job.findMany.mockResolvedValue([job1, job2]);

      const node1 = createMockNode({ id: 'node-1' });
      (node1 as any)._count = { jobs: 1 };
      const node2 = createMockNode({ id: 'node-2' });
      (node2 as any)._count = { jobs: 2 };

      mockPrismaService.node.findMany.mockResolvedValue([node1, node2]);

      const score1 = createMockNodeScore('node-1', 60);
      const score2 = createMockNodeScore('node-2', 40);

      mockJobAttributionService.calculateNodeScore
        .mockResolvedValueOnce(score1)
        .mockResolvedValueOnce(score2);

      await service.autoAssignQueuedJobs();

      // Should calculate score for each node only once
      expect(mockJobAttributionService.calculateNodeScore).toHaveBeenCalledTimes(2);
    });

    it('should move job to highest scoring node using batch SQL CASE statement', async () => {
      const job1 = createMockJob({
        id: 'job-1',
        stage: 'QUEUED',
        nodeId: 'node-1',
        originalNodeId: null,
      });

      mockPrismaService.job.findMany.mockResolvedValue([job1]);

      const node1 = createMockNode({ id: 'node-1' });
      (node1 as any)._count = { jobs: 5 }; // High load
      const node2 = createMockNode({ id: 'node-2' });
      (node2 as any)._count = { jobs: 1 }; // Low load

      mockPrismaService.node.findMany.mockResolvedValue([node1, node2]);

      const score1 = createMockNodeScore('node-1', 20); // Lower score
      const score2 = createMockNodeScore('node-2', 80); // Higher score

      mockJobAttributionService.calculateNodeScore
        .mockResolvedValueOnce(score1)
        .mockResolvedValueOnce(score2);

      await service.autoAssignQueuedJobs();

      // Should execute raw SQL with CASE statement
      expect(mockPrismaService.$executeRawUnsafe).toHaveBeenCalled();

      const sqlCall = (mockPrismaService.$executeRawUnsafe as jest.Mock).mock.calls[0][0];

      // Verify SQL structure contains CASE statement
      expect(sqlCall).toContain('UPDATE Job');
      expect(sqlCall).toContain('CASE id');
      expect(sqlCall).toContain(`WHEN 'job-1' THEN 'node-2'`);
      expect(sqlCall).toContain('WHERE id IN');
    });

    it('should not move job if already on optimal node', async () => {
      const job = createMockJob({
        id: 'job-1',
        stage: 'QUEUED',
        nodeId: 'node-1',
      });

      mockPrismaService.job.findMany.mockResolvedValue([job]);

      const node1 = createMockNode({ id: 'node-1' });
      (node1 as any)._count = { jobs: 1 };
      const node2 = createMockNode({ id: 'node-2' });
      (node2 as any)._count = { jobs: 2 };

      mockPrismaService.node.findMany.mockResolvedValue([node1, node2]);

      // Node 1 has highest score
      const score1 = createMockNodeScore('node-1', 80);
      const score2 = createMockNodeScore('node-2', 50);

      mockJobAttributionService.calculateNodeScore
        .mockResolvedValueOnce(score1)
        .mockResolvedValueOnce(score2);

      await service.autoAssignQueuedJobs();

      // Should not execute raw SQL update
      expect(mockPrismaService.$executeRawUnsafe).not.toHaveBeenCalled();
    });

    it('should skip nodes with zero score', async () => {
      const job = createMockJob({
        id: 'job-1',
        stage: 'QUEUED',
        nodeId: undefined,
      });

      mockPrismaService.job.findMany.mockResolvedValue([job]);

      const node1 = createMockNode({ id: 'node-1' });
      (node1 as any)._count = { jobs: 0 };
      const node2 = createMockNode({ id: 'node-2' });
      (node2 as any)._count = { jobs: 0 };

      mockPrismaService.node.findMany.mockResolvedValue([node1, node2]);

      // Both nodes have zero score (outside schedule)
      const score1 = createMockNodeScore('node-1', 0);
      const score2 = createMockNodeScore('node-2', 0);

      mockJobAttributionService.calculateNodeScore
        .mockResolvedValueOnce(score1)
        .mockResolvedValueOnce(score2);

      await service.autoAssignQueuedJobs();

      // Should not execute update
      expect(mockPrismaService.$executeRawUnsafe).not.toHaveBeenCalled();
    });

    it('should preserve originalNodeId when moving jobs', async () => {
      const job = createMockJob({
        id: 'job-1',
        stage: 'QUEUED',
        nodeId: 'node-1',
        originalNodeId: 'original-node',
      });

      mockPrismaService.job.findMany.mockResolvedValue([job]);

      const node1 = createMockNode({ id: 'node-1' });
      (node1 as any)._count = { jobs: 5 };
      const node2 = createMockNode({ id: 'node-2' });
      (node2 as any)._count = { jobs: 1 };

      mockPrismaService.node.findMany.mockResolvedValue([node1, node2]);

      const score1 = createMockNodeScore('node-1', 20);
      const score2 = createMockNodeScore('node-2', 80);

      mockJobAttributionService.calculateNodeScore
        .mockResolvedValueOnce(score1)
        .mockResolvedValueOnce(score2);

      await service.autoAssignQueuedJobs();

      const sqlCall = (mockPrismaService.$executeRawUnsafe as jest.Mock).mock.calls[0][0];

      // Verify originalNodeId is preserved
      expect(sqlCall).toContain(`WHEN 'job-1' THEN 'original-node'`);
    });

    it('should set originalNodeId to NULL when first assigning', async () => {
      const job = createMockJob({
        id: 'job-1',
        stage: 'QUEUED',
        nodeId: undefined,
        originalNodeId: null,
      });

      mockPrismaService.job.findMany.mockResolvedValue([job]);

      const node = createMockNode({ id: 'node-1' });
      (node as any)._count = { jobs: 1 };

      mockPrismaService.node.findMany.mockResolvedValue([node]);

      const score = createMockNodeScore('node-1', 80);

      mockJobAttributionService.calculateNodeScore.mockResolvedValue(score);

      await service.autoAssignQueuedJobs();

      const sqlCall = (mockPrismaService.$executeRawUnsafe as jest.Mock).mock.calls[0][0];

      // Verify NULL handling in CASE statement
      expect(sqlCall).toContain('NULL');
    });

    it('should batch update multiple jobs in single SQL query', async () => {
      const job1 = createMockJob({
        id: 'job-1',
        stage: 'QUEUED',
        nodeId: 'node-1',
        originalNodeId: null,
      });
      const job2 = createMockJob({
        id: 'job-2',
        stage: 'QUEUED',
        nodeId: 'node-1',
        originalNodeId: null,
      });

      mockPrismaService.job.findMany.mockResolvedValue([job1, job2]);

      const node1 = createMockNode({ id: 'node-1' });
      (node1 as any)._count = { jobs: 2 };
      const node2 = createMockNode({ id: 'node-2' });
      (node2 as any)._count = { jobs: 0 };

      mockPrismaService.node.findMany.mockResolvedValue([node1, node2]);

      const score1 = createMockNodeScore('node-1', 20);
      const score2 = createMockNodeScore('node-2', 90);

      mockJobAttributionService.calculateNodeScore
        .mockResolvedValueOnce(score1)
        .mockResolvedValueOnce(score2);

      await service.autoAssignQueuedJobs();

      // Should execute raw SQL only once (batch update)
      expect(mockPrismaService.$executeRawUnsafe).toHaveBeenCalledTimes(1);

      const sqlCall = (mockPrismaService.$executeRawUnsafe as jest.Mock).mock.calls[0][0];

      // Verify both jobs are in the WHERE clause
      expect(sqlCall).toContain("'job-1'");
      expect(sqlCall).toContain("'job-2'");
    });

    it('should query only QUEUED jobs that are not manually assigned', async () => {
      mockPrismaService.job.findMany.mockResolvedValue([]);

      await service.autoAssignQueuedJobs();

      expect(mockPrismaService.job.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            stage: 'QUEUED',
            manualAssignment: false,
          },
        })
      );
    });

    it('should limit query to 50 jobs per batch', async () => {
      mockPrismaService.job.findMany.mockResolvedValue([]);

      await service.autoAssignQueuedJobs();

      expect(mockPrismaService.job.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 50,
        })
      );
    });

    it('should order jobs by priority (desc) then createdAt (asc)', async () => {
      mockPrismaService.job.findMany.mockResolvedValue([]);

      await service.autoAssignQueuedJobs();

      expect(mockPrismaService.job.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
        })
      );
    });

    it('should query only ONLINE nodes with MAIN or LINKED role', async () => {
      const job = createMockJob({ stage: 'QUEUED' });
      mockPrismaService.job.findMany.mockResolvedValue([job]);
      mockPrismaService.node.findMany.mockResolvedValue([]);

      await service.autoAssignQueuedJobs();

      expect(mockPrismaService.node.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            status: 'ONLINE',
            role: { in: ['MAIN', 'LINKED'] },
          },
        })
      );
    });

    it('should include job count in node query', async () => {
      const job = createMockJob({ stage: 'QUEUED' });
      mockPrismaService.job.findMany.mockResolvedValue([job]);
      mockPrismaService.node.findMany.mockResolvedValue([]);

      await service.autoAssignQueuedJobs();

      expect(mockPrismaService.node.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          include: {
            _count: {
              select: { jobs: true },
            },
          },
        })
      );
    });

    it('should handle errors gracefully', async () => {
      const error = new Error('Database error');
      mockPrismaService.job.findMany.mockRejectedValue(error);

      const errorSpy = jest.spyOn(Logger.prototype, 'error');

      await service.autoAssignQueuedJobs();

      expect(errorSpy).toHaveBeenCalledWith('Error auto-assigning jobs:', error);
    });

    it('should handle SQL execution errors gracefully', async () => {
      const job = createMockJob({
        id: 'job-1',
        stage: 'QUEUED',
        nodeId: 'node-1',
      });

      mockPrismaService.job.findMany.mockResolvedValue([job]);

      const node1 = createMockNode({ id: 'node-1' });
      (node1 as any)._count = { jobs: 5 };
      const node2 = createMockNode({ id: 'node-2' });
      (node2 as any)._count = { jobs: 1 };

      mockPrismaService.node.findMany.mockResolvedValue([node1, node2]);

      const score1 = createMockNodeScore('node-1', 20);
      const score2 = createMockNodeScore('node-2', 80);

      mockJobAttributionService.calculateNodeScore
        .mockResolvedValueOnce(score1)
        .mockResolvedValueOnce(score2);

      const sqlError = new Error('SQL syntax error');
      mockPrismaService.$executeRawUnsafe.mockRejectedValue(sqlError);

      const errorSpy = jest.spyOn(Logger.prototype, 'error');

      await service.autoAssignQueuedJobs();

      expect(errorSpy).toHaveBeenCalledWith('Error auto-assigning jobs:', sqlError);
    });
  });

  // ============================================================================
  // resumePausedJobs() Tests
  // ============================================================================

  describe('resumePausedJobs', () => {
    it('should resume jobs back in their schedule windows', async () => {
      const node = createMockNode({ id: 'node-1', scheduleEnabled: false });
      const job = createMockJob({
        id: 'job-1',
        stage: 'PAUSED',
        nodeId: 'node-1',
      }) as any;
      job.node = node;

      mockPrismaService.job.findMany.mockResolvedValue([job]);

      jest.spyOn(scheduleChecker, 'isNodeInAllowedWindow').mockReturnValue(true);

      await service.resumePausedJobs();

      expect(mockPrismaService.job.updateMany).toHaveBeenCalledWith({
        where: {
          id: { in: ['job-1'] },
        },
        data: {
          stage: 'QUEUED',
        },
      });
    });

    it('should not call updateMany if no jobs can be resumed', async () => {
      const node = createMockNode({
        id: 'node-1',
        scheduleEnabled: true,
        scheduleWindows: JSON.stringify([{ dayOfWeek: 1, startHour: 9, endHour: 17 }]),
      });

      const job = createMockJob({
        id: 'job-1',
        stage: 'PAUSED',
        nodeId: 'node-1',
      }) as any;
      job.node = node;

      mockPrismaService.job.findMany.mockResolvedValue([job]);

      jest.spyOn(scheduleChecker, 'isNodeInAllowedWindow').mockReturnValue(false);

      await service.resumePausedJobs();

      expect(mockPrismaService.job.updateMany).not.toHaveBeenCalled();
    });

    it('should handle empty paused jobs list', async () => {
      mockPrismaService.job.findMany.mockResolvedValue([]);

      await service.resumePausedJobs();

      expect(mockPrismaService.job.findMany).toHaveBeenCalledWith({
        where: {
          stage: 'PAUSED',
        },
        include: {
          node: true,
        },
      });

      expect(mockPrismaService.job.updateMany).not.toHaveBeenCalled();
    });

    it('should resume multiple jobs in a single batch update', async () => {
      const node = createMockNode({ id: 'node-1', scheduleEnabled: false });

      const jobs = [
        createMockJob({
          id: 'job-1',
          stage: 'PAUSED',
          nodeId: 'node-1',
        }) as any,
        createMockJob({
          id: 'job-2',
          stage: 'PAUSED',
          nodeId: 'node-1',
        }) as any,
        createMockJob({
          id: 'job-3',
          stage: 'PAUSED',
          nodeId: 'node-1',
        }) as any,
      ];

      jobs.forEach((job) => {
        job.node = node;
      });

      mockPrismaService.job.findMany.mockResolvedValue(jobs);

      jest.spyOn(scheduleChecker, 'isNodeInAllowedWindow').mockReturnValue(true);

      await service.resumePausedJobs();

      expect(mockPrismaService.job.updateMany).toHaveBeenCalledWith({
        where: {
          id: { in: ['job-1', 'job-2', 'job-3'] },
        },
        data: {
          stage: 'QUEUED',
        },
      });

      // Should be single batch call, not individual updates
      expect(mockPrismaService.job.updateMany).toHaveBeenCalledTimes(1);
    });

    it('should resume jobs to QUEUED stage for queue service pickup', async () => {
      const node = createMockNode({ id: 'node-1', scheduleEnabled: false });
      const job = createMockJob({
        id: 'job-1',
        stage: 'PAUSED',
      }) as any;
      job.node = node;

      mockPrismaService.job.findMany.mockResolvedValue([job]);

      jest.spyOn(scheduleChecker, 'isNodeInAllowedWindow').mockReturnValue(true);

      await service.resumePausedJobs();

      // Verify jobs are moved to QUEUED, not back to ENCODING
      expect(mockPrismaService.job.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            stage: 'QUEUED',
          },
        })
      );
    });

    it('should selectively resume jobs based on schedule', async () => {
      const nodeInWindow = createMockNode({
        id: 'node-1',
        scheduleEnabled: false,
      });

      const nodeOutOfWindow = createMockNode({
        id: 'node-2',
        scheduleEnabled: true,
        scheduleWindows: JSON.stringify([{ dayOfWeek: 1, startHour: 9, endHour: 17 }]),
      });

      const jobInWindow = createMockJob({
        id: 'job-1',
        stage: 'PAUSED',
        nodeId: 'node-1',
      }) as any;
      jobInWindow.node = nodeInWindow;

      const jobOutOfWindow = createMockJob({
        id: 'job-2',
        stage: 'PAUSED',
        nodeId: 'node-2',
      }) as any;
      jobOutOfWindow.node = nodeOutOfWindow;

      mockPrismaService.job.findMany.mockResolvedValue([jobInWindow, jobOutOfWindow]);

      jest.spyOn(scheduleChecker, 'isNodeInAllowedWindow').mockImplementation((node: any) => {
        return node.id === 'node-1';
      });

      await service.resumePausedJobs();

      // Only job-1 should be resumed
      expect(mockPrismaService.job.updateMany).toHaveBeenCalledWith({
        where: {
          id: { in: ['job-1'] },
        },
        data: {
          stage: 'QUEUED',
        },
      });
    });

    it('should handle errors gracefully', async () => {
      const error = new Error('Database connection failed');
      mockPrismaService.job.findMany.mockRejectedValue(error);

      const errorSpy = jest.spyOn(Logger.prototype, 'error');

      await service.resumePausedJobs();

      expect(errorSpy).toHaveBeenCalledWith('Error resuming jobs:', error);
    });

    it('should query only PAUSED stage jobs', async () => {
      mockPrismaService.job.findMany.mockResolvedValue([]);

      await service.resumePausedJobs();

      expect(mockPrismaService.job.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            stage: 'PAUSED',
          },
        })
      );
    });

    it('should include node data in the query', async () => {
      mockPrismaService.job.findMany.mockResolvedValue([]);

      await service.resumePausedJobs();

      expect(mockPrismaService.job.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          include: {
            node: true,
          },
        })
      );
    });
  });

  // ============================================================================
  // Integration Tests
  // ============================================================================

  describe('Integration scenarios', () => {
    it('should work together: pause, check queued jobs, resume', async () => {
      // Setup nodes
      const node1 = createMockNode({
        id: 'node-1',
        scheduleEnabled: false,
      });
      (node1 as any)._count = { jobs: 1 };

      const node2 = createMockNode({
        id: 'node-2',
        scheduleEnabled: false,
      });
      (node2 as any)._count = { jobs: 0 };

      // Setup jobs
      const encodingJob = createMockJob({
        id: 'encoding-job',
        stage: 'ENCODING',
        nodeId: 'node-1',
      }) as any;
      encodingJob.node = node1;

      const queuedJob = createMockJob({
        id: 'queued-job',
        stage: 'QUEUED',
        nodeId: 'node-1',
      });

      const pausedJob = createMockJob({
        id: 'paused-job',
        stage: 'PAUSED',
        nodeId: 'node-1',
      }) as any;
      pausedJob.node = node1;

      // Mock enforceSchedules call
      mockPrismaService.job.findMany.mockResolvedValueOnce([encodingJob]);
      jest.spyOn(scheduleChecker, 'isNodeInAllowedWindow').mockReturnValue(true);

      await service.enforceSchedules();

      // Mock autoAssignQueuedJobs call
      jest.clearAllMocks();
      mockPrismaService.job.findMany.mockResolvedValueOnce([queuedJob]);
      mockPrismaService.node.findMany.mockResolvedValueOnce([node1, node2]);

      const score1 = createMockNodeScore('node-1', 50);
      const score2 = createMockNodeScore('node-2', 80);

      mockJobAttributionService.calculateNodeScore
        .mockResolvedValueOnce(score1)
        .mockResolvedValueOnce(score2);

      await service.autoAssignQueuedJobs();

      // Should have attempted to move job
      expect(mockPrismaService.$executeRawUnsafe).toHaveBeenCalled();

      // Mock resumePausedJobs call
      jest.clearAllMocks();
      mockPrismaService.job.findMany.mockResolvedValueOnce([pausedJob]);
      jest.spyOn(scheduleChecker, 'isNodeInAllowedWindow').mockReturnValue(true);

      await service.resumePausedJobs();

      // Should resume paused job
      expect(mockPrismaService.job.updateMany).toHaveBeenCalled();
    });

    it('should handle schedule-aware decisions across all three methods', async () => {
      const node = createMockNode({
        id: 'node-1',
        scheduleEnabled: true,
        scheduleWindows: JSON.stringify([
          { dayOfWeek: 1, startHour: 9, endHour: 17 }, // Monday 9-5
        ]),
      });
      (node as any)._count = { jobs: 2 };

      // All jobs on same node
      const encodingJob = createMockJob({
        id: 'encoding-job',
        stage: 'ENCODING',
        nodeId: 'node-1',
      }) as any;
      encodingJob.node = node;

      const queuedJob = createMockJob({
        id: 'queued-job',
        stage: 'QUEUED',
        nodeId: 'node-1',
      });

      const pausedJob = createMockJob({
        id: 'paused-job',
        stage: 'PAUSED',
        nodeId: 'node-1',
      }) as any;
      pausedJob.node = node;

      // Step 1: Check schedules - node is outside window (assume it's Saturday)
      mockPrismaService.job.findMany.mockResolvedValueOnce([encodingJob]);
      jest.spyOn(scheduleChecker, 'isNodeInAllowedWindow').mockReturnValue(false);

      await service.enforceSchedules();

      // Should pause the job
      expect(mockPrismaService.job.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['encoding-job'] } },
        data: { stage: 'PAUSED' },
      });

      // Step 2: Check queued jobs (with node still outside window)
      jest.clearAllMocks();
      mockPrismaService.job.findMany.mockResolvedValueOnce([queuedJob]);
      mockPrismaService.node.findMany.mockResolvedValueOnce([node]);

      const nodeScore = createMockNodeScore('node-1', 0); // Zero because outside schedule
      mockJobAttributionService.calculateNodeScore.mockResolvedValue(nodeScore);

      await service.autoAssignQueuedJobs();

      // Should not assign to unavailable node
      expect(mockPrismaService.$executeRawUnsafe).not.toHaveBeenCalled();

      // Step 3: Resume when back in schedule
      jest.clearAllMocks();
      mockPrismaService.job.findMany.mockResolvedValueOnce([pausedJob]);
      jest.spyOn(scheduleChecker, 'isNodeInAllowedWindow').mockReturnValue(true);

      await service.resumePausedJobs();

      // Should resume the job
      expect(mockPrismaService.job.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['paused-job'] } },
        data: { stage: 'QUEUED' },
      });
    });
  });

  // ============================================================================
  // Edge Cases and Error Scenarios
  // ============================================================================

  describe('Edge cases and error scenarios', () => {
    it('should handle null scheduleWindows gracefully', async () => {
      const node = createMockNode({
        id: 'node-1',
        scheduleEnabled: true,
        scheduleWindows: null,
      });

      const job = createMockJob({
        id: 'job-1',
        stage: 'ENCODING',
      }) as any;
      job.node = node;

      mockPrismaService.job.findMany.mockResolvedValue([job]);

      jest.spyOn(scheduleChecker, 'isNodeInAllowedWindow').mockReturnValue(true);

      await service.enforceSchedules();

      // Should handle gracefully
      expect(mockPrismaService.job.findMany).toHaveBeenCalled();
    });

    it('should handle jobs with null nodeId in autoAssignQueuedJobs', async () => {
      const job = createMockJob({
        id: 'job-1',
        stage: 'QUEUED',
        nodeId: undefined,
        originalNodeId: null,
      });

      mockPrismaService.job.findMany.mockResolvedValue([job]);

      const node = createMockNode({ id: 'node-1' });
      (node as any)._count = { jobs: 0 };

      mockPrismaService.node.findMany.mockResolvedValue([node]);

      const nodeScore = createMockNodeScore('node-1', 85);
      mockJobAttributionService.calculateNodeScore.mockResolvedValue(nodeScore);

      await service.autoAssignQueuedJobs();

      // Should assign the unassigned job
      expect(mockPrismaService.$executeRawUnsafe).toHaveBeenCalled();
    });

    it('should handle very large job batches in autoAssignQueuedJobs', async () => {
      // Create 50 jobs (the batch limit)
      const jobs = Array.from({ length: 50 }, (_, i) =>
        createMockJob({
          id: `job-${i}`,
          stage: 'QUEUED',
          nodeId: 'node-1',
          priority: 10 - (i % 10),
        })
      );

      mockPrismaService.job.findMany.mockResolvedValue(jobs);

      const node1 = createMockNode({ id: 'node-1' });
      (node1 as any)._count = { jobs: 25 };
      const node2 = createMockNode({ id: 'node-2' });
      (node2 as any)._count = { jobs: 10 };

      mockPrismaService.node.findMany.mockResolvedValue([node1, node2]);

      const score1 = createMockNodeScore('node-1', 30);
      const score2 = createMockNodeScore('node-2', 80);

      mockJobAttributionService.calculateNodeScore
        .mockResolvedValueOnce(score1)
        .mockResolvedValueOnce(score2);

      await service.autoAssignQueuedJobs();

      // Should handle large batch gracefully
      expect(mockPrismaService.job.findMany).toHaveBeenCalled();
    });

    it('should handle Prisma cache TTL and score updates', async () => {
      const job = createMockJob({ id: 'job-1', stage: 'QUEUED' });
      mockPrismaService.job.findMany.mockResolvedValue([job]);

      const node = createMockNode({ id: 'node-1' });
      (node as any)._count = { jobs: 2 };

      mockPrismaService.node.findMany.mockResolvedValue([node]);

      const nodeScore = createMockNodeScore('node-1', 50);
      mockJobAttributionService.calculateNodeScore.mockResolvedValue(nodeScore);

      // First call
      await service.autoAssignQueuedJobs();
      expect(mockJobAttributionService.calculateNodeScore).toHaveBeenCalledTimes(1);

      // Second call should calculate again (no caching in this test context)
      jest.clearAllMocks();
      mockPrismaService.job.findMany.mockResolvedValue([job]);
      mockPrismaService.node.findMany.mockResolvedValue([node]);
      mockJobAttributionService.calculateNodeScore.mockResolvedValue(nodeScore);

      await service.autoAssignQueuedJobs();
      expect(mockJobAttributionService.calculateNodeScore).toHaveBeenCalledTimes(1);
    });

    it('should escape SQL special characters in job IDs', async () => {
      // Test with SQL-like characters in ID
      const job = createMockJob({
        id: "job-1'; DROP TABLE jobs; --",
        stage: 'QUEUED',
        nodeId: 'node-1',
        originalNodeId: null,
      });

      mockPrismaService.job.findMany.mockResolvedValue([job]);

      const node1 = createMockNode({ id: 'node-1' });
      (node1 as any)._count = { jobs: 5 };
      const node2 = createMockNode({ id: 'node-2' });
      (node2 as any)._count = { jobs: 1 };

      mockPrismaService.node.findMany.mockResolvedValue([node1, node2]);

      const score1 = createMockNodeScore('node-1', 20);
      const score2 = createMockNodeScore('node-2', 80);

      mockJobAttributionService.calculateNodeScore
        .mockResolvedValueOnce(score1)
        .mockResolvedValueOnce(score2);

      // Should handle without throwing
      await service.autoAssignQueuedJobs();

      expect(mockPrismaService.$executeRawUnsafe).toHaveBeenCalled();
    });
  });

  // ============================================================================
  // Logging Tests
  // ============================================================================

  describe('Logging', () => {
    it('should log when pausing jobs in enforceSchedules', async () => {
      const node = createMockNode({
        id: 'node-1',
        scheduleEnabled: true,
        scheduleWindows: JSON.stringify([{ dayOfWeek: 1, startHour: 9, endHour: 17 }]),
      });

      const job = createMockJob({
        id: 'job-1',
        stage: 'ENCODING',
      }) as any;
      job.node = node;

      mockPrismaService.job.findMany.mockResolvedValue([job]);

      jest.spyOn(scheduleChecker, 'isNodeInAllowedWindow').mockReturnValue(false);

      const logSpy = jest.spyOn(Logger.prototype, 'log');

      await service.enforceSchedules();

      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Paused 1 job(s)'));
    });

    it('should log when moving jobs in autoAssignQueuedJobs', async () => {
      const job = createMockJob({
        id: 'job-1',
        stage: 'QUEUED',
        nodeId: 'node-1',
      });

      mockPrismaService.job.findMany.mockResolvedValue([job]);

      const node1 = createMockNode({ id: 'node-1' });
      (node1 as any)._count = { jobs: 5 };
      const node2 = createMockNode({ id: 'node-2' });
      (node2 as any)._count = { jobs: 1 };

      mockPrismaService.node.findMany.mockResolvedValue([node1, node2]);

      const score1 = createMockNodeScore('node-1', 20);
      const score2 = createMockNodeScore('node-2', 80);

      mockJobAttributionService.calculateNodeScore
        .mockResolvedValueOnce(score1)
        .mockResolvedValueOnce(score2);

      const logSpy = jest.spyOn(Logger.prototype, 'log');

      await service.autoAssignQueuedJobs();

      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Moving job'));
    });

    it('should log when resuming jobs in resumePausedJobs', async () => {
      const node = createMockNode({ id: 'node-1', scheduleEnabled: false });

      const job = createMockJob({
        id: 'job-1',
        stage: 'PAUSED',
      }) as any;
      job.node = node;

      mockPrismaService.job.findMany.mockResolvedValue([job]);

      jest.spyOn(scheduleChecker, 'isNodeInAllowedWindow').mockReturnValue(true);

      const logSpy = jest.spyOn(Logger.prototype, 'log');

      await service.resumePausedJobs();

      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Resumed 1 job(s)'));
    });
  });
});
