import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import type { License } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../../../app.module';
import { PrismaService } from '../../../prisma/prisma.service';

/**
 * E2E tests for Nodes Controller
 *
 * Tests cover:
 * - Node registration and pairing workflow
 * - Heartbeat mechanism
 * - Node status management
 * - API key authentication
 */
describe('NodesController (E2E)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let testLicense: License;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();

    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      })
    );

    await app.init();

    prisma = app.get<PrismaService>(PrismaService);

    testLicense = await prisma.license.create({
      data: {
        key: 'TEST-NODES-E2E',
        tier: 'FREE',
        status: 'ACTIVE',
        email: 'nodes-e2e@test.com',
        maxNodes: 5,
        maxConcurrentJobs: 10,
        features: {},
      },
    });
  });

  afterAll(async () => {
    await prisma.node.deleteMany({});
    await prisma.license.deleteMany({});
    await prisma.$disconnect();
    await app.close();
  });

  afterEach(async () => {
    await prisma.node.deleteMany({});
  });

  describe('GET /api/v1/nodes', () => {
    it('should return empty array when no nodes exist', () => {
      return request(app.getHttpServer()).get('/api/v1/nodes').expect(200).expect([]);
    });

    it('should return all nodes', async () => {
      await prisma.node.createMany({
        data: [
          {
            name: 'Node 1',
            role: 'MAIN',
            status: 'ONLINE',
            version: '1.0.0',
            acceleration: 'CPU',
            apiKey: 'key1',
            lastHeartbeat: new Date(),
            licenseId: testLicense.id,
          },
          {
            name: 'Node 2',
            role: 'LINKED',
            status: 'OFFLINE',
            version: '1.0.0',
            acceleration: 'NVIDIA',
            apiKey: 'key2',
            lastHeartbeat: new Date(),
            licenseId: testLicense.id,
          },
        ],
      });

      return request(app.getHttpServer())
        .get('/api/v1/nodes')
        .expect(200)
        .expect((res) => {
          expect(res.body).toHaveLength(2);
          expect(res.body[0]).toHaveProperty('id');
          expect(res.body[0]).toHaveProperty('name');
          expect(res.body[0]).toHaveProperty('status');
        });
    });
  });

  describe('GET /api/v1/nodes/:id', () => {
    it('should return node by id', async () => {
      const node = await prisma.node.create({
        data: {
          name: 'Test Node',
          role: 'MAIN',
          status: 'ONLINE',
          version: '1.0.0',
          acceleration: 'CPU',
          apiKey: 'test-key',
          lastHeartbeat: new Date(),
          licenseId: testLicense.id,
        },
      });

      return request(app.getHttpServer())
        .get(`/api/v1/nodes/${node.id}`)
        .expect(200)
        .expect((res) => {
          expect(res.body.id).toBe(node.id);
          expect(res.body.name).toBe(node.name);
        });
    });

    it('should return 404 for non-existent node', () => {
      return request(app.getHttpServer()).get('/api/v1/nodes/non-existent-id').expect(404);
    });
  });

  describe('POST /api/v1/nodes/register', () => {
    it('should register new main node', () => {
      const registerDto = {
        name: 'New Main Node',
        version: '1.0.0',
        acceleration: 'CPU',
        licenseKey: testLicense.key,
      };

      return request(app.getHttpServer())
        .post('/api/v1/nodes/register')
        .send(registerDto)
        .expect(201)
        .expect((res) => {
          expect(res.body.node).not.toBeNull();
          expect(res.body.node.name).toBe(registerDto.name);
          expect(res.body.node.role).toBe('MAIN');
          expect(typeof res.body.apiKey).toBe('string');
        });
    });

    it('should validate required fields', () => {
      return request(app.getHttpServer())
        .post('/api/v1/nodes/register')
        .send({
          name: 'Incomplete',
          // Missing version, acceleration, licenseKey
        })
        .expect(400);
    });

    it('should reject invalid license key', () => {
      return request(app.getHttpServer())
        .post('/api/v1/nodes/register')
        .send({
          name: 'Invalid License',
          version: '1.0.0',
          acceleration: 'CPU',
          licenseKey: 'INVALID-KEY',
        })
        .expect(403);
    });

    it('should validate acceleration enum', () => {
      return request(app.getHttpServer())
        .post('/api/v1/nodes/register')
        .send({
          name: 'Test',
          version: '1.0.0',
          acceleration: 'INVALID',
          licenseKey: testLicense.key,
        })
        .expect(400);
    });
  });

  describe('POST /api/v1/nodes/pair', () => {
    it('should pair linked node with valid pairing code', async () => {
      // First register a main node to get pairing code
      const _mainNode = await prisma.node.create({
        data: {
          name: 'Main Node',
          role: 'MAIN',
          status: 'ONLINE',
          version: '1.0.0',
          acceleration: 'CPU',
          apiKey: 'main-key',
          pairingCode: '123456',
          pairingExpiresAt: new Date(Date.now() + 300000), // 5 minutes
          lastHeartbeat: new Date(),
          licenseId: testLicense.id,
        },
      });

      const pairDto = {
        name: 'Linked Node',
        version: '1.0.0',
        acceleration: 'NVIDIA',
        pairingCode: '123456',
      };

      return request(app.getHttpServer())
        .post('/api/v1/nodes/pair')
        .send(pairDto)
        .expect(201)
        .expect((res) => {
          expect(res.body.node).not.toBeNull();
          expect(res.body.node.role).toBe('LINKED');
          expect(typeof res.body.apiKey).toBe('string');
        });
    });

    it('should reject expired pairing code', async () => {
      await prisma.node.create({
        data: {
          name: 'Main Node',
          role: 'MAIN',
          status: 'ONLINE',
          version: '1.0.0',
          acceleration: 'CPU',
          apiKey: 'main-key',
          pairingCode: '999999',
          pairingExpiresAt: new Date(Date.now() - 1000), // Expired
          lastHeartbeat: new Date(),
          licenseId: testLicense.id,
        },
      });

      return request(app.getHttpServer())
        .post('/api/v1/nodes/pair')
        .send({
          name: 'Linked',
          version: '1.0.0',
          acceleration: 'CPU',
          pairingCode: '999999',
        })
        .expect(400);
    });

    it('should reject invalid pairing code', () => {
      return request(app.getHttpServer())
        .post('/api/v1/nodes/pair')
        .send({
          name: 'Linked',
          version: '1.0.0',
          acceleration: 'CPU',
          pairingCode: 'INVALID',
        })
        .expect(404);
    });
  });

  describe('POST /api/v1/nodes/:id/heartbeat', () => {
    it('should update node heartbeat', async () => {
      const node = await prisma.node.create({
        data: {
          name: 'Heartbeat Node',
          role: 'MAIN',
          status: 'ONLINE',
          version: '1.0.0',
          acceleration: 'CPU',
          apiKey: 'heartbeat-key',
          lastHeartbeat: new Date(Date.now() - 60000), // 1 minute ago
          licenseId: testLicense.id,
        },
      });

      const before = new Date();

      await request(app.getHttpServer())
        .post(`/api/v1/nodes/${node.id}/heartbeat`)
        .send({})
        .expect(200);

      const updated = await prisma.node.findUnique({ where: { id: node.id } });

      expect(updated?.lastHeartbeat.getTime()).toBeGreaterThanOrEqual(before.getTime());
    });

    it('should update node status to ONLINE', async () => {
      const node = await prisma.node.create({
        data: {
          name: 'Offline Node',
          role: 'MAIN',
          status: 'OFFLINE',
          version: '1.0.0',
          acceleration: 'CPU',
          apiKey: 'offline-key',
          lastHeartbeat: new Date(),
          licenseId: testLicense.id,
        },
      });

      await request(app.getHttpServer())
        .post(`/api/v1/nodes/${node.id}/heartbeat`)
        .send({})
        .expect(200);

      const updated = await prisma.node.findUnique({ where: { id: node.id } });

      expect(updated?.status).toBe('ONLINE');
    });

    it('should return 404 for non-existent node', () => {
      return request(app.getHttpServer())
        .post('/api/v1/nodes/non-existent-id/heartbeat')
        .send({})
        .expect(404);
    });
  });

  describe('DELETE /api/v1/nodes/:id', () => {
    it('should delete node', async () => {
      const node = await prisma.node.create({
        data: {
          name: 'To Delete',
          role: 'LINKED',
          status: 'OFFLINE',
          version: '1.0.0',
          acceleration: 'CPU',
          apiKey: 'delete-key',
          lastHeartbeat: new Date(),
          licenseId: testLicense.id,
        },
      });

      await request(app.getHttpServer()).delete(`/api/v1/nodes/${node.id}`).expect(200);

      const deleted = await prisma.node.findUnique({ where: { id: node.id } });

      expect(deleted).toBeNull();
    });

    it('should return 404 for non-existent node', () => {
      return request(app.getHttpServer()).delete('/api/v1/nodes/non-existent-id').expect(404);
    });
  });
});
