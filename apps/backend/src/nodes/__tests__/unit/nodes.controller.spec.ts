import { Test, type TestingModule } from '@nestjs/testing';
import { NodesController } from '../../nodes.controller';
import { NodesService } from '../../nodes.service';
import { JobAttributionService } from '../../services/job-attribution.service';

describe('NodesController', () => {
  let controller: NodesController;

  const mockNodesService = {
    heartbeat: jest.fn(),
    getCurrentNode: jest.fn(),
    findAll: jest.fn(),
    findOne: jest.fn(),
    getNodeStats: jest.fn(),
    getRecommendedConfig: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
    testNodeCapabilities: jest.fn(),
  };

  const mockJobAttribution = {
    getAllNodeScores: jest.fn(),
    clearCache: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [NodesController],
      providers: [
        { provide: NodesService, useValue: mockNodesService },
        { provide: JobAttributionService, useValue: mockJobAttribution },
      ],
    }).compile();

    controller = module.get<NodesController>(NodesController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('heartbeat', () => {
    it('should record heartbeat and return node dto', async () => {
      const heartbeatDto = { cpuUsage: 42, memoryUsage: 60 };
      const node = { id: 'node1', status: 'ONLINE', lastHeartbeat: new Date() };
      mockNodesService.heartbeat.mockResolvedValue(node);

      const result = await controller.heartbeat('node1', heartbeatDto as any);

      expect(mockNodesService.heartbeat).toHaveBeenCalledWith('node1', heartbeatDto);
      expect(result).toMatchObject({ id: 'node1', status: 'ONLINE' });
    });

    it('should propagate errors for unknown node', async () => {
      mockNodesService.heartbeat.mockRejectedValue(new Error('node not found'));
      await expect(controller.heartbeat('missing', undefined)).rejects.toThrow('node not found');
    });
  });

  describe('getCurrentNode', () => {
    it('should return current node info', async () => {
      const node = { id: 'node1', role: 'MAIN', version: '1.0.0', status: 'ONLINE' };
      mockNodesService.getCurrentNode.mockResolvedValue(node);

      const result = await controller.getCurrentNode();

      expect(mockNodesService.getCurrentNode).toHaveBeenCalledTimes(1);
      expect(result).toMatchObject({ id: 'node1', role: 'MAIN' });
    });

    it('should propagate errors when no nodes registered', async () => {
      mockNodesService.getCurrentNode.mockRejectedValue(new Error('no nodes found'));
      await expect(controller.getCurrentNode()).rejects.toThrow('no nodes found');
    });
  });

  describe('findAll', () => {
    it('should return all nodes as response dtos', async () => {
      const nodes = [
        { id: 'node1', name: 'Main', role: 'MAIN', status: 'ONLINE' },
        { id: 'node2', name: 'Worker', role: 'LINKED', status: 'ONLINE' },
      ];
      mockNodesService.findAll.mockResolvedValue(nodes);

      const result = await controller.findAll();

      expect(mockNodesService.findAll).toHaveBeenCalledTimes(1);
      expect(Array.isArray(result)).toBe(true);
    });

    it('should propagate service errors', async () => {
      mockNodesService.findAll.mockRejectedValue(new Error('db error'));
      await expect(controller.findAll()).rejects.toThrow('db error');
    });
  });

  describe('getNodeScores', () => {
    it('should return node scores from job attribution service', async () => {
      const scores = [{ nodeId: 'node1', nodeName: 'Main', totalScore: 85 }];
      mockJobAttribution.getAllNodeScores.mockResolvedValue(scores);

      const result = await controller.getNodeScores();

      expect(mockJobAttribution.getAllNodeScores).toHaveBeenCalledTimes(1);
      expect(result).toEqual(scores);
    });

    it('should propagate service errors', async () => {
      mockJobAttribution.getAllNodeScores.mockRejectedValue(new Error('score calc failed'));
      await expect(controller.getNodeScores()).rejects.toThrow('score calc failed');
    });
  });

  describe('findOne', () => {
    it('should return a single node as response dto', async () => {
      const node = { id: 'node1', name: 'Main', role: 'MAIN', status: 'ONLINE' };
      mockNodesService.findOne.mockResolvedValue(node);

      const result = await controller.findOne('node1');

      expect(mockNodesService.findOne).toHaveBeenCalledWith('node1');
      expect(result).toMatchObject({ id: 'node1', name: 'Main', role: 'MAIN' });
    });

    it('should propagate not found errors', async () => {
      mockNodesService.findOne.mockRejectedValue(new Error('not found'));
      await expect(controller.findOne('missing')).rejects.toThrow('not found');
    });
  });

  describe('getStats', () => {
    it('should return node statistics', async () => {
      const stats = { activeJobs: 2, uptimeSeconds: 86400, libraries: [] };
      mockNodesService.getNodeStats.mockResolvedValue(stats);

      const result = await controller.getStats('node1');

      expect(mockNodesService.getNodeStats).toHaveBeenCalledWith('node1');
      expect(result).toEqual(stats);
    });

    it('should propagate service errors', async () => {
      mockNodesService.getNodeStats.mockRejectedValue(new Error('stats error'));
      await expect(controller.getStats('node1')).rejects.toThrow('stats error');
    });
  });

  describe('getRecommendedConfig', () => {
    it('should return recommended configuration', async () => {
      const config = { maxWorkers: 4, reasoning: 'CPU: 8 cores, GPU: none' };
      mockNodesService.getRecommendedConfig.mockResolvedValue(config);

      const result = await controller.getRecommendedConfig('node1');

      expect(mockNodesService.getRecommendedConfig).toHaveBeenCalledWith('node1');
      expect(result).toEqual(config);
    });

    it('should propagate service errors', async () => {
      mockNodesService.getRecommendedConfig.mockRejectedValue(new Error('node not found'));
      await expect(controller.getRecommendedConfig('node1')).rejects.toThrow('node not found');
    });
  });

  describe('update', () => {
    it('should update node and return response dto', async () => {
      const dto = { maxWorkers: 6, name: 'Renamed Node' };
      const node = { id: 'node1', ...dto, status: 'ONLINE', role: 'MAIN' };
      mockNodesService.update.mockResolvedValue(node);

      const result = await controller.update('node1', dto as any);

      expect(mockNodesService.update).toHaveBeenCalledWith('node1', dto);
      expect(result).toMatchObject({ id: 'node1', role: 'MAIN' });
    });

    it('should propagate service errors', async () => {
      mockNodesService.update.mockRejectedValue(new Error('invalid update'));
      await expect(controller.update('node1', {} as any)).rejects.toThrow('invalid update');
    });
  });

  describe('remove', () => {
    it('should remove a node', async () => {
      mockNodesService.remove.mockResolvedValue(undefined);

      await controller.remove('node1');

      expect(mockNodesService.remove).toHaveBeenCalledWith('node1');
    });

    it('should propagate errors for unknown node', async () => {
      mockNodesService.remove.mockRejectedValue(new Error('not found'));
      await expect(controller.remove('missing')).rejects.toThrow('not found');
    });
  });

  describe('testNodeCapabilities', () => {
    it('should delegate to nodesService and return test results', async () => {
      const testResult = {
        nodeId: 'node1',
        nodeName: 'Worker',
        latencyMs: 5,
        isPrivateIP: true,
        hasSharedStorage: true,
        storageBasePath: '/mnt/media',
        networkLocation: 'LOCAL',
        tests: {
          networkConnection: { status: 'success', message: 'Latency: 5ms' },
        },
      };
      mockNodesService.testNodeCapabilities.mockResolvedValue(testResult);

      const result = await controller.testNodeCapabilities('node1');

      expect(mockNodesService.testNodeCapabilities).toHaveBeenCalledWith('node1');
      expect(result).toMatchObject({ nodeId: 'node1', nodeName: 'Worker' });
    });

    it('should propagate service errors', async () => {
      mockNodesService.testNodeCapabilities.mockRejectedValue(new Error('not found'));
      await expect(controller.testNodeCapabilities('missing')).rejects.toThrow('not found');
    });
  });

  describe('getNodeCapabilities', () => {
    it('should return node capability summary', async () => {
      const node = {
        id: 'node1',
        name: 'Worker',
        networkLocation: 'LOCAL',
        hasSharedStorage: true,
        storageBasePath: '/mnt/media',
        latencyMs: 3,
        bandwidthMbps: 950,
        cpuCores: 8,
        ramGB: 32,
        maxTransferSizeMB: 1024,
        lastSpeedTest: new Date(),
      };
      mockNodesService.findOne.mockResolvedValue(node);

      const result = await controller.getNodeCapabilities('node1');

      expect(mockNodesService.findOne).toHaveBeenCalledWith('node1');
      expect(result).toMatchObject({
        nodeId: 'node1',
        nodeName: 'Worker',
        networkLocation: 'LOCAL',
      });
    });

    it('should propagate errors', async () => {
      mockNodesService.findOne.mockRejectedValue(new Error('not found'));
      await expect(controller.getNodeCapabilities('missing')).rejects.toThrow('not found');
    });
  });

  describe('clearScoreCache', () => {
    it('should clear score cache and return success', async () => {
      const result = await controller.clearScoreCache();

      expect(mockJobAttribution.clearCache).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ success: true, message: 'Score cache cleared' });
    });
  });
});
