import { HttpException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { DistributionController } from '../../distribution.controller';
import { DistributionOrchestratorService } from '../../services/distribution-orchestrator.service';
import { ReliabilityTrackerService } from '../../services/reliability-tracker.service';

describe('DistributionController', () => {
  let controller: DistributionController;
  let orchestrator: {
    getAllNodeScores: jest.Mock;
    getScoreBreakdown: jest.Mock;
    assignJob: jest.Mock;
    rebalanceJobs: jest.Mock;
    getDistributionSummary: jest.Mock;
    findOptimalNode: jest.Mock;
    getActiveConfig: jest.Mock;
    updateConfig: jest.Mock;
    getNodesCapacity: jest.Mock;
  };
  let reliabilityTracker: { getFailureSummary: jest.Mock; isUnreliable: jest.Mock };

  beforeEach(async () => {
    orchestrator = {
      getAllNodeScores: jest.fn(),
      getScoreBreakdown: jest.fn(),
      assignJob: jest.fn(),
      rebalanceJobs: jest.fn(),
      getDistributionSummary: jest.fn(),
      findOptimalNode: jest.fn(),
      getActiveConfig: jest.fn(),
      updateConfig: jest.fn(),
      getNodesCapacity: jest.fn(),
    };
    reliabilityTracker = { getFailureSummary: jest.fn(), isUnreliable: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [DistributionController],
      providers: [
        { provide: DistributionOrchestratorService, useValue: orchestrator },
        { provide: ReliabilityTrackerService, useValue: reliabilityTracker },
      ],
    }).compile();

    controller = module.get<DistributionController>(DistributionController);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getNodeScores', () => {
    it('should return scores for a job', async () => {
      const mockScores = [
        {
          nodeId: 'node-1',
          nodeName: 'Main Node',
          totalScore: 85.6789,
          factors: {},
          computedAt: new Date(),
        },
      ];
      orchestrator.getAllNodeScores.mockResolvedValue(mockScores);
      orchestrator.getScoreBreakdown.mockReturnValue({ hardware: 50, load: 35.7 });

      const result = (await controller.getNodeScores('job-1')) as any;

      expect(result.jobId).toBe('job-1');
      expect(result.scores).toHaveLength(1);
      expect(result.scores[0].totalScore).toBe(85.7);
    });

    it('should throw 404 when no scores found', async () => {
      orchestrator.getAllNodeScores.mockResolvedValue([]);

      await expect(controller.getNodeScores('job-1')).rejects.toThrow(HttpException);
    });
  });

  describe('getNodeScoreDetail', () => {
    it('should return detailed score for specific node', async () => {
      const mockScores = [
        {
          nodeId: 'node-1',
          nodeName: 'Main',
          totalScore: 90,
          factors: {},
          computedAt: new Date(),
        },
      ];
      orchestrator.getAllNodeScores.mockResolvedValue(mockScores);
      orchestrator.getScoreBreakdown.mockReturnValue({});

      const result = (await controller.getNodeScoreDetail('job-1', 'node-1')) as any;

      expect(result.nodeId).toBe('node-1');
      expect(result.totalScore).toBe(90);
    });

    it('should throw 404 when node score not found', async () => {
      orchestrator.getAllNodeScores.mockResolvedValue([]);

      await expect(controller.getNodeScoreDetail('job-1', 'node-999')).rejects.toThrow(
        HttpException
      );
    });
  });

  describe('assignJob', () => {
    it('should assign job successfully', async () => {
      const mockResult = { jobId: 'job-1', nodeId: 'node-1', status: 'assigned' };
      orchestrator.assignJob.mockResolvedValue(mockResult);

      const result = await controller.assignJob('job-1', { nodeId: 'node-1' });

      expect(result).toEqual(mockResult);
      expect(orchestrator.assignJob).toHaveBeenCalledWith('job-1', 'node-1');
    });

    it('should throw 404 when assignment fails', async () => {
      orchestrator.assignJob.mockResolvedValue(null);

      await expect(controller.assignJob('job-1', { nodeId: 'node-1' })).rejects.toThrow(
        HttpException
      );
    });
  });

  describe('rebalanceJobs', () => {
    it('should return rebalance result', async () => {
      orchestrator.rebalanceJobs.mockResolvedValue({
        migratedCount: 3,
        reasons: ['Load balancing'],
      });

      const result = await controller.rebalanceJobs();

      expect(result.success).toBe(true);
      expect(result.migratedCount).toBe(3);
    });
  });

  describe('getConfig', () => {
    it('should return existing config', async () => {
      const mockConfig = { id: 'default', isActive: true };
      orchestrator.getActiveConfig.mockResolvedValue(mockConfig);

      const result = await controller.getConfig();

      expect(result).toEqual(mockConfig);
    });
  });

  describe('updateConfig', () => {
    it('should update existing config', async () => {
      const updatedConfig = { id: 'default', isActive: true, weightRealTimeLoad: 3 };
      orchestrator.updateConfig.mockResolvedValue(updatedConfig);

      const result = (await controller.updateConfig({ weightRealTimeLoad: 3 })) as any;

      expect(result.weightRealTimeLoad).toBe(3);
    });
  });

  describe('getSummary', () => {
    it('should return distribution summary', async () => {
      const mockSummary = { totalJobs: 10, nodes: [] };
      orchestrator.getDistributionSummary.mockResolvedValue(mockSummary);

      const result = await controller.getSummary();

      expect(result).toEqual(mockSummary);
    });
  });

  describe('getNodeReliability', () => {
    it('should return reliability stats', async () => {
      reliabilityTracker.getFailureSummary.mockResolvedValue({
        count24h: 2,
        failureRate: 0.1,
      });
      reliabilityTracker.isUnreliable.mockReturnValue(false);

      const result = (await controller.getNodeReliability('node-1')) as any;

      expect(result.nodeId).toBe('node-1');
      expect(result.isUnreliable).toBe(false);
    });

    it('should flag unreliable nodes', async () => {
      reliabilityTracker.getFailureSummary.mockResolvedValue({
        count24h: 10,
        failureRate: 0.5,
      });
      reliabilityTracker.isUnreliable.mockReturnValue(true);

      const result = (await controller.getNodeReliability('node-1')) as any;

      expect(result.isUnreliable).toBe(true);
    });
  });

  describe('getNodesCapacity', () => {
    it('should return capacity for all online nodes', async () => {
      orchestrator.getNodesCapacity.mockResolvedValue({
        nodes: [
          { nodeId: 'node-1', cpuLoad: 50 },
          { nodeId: 'node-2', cpuLoad: 30 },
        ],
      });

      const result = (await controller.getNodesCapacity()) as any;

      expect(result.nodes).toHaveLength(2);
    });

    it('should return empty when no capacity data', async () => {
      orchestrator.getNodesCapacity.mockResolvedValue({ nodes: [] });

      const result = (await controller.getNodesCapacity()) as any;

      expect(result.nodes).toHaveLength(0);
    });
  });

  describe('simulateAssignment', () => {
    it('should return simulation result', async () => {
      orchestrator.findOptimalNode.mockResolvedValue({ nodeId: 'node-1', score: 95 });

      const result = (await controller.simulateAssignment('job-1')) as any;

      expect(result.simulation).toBe(true);
      expect(result.nodeId).toBe('node-1');
    });

    it('should throw 404 when no eligible nodes', async () => {
      orchestrator.findOptimalNode.mockResolvedValue(null);

      await expect(controller.simulateAssignment('job-1')).rejects.toThrow(HttpException);
    });
  });
});
