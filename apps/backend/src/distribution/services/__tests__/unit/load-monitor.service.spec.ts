import { Test, type TestingModule } from '@nestjs/testing';
import type { Node } from '@prisma/client';
import { PrismaService } from '../../../../prisma/prisma.service';
import { createMockPrismaService } from '../../../../testing/mock-providers';
import type { HeartbeatLoadData } from '../../../interfaces/scoring-factors.interface';
import { LoadMonitorService } from '../../load-monitor.service';

describe('LoadMonitorService', () => {
  let service: LoadMonitorService;
  let prisma: ReturnType<typeof createMockPrismaService>;

  beforeEach(async () => {
    prisma = createMockPrismaService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [LoadMonitorService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get<LoadMonitorService>(LoadMonitorService);

    jest.spyOn((service as any).logger, 'log').mockImplementation();
    jest.spyOn((service as any).logger, 'warn').mockImplementation();
    jest.spyOn((service as any).logger, 'debug').mockImplementation();
    jest.spyOn((service as any).logger, 'error').mockImplementation();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  const createMockNode = (overrides: Partial<Node> = {}): Node =>
    ({
      id: 'node-1',
      name: 'Test Node',
      cpuCores: 8,
      hasGpu: false,
      loadThresholdMultiplier: 3.0,
      maxWorkers: 2,
      ...overrides,
    }) as Node;

  const createLoadData = (overrides: Partial<HeartbeatLoadData> = {}): HeartbeatLoadData => ({
    load1m: 2.0,
    load5m: 1.8,
    load15m: 1.5,
    memFreeGB: 16,
    memTotalGB: 32,
    cpuCount: 8,
    timestamp: new Date(),
    ...overrides,
  });

  describe('updateFromHeartbeat', () => {
    it('should update cache and database with load data', async () => {
      prisma.node.update.mockResolvedValue({});

      await service.updateFromHeartbeat('node-1', {
        load1m: 2.5,
        load5m: 2.0,
        load15m: 1.5,
        memFreeGB: 12,
        memTotalGB: 32,
        cpuCount: 8,
      });

      expect(prisma.node.update).toHaveBeenCalledWith({
        where: { id: 'node-1' },
        data: {
          currentSystemLoad: 2.5,
          currentMemoryFreeGB: 12,
          lastHeartbeatLoad: expect.objectContaining({ load1m: 2.5 }),
        },
      });
    });

    it('should make load data available via cache', async () => {
      prisma.node.update.mockResolvedValue({});

      await service.updateFromHeartbeat('node-1', {
        load1m: 1.0,
        load5m: 0.8,
        load15m: 0.5,
        memFreeGB: 20,
        memTotalGB: 32,
        cpuCount: 8,
      });

      const loadData = await service.getNodeLoad('node-1');
      expect(loadData).not.toBeNull();
      expect(loadData!.load1m).toBe(1.0);
      expect(loadData!.memFreeGB).toBe(20);
    });
  });

  describe('getNodeLoad', () => {
    it('should return cached data if fresh (< 2 minutes)', async () => {
      prisma.node.update.mockResolvedValue({});

      await service.updateFromHeartbeat('node-1', {
        load1m: 3.0,
        load5m: 2.5,
        load15m: 2.0,
        memFreeGB: 8,
        memTotalGB: 32,
        cpuCount: 8,
      });

      const result = await service.getNodeLoad('node-1');
      expect(result).not.toBeNull();
      expect(result!.load1m).toBe(3.0);
      // Should not hit database since cache is fresh
      expect(prisma.node.findUnique).not.toHaveBeenCalled();
    });

    it('should fall back to database if cache is stale', async () => {
      prisma.node.findUnique.mockResolvedValue({
        lastHeartbeatLoad: {
          load1m: 5.0,
          load5m: 4.0,
          load15m: 3.0,
          memFreeGB: 6,
          memTotalGB: 32,
          cpuCount: 8,
        },
        currentSystemLoad: 5.0,
        currentMemoryFreeGB: 6,
        cpuCores: 8,
      });

      // No cache set, so it should fetch from DB
      const result = await service.getNodeLoad('node-1');
      expect(result).not.toBeNull();
      expect(result!.load1m).toBe(5.0);
      expect(prisma.node.findUnique).toHaveBeenCalledWith({
        where: { id: 'node-1' },
        select: expect.objectContaining({
          lastHeartbeatLoad: true,
          currentSystemLoad: true,
        }),
      });
    });

    it('should return null if no data in cache or database', async () => {
      prisma.node.findUnique.mockResolvedValue(null);

      const result = await service.getNodeLoad('unknown-node');
      expect(result).toBeNull();
    });

    it('should return null if node exists but has no heartbeat data', async () => {
      prisma.node.findUnique.mockResolvedValue({
        lastHeartbeatLoad: null,
        currentSystemLoad: null,
        currentMemoryFreeGB: null,
        cpuCores: 8,
      });

      const result = await service.getNodeLoad('node-1');
      expect(result).toBeNull();
    });
  });

  describe('calculateLoadScore', () => {
    it('should return 15 when no load data is available', () => {
      const node = createMockNode();
      const score = service.calculateLoadScore(node, null);
      expect(score).toBe(15);
    });

    it('should return 30 for an idle node (zero load)', () => {
      const node = createMockNode({ cpuCores: 8 });
      const loadData = createLoadData({ load1m: 0, memFreeGB: 16 });
      const score = service.calculateLoadScore(node, loadData);
      expect(score).toBe(30);
    });

    it('should return 0 for a fully loaded node', () => {
      const node = createMockNode({ cpuCores: 8, loadThresholdMultiplier: 3.0 });
      // Threshold = 8 * 3.0 = 24. Load at 24 = 100%
      const loadData = createLoadData({ load1m: 24, memFreeGB: 16 });
      const score = service.calculateLoadScore(node, loadData);
      expect(score).toBe(0);
    });

    it('should return 0 for overloaded nodes (beyond threshold)', () => {
      const node = createMockNode({ cpuCores: 8, loadThresholdMultiplier: 3.0 });
      const loadData = createLoadData({ load1m: 50, memFreeGB: 16 });
      const score = service.calculateLoadScore(node, loadData);
      expect(score).toBe(0);
    });

    it('should give intermediate score for partial load', () => {
      const node = createMockNode({ cpuCores: 8, loadThresholdMultiplier: 3.0 });
      // Threshold = 24. Load 12 = 50% => score ~15
      const loadData = createLoadData({ load1m: 12, memFreeGB: 16 });
      const score = service.calculateLoadScore(node, loadData);
      expect(score).toBe(15);
    });

    it('should apply memory penalty when free memory is below 4GB', () => {
      const node = createMockNode({ cpuCores: 8 });
      // Low load but low memory
      const loadData = createLoadData({ load1m: 0, memFreeGB: 2 });
      const score = service.calculateLoadScore(node, loadData);
      // 30 (full load score) - 4 (memory penalty: (4-2)*2) = 26
      expect(score).toBe(26);
    });

    it('should apply max memory penalty when memory is 0', () => {
      const node = createMockNode({ cpuCores: 8 });
      const loadData = createLoadData({ load1m: 0, memFreeGB: 0 });
      const score = service.calculateLoadScore(node, loadData);
      // 30 - 8 (penalty: 4*2) = 22
      expect(score).toBe(22);
    });

    it('should not go below 0 even with combined penalties', () => {
      const node = createMockNode({ cpuCores: 8, loadThresholdMultiplier: 3.0 });
      const loadData = createLoadData({ load1m: 24, memFreeGB: 0 });
      const score = service.calculateLoadScore(node, loadData);
      expect(score).toBe(0);
    });

    it('should use node.cpuCores when loadData.cpuCount is missing', () => {
      const node = createMockNode({ cpuCores: 4, loadThresholdMultiplier: 3.0 });
      const loadData = createLoadData({ load1m: 6, cpuCount: 0, memFreeGB: 16 });
      // cpuCount=0, so uses node.cpuCores=4. Threshold=4*3=12. load ratio=6/12=0.5
      const score = service.calculateLoadScore(node, loadData);
      expect(score).toBe(15);
    });

    it('should use default multiplier of 3.0 when not set', () => {
      const node = createMockNode({ cpuCores: 4, loadThresholdMultiplier: null as any });
      // Default multiplier = 3.0, cpuCount from loadData=4, threshold = 4*3=12
      const loadData = createLoadData({ load1m: 12, memFreeGB: 16, cpuCount: 4 });
      const score = service.calculateLoadScore(node, loadData);
      expect(score).toBe(0);
    });
  });

  describe('isOverloaded', () => {
    it('should return not overloaded when no load data', () => {
      const node = createMockNode();
      const result = service.isOverloaded(node, null);
      expect(result.isOverloaded).toBe(false);
      expect(result.reason).toBeUndefined();
    });

    it('should detect CPU overload', () => {
      const node = createMockNode({ cpuCores: 8, loadThresholdMultiplier: 3.0 });
      // Threshold = 24, load = 25 => overloaded
      const loadData = createLoadData({ load1m: 25, memFreeGB: 16 });
      const result = service.isOverloaded(node, loadData);
      expect(result.isOverloaded).toBe(true);
      expect(result.reason).toContain('CPU load');
    });

    it('should detect memory exhaustion', () => {
      const node = createMockNode({ cpuCores: 8 });
      const loadData = createLoadData({ load1m: 1, memFreeGB: 1.5 });
      const result = service.isOverloaded(node, loadData);
      expect(result.isOverloaded).toBe(true);
      expect(result.reason).toContain('Memory');
    });

    it('should return not overloaded for healthy node', () => {
      const node = createMockNode({ cpuCores: 8, loadThresholdMultiplier: 3.0 });
      const loadData = createLoadData({ load1m: 5, memFreeGB: 16 });
      const result = service.isOverloaded(node, loadData);
      expect(result.isOverloaded).toBe(false);
    });

    it('should check CPU before memory', () => {
      const node = createMockNode({ cpuCores: 8, loadThresholdMultiplier: 3.0 });
      // Both CPU and memory are overloaded
      const loadData = createLoadData({ load1m: 30, memFreeGB: 1 });
      const result = service.isOverloaded(node, loadData);
      expect(result.isOverloaded).toBe(true);
      expect(result.reason).toContain('CPU load'); // CPU checked first
    });
  });

  describe('getNodeCapacity', () => {
    it('should return null for unknown node', async () => {
      prisma.node.findUnique.mockResolvedValue(null);
      const result = await service.getNodeCapacity('unknown');
      expect(result).toBeNull();
    });

    it('should return capacity for a healthy node', async () => {
      prisma.node.findUnique.mockResolvedValue({
        id: 'node-1',
        name: 'Test Node',
        role: 'MAIN',
        maxWorkers: 4,
        cpuCores: 8,
        loadThresholdMultiplier: 3.0,
        estimatedFreeAt: null,
        lastHeartbeatLoad: null,
        currentSystemLoad: null,
        currentMemoryFreeGB: null,
        _count: { jobs: 2 },
      });
      prisma.job.count.mockResolvedValue(3);

      const result = await service.getNodeCapacity('node-1');
      expect(result).not.toBeNull();
      expect(result!.maxWorkers).toBe(4);
      expect(result!.activeJobs).toBe(2);
      expect(result!.availableSlots).toBe(2);
      expect(result!.queuedJobs).toBe(3);
    });

    it('should report zero available slots when fully busy', async () => {
      prisma.node.findUnique.mockResolvedValue({
        id: 'node-1',
        name: 'Test Node',
        role: 'LINKED',
        maxWorkers: 2,
        cpuCores: 4,
        loadThresholdMultiplier: 3.0,
        estimatedFreeAt: null,
        lastHeartbeatLoad: null,
        currentSystemLoad: null,
        currentMemoryFreeGB: null,
        _count: { jobs: 3 }, // More active than max workers
      });
      prisma.job.count.mockResolvedValue(0);

      const result = await service.getNodeCapacity('node-1');
      expect(result!.availableSlots).toBe(0);
    });
  });

  describe('getAllNodesLoad', () => {
    it('should return empty map when no nodes online', async () => {
      prisma.node.findMany.mockResolvedValue([]);
      const result = await service.getAllNodesLoad();
      expect(result.size).toBe(0);
    });

    it('should use cached data for nodes with fresh cache', async () => {
      prisma.node.update.mockResolvedValue({});

      // Prime cache
      await service.updateFromHeartbeat('node-1', {
        load1m: 2.0,
        load5m: 1.5,
        load15m: 1.0,
        memFreeGB: 16,
        memTotalGB: 32,
        cpuCount: 8,
      });

      prisma.node.findMany.mockResolvedValue([
        {
          id: 'node-1',
          lastHeartbeatLoad: null,
          currentSystemLoad: null,
          currentMemoryFreeGB: null,
          cpuCores: 8,
        },
      ]);

      const result = await service.getAllNodesLoad();
      expect(result.size).toBe(1);
      expect(result.get('node-1')!.load1m).toBe(2.0);
    });

    it('should fall back to database data for stale cache', async () => {
      prisma.node.findMany.mockResolvedValue([
        {
          id: 'node-2',
          lastHeartbeatLoad: {
            load1m: 4.0,
            load5m: 3.0,
            load15m: 2.0,
            memFreeGB: 10,
            memTotalGB: 32,
            cpuCount: 8,
          },
          currentSystemLoad: 4.0,
          currentMemoryFreeGB: 10,
          cpuCores: 8,
        },
      ]);

      const result = await service.getAllNodesLoad();
      expect(result.size).toBe(1);
      expect(result.get('node-2')!.load1m).toBe(4.0);
    });

    it('should skip nodes without heartbeat data', async () => {
      prisma.node.findMany.mockResolvedValue([
        {
          id: 'node-3',
          lastHeartbeatLoad: null,
          currentSystemLoad: null,
          currentMemoryFreeGB: null,
          cpuCores: 4,
        },
      ]);

      const result = await service.getAllNodesLoad();
      expect(result.size).toBe(0);
    });
  });

  describe('clearNodeCache', () => {
    it('should remove cached data for a node', async () => {
      prisma.node.update.mockResolvedValue({});

      await service.updateFromHeartbeat('node-1', {
        load1m: 1.0,
        load5m: 0.8,
        load15m: 0.5,
        memFreeGB: 16,
        memTotalGB: 32,
        cpuCount: 8,
      });

      service.clearNodeCache('node-1');

      // Now getNodeLoad should fall through to database
      prisma.node.findUnique.mockResolvedValue(null);
      const result = await service.getNodeLoad('node-1');
      expect(result).toBeNull();
    });
  });
});
