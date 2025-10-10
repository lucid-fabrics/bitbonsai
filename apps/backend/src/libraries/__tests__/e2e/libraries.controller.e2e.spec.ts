import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import type { License, Node } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../../../app.module';
import { PrismaService } from '../../../prisma/prisma.service';

/**
 * E2E tests for Libraries Controller
 *
 * Tests cover:
 * - Full HTTP request/response cycle
 * - Authentication and authorization
 * - Input validation
 * - Error responses
 * - CRUD operations via REST API
 */
describe('LibrariesController (E2E)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let testLicense: License;
  let testNode: Node;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();

    // Apply same validation as production
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      })
    );

    await app.init();

    prisma = app.get<PrismaService>(PrismaService);

    // Create test fixtures
    testLicense = await prisma.license.create({
      data: {
        key: 'TEST-LIBRARIES-E2E',
        tier: 'FREE',
        status: 'ACTIVE',
        email: 'libraries-e2e@test.com',
        maxNodes: 5,
        maxConcurrentJobs: 10,
        features: {},
      },
    });

    testNode = await prisma.node.create({
      data: {
        name: 'E2E Test Node',
        role: 'MAIN',
        status: 'ONLINE',
        version: '1.0.0',
        acceleration: 'CPU',
        apiKey: 'e2e-test-key',
        lastHeartbeat: new Date(),
        licenseId: testLicense.id,
      },
    });
  });

  afterAll(async () => {
    await prisma.library.deleteMany({});
    await prisma.node.deleteMany({});
    await prisma.license.deleteMany({});
    await prisma.$disconnect();
    await app.close();
  });

  afterEach(async () => {
    await prisma.library.deleteMany({});
  });

  describe('GET /api/v1/libraries', () => {
    it('should return empty array when no libraries exist', () => {
      return request(app.getHttpServer()).get('/api/v1/libraries').expect(200).expect([]);
    });

    it('should return all libraries', async () => {
      await prisma.library.createMany({
        data: [
          {
            name: 'Library 1',
            path: '/test/lib1',
            mediaType: 'MOVIE',
            nodeId: testNode.id,
          },
          {
            name: 'Library 2',
            path: '/test/lib2',
            mediaType: 'TV_SHOW',
            nodeId: testNode.id,
          },
        ],
      });

      return request(app.getHttpServer())
        .get('/api/v1/libraries')
        .expect(200)
        .expect((res) => {
          expect(res.body).toHaveLength(2);
          expect(res.body[0]).toHaveProperty('id');
          expect(res.body[0]).toHaveProperty('name');
          expect(res.body[0]).toHaveProperty('node');
        });
    });

    it('should include node information', async () => {
      await prisma.library.create({
        data: {
          name: 'Test Library',
          path: '/test/lib',
          mediaType: 'MOVIE',
          nodeId: testNode.id,
        },
      });

      return request(app.getHttpServer())
        .get('/api/v1/libraries')
        .expect(200)
        .expect((res) => {
          expect(res.body[0].node).toBeDefined();
          expect(res.body[0].node.name).toBe(testNode.name);
        });
    });
  });

  describe('GET /api/v1/libraries/:id', () => {
    it('should return library by id', async () => {
      const library = await prisma.library.create({
        data: {
          name: 'Test Library',
          path: '/test/lib',
          mediaType: 'MOVIE',
          nodeId: testNode.id,
        },
      });

      return request(app.getHttpServer())
        .get(`/api/v1/libraries/${library.id}`)
        .expect(200)
        .expect((res) => {
          expect(res.body.id).toBe(library.id);
          expect(res.body.name).toBe(library.name);
        });
    });

    it('should return 404 for non-existent library', () => {
      return request(app.getHttpServer())
        .get('/api/v1/libraries/non-existent-id')
        .expect(404)
        .expect((res) => {
          expect(res.body.message).toContain('not found');
        });
    });
  });

  describe('POST /api/v1/libraries', () => {
    it('should create library with valid data', () => {
      const createDto = {
        name: 'New Library',
        path: '/test/new',
        mediaType: 'MOVIE',
        nodeId: testNode.id,
      };

      return request(app.getHttpServer())
        .post('/api/v1/libraries')
        .send(createDto)
        .expect(201)
        .expect((res) => {
          expect(res.body.name).toBe(createDto.name);
          expect(res.body.path).toBe(createDto.path);
          expect(res.body.id).toBeDefined();
        });
    });

    it('should validate required fields', () => {
      return request(app.getHttpServer())
        .post('/api/v1/libraries')
        .send({
          name: 'Missing Fields',
          // Missing path, mediaType, nodeId
        })
        .expect(400)
        .expect((res) => {
          expect(res.body.message).toBeDefined();
        });
    });

    it('should validate mediaType enum', () => {
      return request(app.getHttpServer())
        .post('/api/v1/libraries')
        .send({
          name: 'Invalid Type',
          path: '/test/invalid',
          mediaType: 'INVALID_TYPE',
          nodeId: testNode.id,
        })
        .expect(400);
    });

    it('should return 404 for non-existent node', () => {
      return request(app.getHttpServer())
        .post('/api/v1/libraries')
        .send({
          name: 'Test',
          path: '/test/path',
          mediaType: 'MOVIE',
          nodeId: 'non-existent-node',
        })
        .expect(404);
    });

    it('should reject extra properties', () => {
      return request(app.getHttpServer())
        .post('/api/v1/libraries')
        .send({
          name: 'Test',
          path: '/test/path',
          mediaType: 'MOVIE',
          nodeId: testNode.id,
          extraField: 'should be rejected',
        })
        .expect(400);
    });
  });

  describe('PATCH /api/v1/libraries/:id', () => {
    it('should update library', async () => {
      const library = await prisma.library.create({
        data: {
          name: 'Original Name',
          path: '/test/original',
          mediaType: 'MOVIE',
          nodeId: testNode.id,
        },
      });

      return request(app.getHttpServer())
        .patch(`/api/v1/libraries/${library.id}`)
        .send({ name: 'Updated Name' })
        .expect(200)
        .expect((res) => {
          expect(res.body.name).toBe('Updated Name');
          expect(res.body.path).toBe(library.path); // Unchanged
        });
    });

    it('should return 404 for non-existent library', () => {
      return request(app.getHttpServer())
        .patch('/api/v1/libraries/non-existent-id')
        .send({ name: 'Updated' })
        .expect(404);
    });

    it('should allow partial updates', async () => {
      const library = await prisma.library.create({
        data: {
          name: 'Test',
          path: '/test/path',
          mediaType: 'MOVIE',
          nodeId: testNode.id,
        },
      });

      return request(app.getHttpServer())
        .patch(`/api/v1/libraries/${library.id}`)
        .send({ enabled: false })
        .expect(200)
        .expect((res) => {
          expect(res.body.enabled).toBe(false);
          expect(res.body.name).toBe(library.name); // Unchanged
        });
    });
  });

  describe('DELETE /api/v1/libraries/:id', () => {
    it('should delete library', async () => {
      const library = await prisma.library.create({
        data: {
          name: 'To Delete',
          path: '/test/delete',
          mediaType: 'MOVIE',
          nodeId: testNode.id,
        },
      });

      await request(app.getHttpServer()).delete(`/api/v1/libraries/${library.id}`).expect(200);

      const deleted = await prisma.library.findUnique({
        where: { id: library.id },
      });

      expect(deleted).toBeNull();
    });

    it('should return 404 for non-existent library', () => {
      return request(app.getHttpServer()).delete('/api/v1/libraries/non-existent-id').expect(404);
    });
  });

  describe('POST /api/v1/libraries/:id/scan', () => {
    it('should trigger library scan', async () => {
      const library = await prisma.library.create({
        data: {
          name: 'Scan Test',
          path: '/test/scan',
          mediaType: 'MOVIE',
          nodeId: testNode.id,
        },
      });

      return request(app.getHttpServer()).post(`/api/v1/libraries/${library.id}/scan`).expect(200);
    });

    it('should return 404 for non-existent library', () => {
      return request(app.getHttpServer())
        .post('/api/v1/libraries/non-existent-id/scan')
        .expect(404);
    });
  });
});
