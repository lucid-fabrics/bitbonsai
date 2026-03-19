import { type INestApplication, NotFoundException, ValidationPipe } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { type Node } from '@prisma/client';
import request from 'supertest';
import { NodesController } from '../../nodes.controller';
import { NodesService } from '../../nodes.service';
import { JobAttributionService } from '../../services/job-attribution.service';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makeNode = (overrides: Partial<Node> = {}): Node =>
  ({
    id: 'node-1',
    name: 'Main Node',
    role: 'MAIN',
    status: 'ONLINE',
    version: '1.0.0',
    acceleration: 'CPU',
    apiKey: 'key-abc',
    lastHeartbeat: new Date('2024-01-01T00:00:00Z'),
    uptimeSeconds: 3600,
    maxWorkers: 4,
    cpuLimit: 80,
    licenseId: 'lic-1',
    networkLocation: 'LOCAL',
    hasSharedStorage: true,
    storageBasePath: '/mnt/media',
    latencyMs: null,
    bandwidthMbps: null,
    cpuCores: 8,
    ramGB: 32,
    maxTransferSizeMB: null,
    lastSpeedTest: null,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    ...overrides,
  }) as unknown as Node;

// ---------------------------------------------------------------------------
// Mock services
// ---------------------------------------------------------------------------

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
  recommendStorageMethod: jest.fn(),
};

const mockJobAttribution = {
  getAllNodeScores: jest.fn(),
  clearCache: jest.fn(),
};

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('Nodes HTTP endpoints (E2E — mocked services)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [NodesController],
      providers: [
        { provide: NodesService, useValue: mockNodesService },
        { provide: JobAttributionService, useValue: mockJobAttribution },
      ],
    }).compile();

    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // GET /nodes — all nodes
  // -------------------------------------------------------------------------
  describe('GET /nodes', () => {
    it('returns 200 with array of all nodes', async () => {
      const nodes = [makeNode(), makeNode({ id: 'node-2', name: 'Worker', role: 'LINKED' })];
      mockNodesService.findAll.mockResolvedValue(nodes);

      const res = await request(app.getHttpServer()).get('/nodes').expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body).toHaveLength(2);
      expect(mockNodesService.findAll).toHaveBeenCalledTimes(1);
    });

    it('returns 200 with empty array when no nodes registered', async () => {
      mockNodesService.findAll.mockResolvedValue([]);

      const res = await request(app.getHttpServer()).get('/nodes').expect(200);

      expect(res.body).toHaveLength(0);
    });

    it('returns 500 when service throws unexpected error', async () => {
      mockNodesService.findAll.mockRejectedValue(new Error('db connection failed'));

      await request(app.getHttpServer()).get('/nodes').expect(500);
    });
  });

  // -------------------------------------------------------------------------
  // GET /nodes/current — current node
  // -------------------------------------------------------------------------
  describe('GET /nodes/current', () => {
    it('returns 200 with current node info', async () => {
      const node = makeNode();
      mockNodesService.getCurrentNode.mockResolvedValue(node);

      const res = await request(app.getHttpServer()).get('/nodes/current').expect(200);

      expect(res.body.id).toBe('node-1');
      expect(res.body.role).toBe('MAIN');
    });

    it('returns 404 when no nodes registered', async () => {
      mockNodesService.getCurrentNode.mockRejectedValue(new NotFoundException('No nodes found'));

      await request(app.getHttpServer()).get('/nodes/current').expect(404);
    });
  });

  // -------------------------------------------------------------------------
  // GET /nodes/:id — single node
  // -------------------------------------------------------------------------
  describe('GET /nodes/:id', () => {
    it('returns 200 with node when found', async () => {
      const node = makeNode();
      mockNodesService.findOne.mockResolvedValue(node);

      const res = await request(app.getHttpServer()).get('/nodes/node-1').expect(200);

      expect(res.body.id).toBe('node-1');
      expect(res.body.name).toBe('Main Node');
      expect(mockNodesService.findOne).toHaveBeenCalledWith('node-1');
    });

    it('returns 404 when node does not exist', async () => {
      mockNodesService.findOne.mockRejectedValue(new NotFoundException('Node not found'));

      await request(app.getHttpServer()).get('/nodes/missing-id').expect(404);
    });
  });

  // -------------------------------------------------------------------------
  // PATCH /nodes/:id — update node
  // -------------------------------------------------------------------------
  describe('PATCH /nodes/:id', () => {
    it('returns 200 with updated node', async () => {
      const updated = makeNode({ maxWorkers: 6, name: 'Renamed Node' });
      mockNodesService.update.mockResolvedValue(updated);

      const res = await request(app.getHttpServer())
        .patch('/nodes/node-1')
        .send({ maxWorkers: 6, name: 'Renamed Node' })
        .expect(200);

      expect(res.body.id).toBe('node-1');
      expect(mockNodesService.update).toHaveBeenCalledWith('node-1', expect.anything());
    });

    it('returns 404 when node to update does not exist', async () => {
      mockNodesService.update.mockRejectedValue(new NotFoundException('Node not found'));

      await request(app.getHttpServer())
        .patch('/nodes/missing-id')
        .send({ maxWorkers: 2 })
        .expect(404);
    });
  });

  // -------------------------------------------------------------------------
  // POST /nodes/:id/heartbeat — update heartbeat
  // -------------------------------------------------------------------------
  describe('POST /nodes/:id/heartbeat', () => {
    it('returns 200 with updated node after heartbeat', async () => {
      const node = makeNode({ lastHeartbeat: new Date() });
      mockNodesService.heartbeat.mockResolvedValue(node);

      const res = await request(app.getHttpServer())
        .post('/nodes/node-1/heartbeat')
        .send({ cpuUsage: 42, memoryUsage: 60 })
        .expect(200);

      expect(res.body.id).toBe('node-1');
      expect(res.body.status).toBe('ONLINE');
      expect(mockNodesService.heartbeat).toHaveBeenCalledWith('node-1', expect.anything());
    });

    it('returns 200 with empty heartbeat body', async () => {
      const node = makeNode();
      mockNodesService.heartbeat.mockResolvedValue(node);

      const res = await request(app.getHttpServer())
        .post('/nodes/node-1/heartbeat')
        .send({})
        .expect(200);

      expect(res.body.id).toBe('node-1');
    });

    it('returns 404 when node does not exist', async () => {
      mockNodesService.heartbeat.mockRejectedValue(new NotFoundException('Node not found'));

      await request(app.getHttpServer()).post('/nodes/missing-id/heartbeat').send({}).expect(404);
    });
  });

  // -------------------------------------------------------------------------
  // DELETE /nodes/:id — delete node
  // -------------------------------------------------------------------------
  describe('DELETE /nodes/:id', () => {
    it('returns 204 on successful deletion', async () => {
      mockNodesService.remove.mockResolvedValue(undefined);

      await request(app.getHttpServer()).delete('/nodes/node-1').expect(204);

      expect(mockNodesService.remove).toHaveBeenCalledWith('node-1');
    });

    it('returns 404 when node to delete does not exist', async () => {
      mockNodesService.remove.mockRejectedValue(new NotFoundException('Node not found'));

      await request(app.getHttpServer()).delete('/nodes/missing-id').expect(404);
    });
  });

  // -------------------------------------------------------------------------
  // GET /nodes/scores — node attribution scores
  // -------------------------------------------------------------------------
  describe('GET /nodes/scores', () => {
    it('returns 200 with node scores array', async () => {
      const scores = [
        { nodeId: 'node-1', nodeName: 'Main Node', totalScore: 85, breakdown: { loadScore: 40 } },
      ];
      mockJobAttribution.getAllNodeScores.mockResolvedValue(scores);

      const res = await request(app.getHttpServer()).get('/nodes/scores').expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body[0].nodeId).toBe('node-1');
      expect(res.body[0].totalScore).toBe(85);
    });

    it('returns 500 when attribution service fails', async () => {
      mockJobAttribution.getAllNodeScores.mockRejectedValue(new Error('score calculation failed'));

      await request(app.getHttpServer()).get('/nodes/scores').expect(500);
    });
  });

  // -------------------------------------------------------------------------
  // POST /nodes/scores/clear-cache
  // -------------------------------------------------------------------------
  describe('POST /nodes/scores/clear-cache', () => {
    it('returns 200 with success message', async () => {
      const res = await request(app.getHttpServer()).post('/nodes/scores/clear-cache').expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.message).toBe('Score cache cleared');
      expect(mockJobAttribution.clearCache).toHaveBeenCalledTimes(1);
    });
  });

  // -------------------------------------------------------------------------
  // GET /nodes/:id/stats
  // -------------------------------------------------------------------------
  describe('GET /nodes/:id/stats', () => {
    it('returns 200 with node statistics', async () => {
      const stats = { activeJobs: 2, uptimeSeconds: 86400, libraries: [] };
      mockNodesService.getNodeStats.mockResolvedValue(stats);

      const res = await request(app.getHttpServer()).get('/nodes/node-1/stats').expect(200);

      expect(res.body.activeJobs).toBe(2);
      expect(mockNodesService.getNodeStats).toHaveBeenCalledWith('node-1');
    });

    it('returns 404 when node not found for stats', async () => {
      mockNodesService.getNodeStats.mockRejectedValue(new NotFoundException('Node not found'));

      await request(app.getHttpServer()).get('/nodes/missing-id/stats').expect(404);
    });
  });
});
