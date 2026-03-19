import { Test, type TestingModule } from '@nestjs/testing';
import { DistributionConfigRepository } from '../../../../common/repositories/distribution-config.repository';
import { JobRepository } from '../../../../common/repositories/job.repository';
import { NodeRepository } from '../../../../common/repositories/node.repository';
import { DistributionOrchestratorService } from '../../distribution-orchestrator.service';
import { EtaCalculatorService } from '../../eta-calculator.service';
import { JobScorerService } from '../../job-scorer.service';
import { LoadMonitorService } from '../../load-monitor.service';
import { ReliabilityTrackerService } from '../../reliability-tracker.service';

// Mock schedule-checker at module level
jest.mock('../../../../nodes/utils/schedule-checker', () => ({
  isNodeInAllowedWindow: jest.fn().mockReturnValue(true),
}));

import * as scheduleChecker from '../../../../nodes/utils/schedule-checker';

describe('DistributionOrchestratorService', () => {
  let service: DistributionOrchestratorService;
  let mockJobRepo: Record<string, jest.Mock>;
  let mockNodeRepo: Record<string, jest.Mock>;
  let mockDistConfigRepo: Record<string, jest.Mock>;
  let scorer: Record<string, jest.Mock>;
  let loadMonitor: Record<string, jest.Mock>;
  let etaCalculator: Record<string, jest.Mock>;
  let reliabilityTracker: Record<string, jest.Mock>;

  const mockJob = {
    id: 'job-1',
    nodeId: null,
    fileLabel: 'movie.mkv',
    filePath: '/media/movie.mkv',
    stage: 'QUEUED',
    stickyUntil: null,
    updatedAt: new Date('2025-01-01'),
    library: { nodeId: 'node-1' },
  };

  const mockNode = {
    id: 'node-1',
    name: 'Main Node',
    status: 'ONLINE',
    maxWorkers: 4,
    hasSharedStorage: true,
    hasGpu: true,
    _count: { jobs: 1 },
  };

  const mockScore = {
    nodeId: 'node-1',
    nodeName: 'Main Node',
    totalScore: 85,
    factors: {
      scheduleAvailable: true,
      realTimeLoad: 25,
      queueDepth: 15,
      hardware: 20,
      performance: 15,
      codecMatch: 10,
      libraryAffinity: 5,
      etaBalance: 10,
      fileSizeSpread: 5,
      stickiness: 0,
      transferCost: 0,
      reliability: 0,
    },
    computedAt: new Date(),
  };

  beforeEach(async () => {
    mockJobRepo = {
      findByIdWithLibrary: jest.fn(),
      findEligibleForRebalance: jest.fn(),
      findQueuedExcludingNode: jest.fn(),
      atomicUpdateMany: jest.fn(),
      countForNode: jest.fn(),
      countForNodeStages: jest.fn(),
    };

    mockNodeRepo = {
      findOnlineWithActiveJobCount: jest.fn(),
      findOnlineWithAllJobCount: jest.fn(),
      findByIdWithActiveJobCount: jest.fn(),
      findOnlineIds: jest.fn(),
      findAllSummary: jest.fn(),
      updateById: jest.fn().mockResolvedValue(undefined),
    };

    mockDistConfigRepo = {
      findOrCreateDefault: jest.fn(),
      updateById: jest.fn(),
    };

    scorer = {
      calculateScore: jest.fn(),
      shouldMigrate: jest.fn(),
    };

    loadMonitor = {
      getNodeCapacity: jest.fn(),
    };

    etaCalculator = {
      estimateDuration: jest.fn().mockResolvedValue({ estimatedSeconds: 3600 }),
      updateNodeETAs: jest.fn().mockResolvedValue(undefined),
    };

    reliabilityTracker = {
      recordFailure: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DistributionOrchestratorService,
        { provide: JobRepository, useValue: mockJobRepo },
        { provide: NodeRepository, useValue: mockNodeRepo },
        { provide: DistributionConfigRepository, useValue: mockDistConfigRepo },
        { provide: JobScorerService, useValue: scorer },
        { provide: LoadMonitorService, useValue: loadMonitor },
        { provide: EtaCalculatorService, useValue: etaCalculator },
        { provide: ReliabilityTrackerService, useValue: reliabilityTracker },
      ],
    }).compile();

    service = module.get<DistributionOrchestratorService>(DistributionOrchestratorService);

    jest.clearAllMocks();
    (scheduleChecker.isNodeInAllowedWindow as jest.Mock).mockReturnValue(true);
    mockNodeRepo.updateById.mockResolvedValue(undefined);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ─── findOptimalNode ──────────────────────────────────────────────

  describe('findOptimalNode', () => {
    it('should return null when job is not found', async () => {
      mockJobRepo.findByIdWithLibrary.mockResolvedValue(null);

      const result = await service.findOptimalNode('nonexistent');

      expect(result).toBeNull();
    });

    it('should return null when no online nodes exist', async () => {
      mockJobRepo.findByIdWithLibrary.mockResolvedValue(mockJob);
      mockNodeRepo.findOnlineWithActiveJobCount.mockResolvedValue([]);

      const result = await service.findOptimalNode('job-1');

      expect(result).toBeNull();
    });

    it('should return null when all node scores are 0', async () => {
      mockJobRepo.findByIdWithLibrary.mockResolvedValue(mockJob);
      mockNodeRepo.findOnlineWithActiveJobCount.mockResolvedValue([mockNode]);
      scorer.calculateScore.mockResolvedValue({ ...mockScore, totalScore: 0 });

      const result = await service.findOptimalNode('job-1');

      expect(result).toBeNull();
    });

    it('should return the best-scoring node', async () => {
      mockJobRepo.findByIdWithLibrary.mockResolvedValue(mockJob);
      const node2 = { ...mockNode, id: 'node-2', name: 'Worker Node' };
      mockNodeRepo.findOnlineWithActiveJobCount.mockResolvedValue([mockNode, node2]);

      const lowScore = { ...mockScore, nodeId: 'node-1', totalScore: 50 };
      const highScore = { ...mockScore, nodeId: 'node-2', nodeName: 'Worker Node', totalScore: 90 };

      scorer.calculateScore.mockResolvedValueOnce(lowScore).mockResolvedValueOnce(highScore);

      const result = await service.findOptimalNode('job-1');

      expect(result).not.toBeNull();
      expect(result!.nodeId).toBe('node-2');
      expect(result!.score).toBe(90);
    });

    it('should detect migration when job was on different node', async () => {
      const assignedJob = { ...mockJob, nodeId: 'node-old' };
      mockJobRepo.findByIdWithLibrary.mockResolvedValue(assignedJob);
      mockNodeRepo.findOnlineWithActiveJobCount.mockResolvedValue([mockNode]);
      scorer.calculateScore.mockResolvedValue(mockScore);

      const result = await service.findOptimalNode('job-1');

      expect(result!.wasMigrated).toBe(true);
      expect(result!.previousNodeId).toBe('node-old');
    });

    it('should not flag migration when job stays on same node', async () => {
      const assignedJob = { ...mockJob, nodeId: 'node-1' };
      mockJobRepo.findByIdWithLibrary.mockResolvedValue(assignedJob);
      mockNodeRepo.findOnlineWithActiveJobCount.mockResolvedValue([mockNode]);
      scorer.calculateScore.mockResolvedValue(mockScore);

      const result = await service.findOptimalNode('job-1');

      expect(result!.wasMigrated).toBe(false);
      expect(result!.previousNodeId).toBeUndefined();
    });
  });

  // ─── assignJob ────────────────────────────────────────────────────

  describe('assignJob', () => {
    it('should find optimal node when nodeId not specified', async () => {
      mockJobRepo.findByIdWithLibrary.mockResolvedValue(mockJob);
      mockNodeRepo.findOnlineWithActiveJobCount.mockResolvedValue([mockNode]);
      mockNodeRepo.findByIdWithActiveJobCount.mockResolvedValue(mockNode);
      scorer.calculateScore.mockResolvedValue(mockScore);
      mockJobRepo.atomicUpdateMany.mockResolvedValue({ count: 1 });
      mockJobRepo.countForNode.mockResolvedValue(5);

      const result = await service.assignJob('job-1');

      expect(result).not.toBeNull();
      expect(result!.nodeId).toBe('node-1');
    });

    it('should return null when job not found during assign', async () => {
      mockJobRepo.findByIdWithLibrary.mockResolvedValueOnce(mockJob); // for findOptimalNode
      mockNodeRepo.findOnlineWithActiveJobCount.mockResolvedValue([mockNode]);
      scorer.calculateScore.mockResolvedValue(mockScore);
      mockJobRepo.findByIdWithLibrary.mockResolvedValueOnce(null); // for assignJob lookup

      const result = await service.assignJob('job-1');

      expect(result).toBeNull();
    });

    it('should return null when target node not found', async () => {
      mockJobRepo.findByIdWithLibrary.mockResolvedValue(mockJob);
      mockNodeRepo.findByIdWithActiveJobCount.mockResolvedValue(null);

      const result = await service.assignJob('job-1', 'nonexistent-node');

      expect(result).toBeNull();
    });

    it('should handle optimistic lock failure (race condition)', async () => {
      mockJobRepo.findByIdWithLibrary.mockResolvedValue(mockJob);
      mockNodeRepo.findByIdWithActiveJobCount.mockResolvedValue(mockNode);
      scorer.calculateScore.mockResolvedValue(mockScore);
      mockJobRepo.atomicUpdateMany.mockResolvedValue({ count: 0 }); // Race lost

      const result = await service.assignJob('job-1', 'node-1');

      expect(result).toBeNull();
    });

    it('should update ETAs for both old and new node on migration', async () => {
      const migratingJob = { ...mockJob, nodeId: 'node-old', updatedAt: new Date() };
      mockJobRepo.findByIdWithLibrary.mockResolvedValue(migratingJob);
      mockNodeRepo.findByIdWithActiveJobCount.mockResolvedValue(mockNode);
      scorer.calculateScore.mockResolvedValue(mockScore);
      mockJobRepo.atomicUpdateMany.mockResolvedValue({ count: 1 });
      mockJobRepo.countForNode.mockResolvedValue(3);

      await service.assignJob('job-1', 'node-1');

      // Should update ETAs for new node and old node
      expect(etaCalculator.updateNodeETAs).toHaveBeenCalledWith('node-1');
      expect(etaCalculator.updateNodeETAs).toHaveBeenCalledWith('node-old');
    });
  });

  // ─── getAllNodeScores ─────────────────────────────────────────────

  describe('getAllNodeScores', () => {
    it('should return empty array when job not found', async () => {
      mockJobRepo.findByIdWithLibrary.mockResolvedValue(null);

      const result = await service.getAllNodeScores('nonexistent');

      expect(result).toEqual([]);
    });

    it('should return scores sorted descending by totalScore', async () => {
      mockJobRepo.findByIdWithLibrary.mockResolvedValue(mockJob);
      const node2 = { ...mockNode, id: 'node-2', name: 'Worker' };
      mockNodeRepo.findOnlineWithActiveJobCount.mockResolvedValue([mockNode, node2]);

      const score1 = { ...mockScore, totalScore: 40 };
      const score2 = { ...mockScore, nodeId: 'node-2', totalScore: 90 };
      scorer.calculateScore.mockResolvedValueOnce(score1).mockResolvedValueOnce(score2);

      const result = await service.getAllNodeScores('job-1');

      expect(result).toHaveLength(2);
      expect(result[0].totalScore).toBe(90);
      expect(result[1].totalScore).toBe(40);
    });
  });

  // ─── getScoreBreakdown ───────────────────────────────────────────

  describe('getScoreBreakdown', () => {
    it('should return all 11 scoring factors', () => {
      const breakdown = service.getScoreBreakdown(mockScore);

      expect(breakdown).toHaveLength(11);
      const factorNames = breakdown.map((b) => b.factor);
      expect(factorNames).toContain('realTimeLoad');
      expect(factorNames).toContain('queueDepth');
      expect(factorNames).toContain('hardware');
      expect(factorNames).toContain('reliability');
    });

    it('should calculate correct percentages for positive factors', () => {
      const breakdown = service.getScoreBreakdown(mockScore);
      const loadFactor = breakdown.find((b) => b.factor === 'realTimeLoad')!;

      // realTimeLoad = 25, maxValue = 30 → 83.33%
      expect(loadFactor.percentage).toBeCloseTo(83.33, 1);
    });

    it('should handle zero-value negative factors as 100%', () => {
      const breakdown = service.getScoreBreakdown(mockScore);
      const stickiness = breakdown.find((b) => b.factor === 'stickiness')!;

      // stickiness = 0 → 100%
      expect(stickiness.percentage).toBe(100);
    });
  });

  // ─── rebalanceJobs ────────────────────────────────────────────────

  describe('rebalanceJobs', () => {
    it('should return 0 migrations when no eligible jobs', async () => {
      mockJobRepo.findEligibleForRebalance.mockResolvedValue([]);

      const result = await service.rebalanceJobs();

      expect(result.migratedCount).toBe(0);
      expect(result.reasons).toEqual([]);
    });

    it('should assign unassigned jobs to optimal node', async () => {
      const unassignedJob = { ...mockJob, nodeId: null };
      mockJobRepo.findEligibleForRebalance.mockResolvedValue([unassignedJob]);

      // findOptimalNode
      mockJobRepo.findByIdWithLibrary.mockResolvedValueOnce(unassignedJob);
      mockNodeRepo.findOnlineWithActiveJobCount.mockResolvedValue([mockNode]);
      scorer.calculateScore.mockResolvedValue(mockScore);

      // assignJob (with nodeId provided by findOptimalNode result)
      mockJobRepo.findByIdWithLibrary.mockResolvedValueOnce(unassignedJob);
      mockNodeRepo.findByIdWithActiveJobCount.mockResolvedValue(mockNode);
      mockJobRepo.atomicUpdateMany.mockResolvedValue({ count: 1 });
      mockJobRepo.countForNode.mockResolvedValue(1);

      const result = await service.rebalanceJobs();

      expect(result.migratedCount).toBe(1);
      expect(result.reasons[0]).toContain('Assigned');
    });

    it('should skip jobs already on optimal node', async () => {
      const assignedJob = { ...mockJob, nodeId: 'node-1' };
      mockJobRepo.findEligibleForRebalance.mockResolvedValue([assignedJob]);

      // findOptimalNode returns same node
      mockJobRepo.findByIdWithLibrary.mockResolvedValue(assignedJob);
      mockNodeRepo.findOnlineWithActiveJobCount.mockResolvedValue([mockNode]);
      scorer.calculateScore.mockResolvedValue(mockScore);

      const result = await service.rebalanceJobs();

      expect(result.migratedCount).toBe(0);
    });
  });

  // ─── recordJobFailure ─────────────────────────────────────────────

  describe('recordJobFailure', () => {
    it('should delegate to reliability tracker', async () => {
      const job = { ...mockJob, nodeId: 'node-1' } as any;

      await service.recordJobFailure(job, 'encoding error', 'ERR_FFMPEG');

      expect(reliabilityTracker.recordFailure).toHaveBeenCalledWith(
        'node-1',
        job,
        'encoding error',
        'ERR_FFMPEG'
      );
    });

    it('should skip when job has no nodeId', async () => {
      const job = { ...mockJob, nodeId: null } as any;

      await service.recordJobFailure(job, 'some error');

      expect(reliabilityTracker.recordFailure).not.toHaveBeenCalled();
    });
  });

  // ─── getActiveConfig ──────────────────────────────────────────────

  describe('getActiveConfig', () => {
    it('should return active config from repository', async () => {
      const config = { id: 'default', isActive: true };
      mockDistConfigRepo.findOrCreateDefault.mockResolvedValue(config);

      const result = await service.getActiveConfig();

      expect(result).toEqual(config);
    });

    it('should create and return default config when none exists', async () => {
      const newConfig = { id: 'default', isActive: true };
      mockDistConfigRepo.findOrCreateDefault.mockResolvedValue(newConfig);

      const result = await service.getActiveConfig();

      expect(mockDistConfigRepo.findOrCreateDefault).toHaveBeenCalled();
      expect(result).toEqual(newConfig);
    });
  });

  // ─── findBestNodeForNewJob ────────────────────────────────────────

  describe('findBestNodeForNewJob', () => {
    it('should fall back to library node when no online nodes', async () => {
      mockNodeRepo.findOnlineWithAllJobCount.mockResolvedValue([]);

      const result = await service.findBestNodeForNewJob('lib-node-1');

      expect(result).toBe('lib-node-1');
    });

    it('should prefer node with available capacity and GPU', async () => {
      const gpuNode = { ...mockNode, id: 'gpu-1', hasGpu: true, _count: { jobs: 0 } };
      const cpuNode = { ...mockNode, id: 'cpu-1', hasGpu: false, _count: { jobs: 2 } };
      mockNodeRepo.findOnlineWithAllJobCount.mockResolvedValue([cpuNode, gpuNode]);

      const result = await service.findBestNodeForNewJob('lib-node-1');

      expect(result).toBe('gpu-1');
    });

    it('should penalize at-capacity nodes', async () => {
      const fullNode = { ...mockNode, id: 'full', maxWorkers: 2, _count: { jobs: 2 } };
      const freeNode = { ...mockNode, id: 'free', maxWorkers: 4, _count: { jobs: 0 } };
      mockNodeRepo.findOnlineWithAllJobCount.mockResolvedValue([fullNode, freeNode]);

      const result = await service.findBestNodeForNewJob('lib-node-1');

      expect(result).toBe('free');
    });

    it('should exclude nodes outside schedule window', async () => {
      const scheduled = { ...mockNode, id: 'scheduled', _count: { jobs: 0 } };
      const unscheduled = { ...mockNode, id: 'unscheduled', _count: { jobs: 0 } };
      mockNodeRepo.findOnlineWithAllJobCount.mockResolvedValue([unscheduled, scheduled]);

      (scheduleChecker.isNodeInAllowedWindow as jest.Mock)
        .mockReturnValueOnce(false) // unscheduled
        .mockReturnValueOnce(true); // scheduled

      const result = await service.findBestNodeForNewJob('lib-node-1');

      expect(result).toBe('scheduled');
    });

    it('should fall back to library node when all nodes score 0', async () => {
      const node = { ...mockNode, _count: { jobs: 0 } };
      mockNodeRepo.findOnlineWithAllJobCount.mockResolvedValue([node]);

      (scheduleChecker.isNodeInAllowedWindow as jest.Mock).mockReturnValue(false);

      const result = await service.findBestNodeForNewJob('lib-node-1');

      expect(result).toBe('lib-node-1');
    });

    it('should give library affinity bonus to same-node', async () => {
      const libNode = {
        ...mockNode,
        id: 'lib-node',
        hasGpu: false,
        hasSharedStorage: false,
        _count: { jobs: 0 },
      };
      const otherNode = {
        ...mockNode,
        id: 'other',
        hasGpu: false,
        hasSharedStorage: false,
        _count: { jobs: 0 },
      };
      mockNodeRepo.findOnlineWithAllJobCount.mockResolvedValue([libNode, otherNode]);

      const result = await service.findBestNodeForNewJob('lib-node');

      // Library node should win due to +5 affinity bonus
      expect(result).toBe('lib-node');
    });
  });

  // ─── getNodesCapacity ─────────────────────────────────────────────

  describe('getNodesCapacity', () => {
    it('should return capacity for all online nodes', async () => {
      mockNodeRepo.findOnlineIds.mockResolvedValue([
        { id: 'n1', name: 'Node 1' },
        { id: 'n2', name: 'Node 2' },
      ]);
      loadMonitor.getNodeCapacity
        .mockResolvedValueOnce({ nodeId: 'n1', availableSlots: 3 })
        .mockResolvedValueOnce(null); // Node 2 has no capacity data

      const result = await service.getNodesCapacity();

      expect(result.nodes).toHaveLength(1);
      expect(result.nodes[0]).toEqual({ nodeId: 'n1', availableSlots: 3 });
    });
  });
});
