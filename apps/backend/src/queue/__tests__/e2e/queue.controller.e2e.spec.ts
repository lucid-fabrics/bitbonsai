import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import type { License, Node, Library, Policy } from '@prisma/client';
import * as request from 'supertest';
import { AppModule } from '../../../app.module';
import { PrismaService } from '../../../prisma/prisma.service';

/**
 * E2E tests for Queue Controller
 *
 * Tests cover:
 * - Job queue management
 * - Job state transitions
 * - Job filtering and pagination
 * - Job completion and failure handling
 */
describe('QueueController (E2E)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let testLicense: License;
  let testNode: Node;
  let testLibrary: Library;
  let testPolicy: Policy;

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

    // Create test fixtures
    testLicense = await prisma.license.create({
      data: {
        key: 'TEST-QUEUE-E2E',
        tier: 'FREE',
        status: 'ACTIVE',
        email: 'queue-e2e@test.com',
        maxNodes: 5,
        maxConcurrentJobs: 10,
        features: {},
      },
    });

    testNode = await prisma.node.create({
      data: {
        name: 'Queue Test Node',
        role: 'MAIN',
        status: 'ONLINE',
        version: '1.0.0',
        acceleration: 'CPU',
        apiKey: 'queue-key',
        lastHeartbeat: new Date(),
        licenseId: testLicense.id,
      },
    });

    testLibrary = await prisma.library.create({
      data: {
        name: 'Queue Test Library',
        path: '/test/queue',
        mediaType: 'MOVIE',
        nodeId: testNode.id,
      },
    });

    testPolicy = await prisma.policy.create({
      data: {
        name: 'Queue Test Policy',
        targetCodec: 'HEVC',
        crf: 23,
        preset: 'medium',
        libraryId: testLibrary.id,
      },
    });
  });

  afterAll(async () => {
    await prisma.job.deleteMany({});
    await prisma.policy.deleteMany({});
    await prisma.library.deleteMany({});
    await prisma.node.deleteMany({});
    await prisma.license.deleteMany({});
    await prisma.$disconnect();
    await app.close();
  });

  afterEach(async () => {
    await prisma.job.deleteMany({});
  });

  describe('GET /api/v1/queue', () => {
    it('should return empty array when no jobs exist', () => {
      return request(app.getHttpServer())
        .get('/api/v1/queue')
        .expect(200)
        .expect([]);
    });

    it('should return all jobs', async () => {
      await prisma.job.createMany({
        data: [
          {
            libraryId: testLibrary.id,
            policyId: testPolicy.id,
            filePath: '/test/job1.mp4',
            stage: 'QUEUED',
          },
          {
            libraryId: testLibrary.id,
            policyId: testPolicy.id,
            filePath: '/test/job2.mp4',
            stage: 'ENCODING',
          },
        ],
      });

      return request(app.getHttpServer())
        .get('/api/v1/queue')
        .expect(200)
        .expect((res) => {
          expect(res.body).toHaveLength(2);
          expect(res.body[0]).toHaveProperty('id');
          expect(res.body[0]).toHaveProperty('stage');
        });
    });

    it('should filter by stage', async () => {
      await prisma.job.createMany({
        data: [
          {
            libraryId: testLibrary.id,
            policyId: testPolicy.id,
            filePath: '/test/queued.mp4',
            stage: 'QUEUED',
          },
          {
            libraryId: testLibrary.id,
            policyId: testPolicy.id,
            filePath: '/test/encoding.mp4',
            stage: 'ENCODING',
          },
          {
            libraryId: testLibrary.id,
            policyId: testPolicy.id,
            filePath: '/test/completed.mp4',
            stage: 'COMPLETED',
          },
        ],
      });

      return request(app.getHttpServer())
        .get('/api/v1/queue?stage=QUEUED')
        .expect(200)
        .expect((res) => {
          expect(res.body).toHaveLength(1);
          expect(res.body[0].stage).toBe('QUEUED');
        });
    });

    it('should include library and policy information', async () => {
      await prisma.job.create({
        data: {
          libraryId: testLibrary.id,
          policyId: testPolicy.id,
          filePath: '/test/job.mp4',
          stage: 'QUEUED',
        },
      });

      return request(app.getHttpServer())
        .get('/api/v1/queue')
        .expect(200)
        .expect((res) => {
          expect(res.body[0].library).toBeDefined();
          expect(res.body[0].policy).toBeDefined();
          expect(res.body[0].library.name).toBe(testLibrary.name);
          expect(res.body[0].policy.name).toBe(testPolicy.name);
        });
    });
  });

  describe('GET /api/v1/queue/:id', () => {
    it('should return job by id', async () => {
      const job = await prisma.job.create({
        data: {
          libraryId: testLibrary.id,
          policyId: testPolicy.id,
          filePath: '/test/job.mp4',
          stage: 'QUEUED',
        },
      });

      return request(app.getHttpServer())
        .get(`/api/v1/queue/${job.id}`)
        .expect(200)
        .expect((res) => {
          expect(res.body.id).toBe(job.id);
          expect(res.body.filePath).toBe(job.filePath);
        });
    });

    it('should return 404 for non-existent job', () => {
      return request(app.getHttpServer())
        .get('/api/v1/queue/non-existent-id')
        .expect(404);
    });
  });

  describe('PATCH /api/v1/queue/:id/complete', () => {
    it('should mark job as completed', async () => {
      const job = await prisma.job.create({
        data: {
          libraryId: testLibrary.id,
          policyId: testPolicy.id,
          nodeId: testNode.id,
          filePath: '/test/job.mp4',
          stage: 'ENCODING',
        },
      });

      const completeDto = {
        originalSize: 2000000000,
        finalSize: 1000000000,
        duration: 120,
      };

      return request(app.getHttpServer())
        .patch(`/api/v1/queue/${job.id}/complete`)
        .send(completeDto)
        .expect(200)
        .expect((res) => {
          expect(res.body.stage).toBe('COMPLETED');
          expect(res.body.originalSize).toBe(completeDto.originalSize);
          expect(res.body.finalSize).toBe(completeDto.finalSize);
          expect(res.body.completedAt).toBeDefined();
        });
    });

    it('should validate complete data', async () => {
      const job = await prisma.job.create({
        data: {
          libraryId: testLibrary.id,
          policyId: testPolicy.id,
          filePath: '/test/job.mp4',
          stage: 'ENCODING',
        },
      });

      return request(app.getHttpServer())
        .patch(`/api/v1/queue/${job.id}/complete`)
        .send({
          // Missing required fields
        })
        .expect(400);
    });

    it('should return 404 for non-existent job', () => {
      return request(app.getHttpServer())
        .patch('/api/v1/queue/non-existent-id/complete')
        .send({
          originalSize: 1000000000,
          finalSize: 500000000,
          duration: 120,
        })
        .expect(404);
    });
  });

  describe('PATCH /api/v1/queue/:id/fail', () => {
    it('should mark job as failed', async () => {
      const job = await prisma.job.create({
        data: {
          libraryId: testLibrary.id,
          policyId: testPolicy.id,
          nodeId: testNode.id,
          filePath: '/test/job.mp4',
          stage: 'ENCODING',
        },
      });

      const failDto = {
        error: 'FFmpeg encoding failed',
      };

      return request(app.getHttpServer())
        .patch(`/api/v1/queue/${job.id}/fail`)
        .send(failDto)
        .expect(200)
        .expect((res) => {
          expect(res.body.stage).toBe('FAILED');
          expect(res.body.error).toBe(failDto.error);
        });
    });

    it('should validate fail data', async () => {
      const job = await prisma.job.create({
        data: {
          libraryId: testLibrary.id,
          policyId: testPolicy.id,
          filePath: '/test/job.mp4',
          stage: 'ENCODING',
        },
      });

      return request(app.getHttpServer())
        .patch(`/api/v1/queue/${job.id}/fail`)
        .send({
          // Missing error field
        })
        .expect(400);
    });

    it('should return 404 for non-existent job', () => {
      return request(app.getHttpServer())
        .patch('/api/v1/queue/non-existent-id/fail')
        .send({ error: 'Test error' })
        .expect(404);
    });
  });

  describe('DELETE /api/v1/queue/:id', () => {
    it('should delete job', async () => {
      const job = await prisma.job.create({
        data: {
          libraryId: testLibrary.id,
          policyId: testPolicy.id,
          filePath: '/test/delete.mp4',
          stage: 'QUEUED',
        },
      });

      await request(app.getHttpServer())
        .delete(`/api/v1/queue/${job.id}`)
        .expect(200);

      const deleted = await prisma.job.findUnique({ where: { id: job.id } });

      expect(deleted).toBeNull();
    });

    it('should return 404 for non-existent job', () => {
      return request(app.getHttpServer())
        .delete('/api/v1/queue/non-existent-id')
        .expect(404);
    });

    it('should prevent deletion of encoding jobs', async () => {
      const job = await prisma.job.create({
        data: {
          libraryId: testLibrary.id,
          policyId: testPolicy.id,
          nodeId: testNode.id,
          filePath: '/test/encoding.mp4',
          stage: 'ENCODING',
        },
      });

      return request(app.getHttpServer())
        .delete(`/api/v1/queue/${job.id}`)
        .expect(400);
    });
  });

  describe('GET /api/v1/queue/stats', () => {
    it('should return queue statistics', async () => {
      await prisma.job.createMany({
        data: [
          {
            libraryId: testLibrary.id,
            policyId: testPolicy.id,
            filePath: '/test/queued.mp4',
            stage: 'QUEUED',
          },
          {
            libraryId: testLibrary.id,
            policyId: testPolicy.id,
            nodeId: testNode.id,
            filePath: '/test/encoding.mp4',
            stage: 'ENCODING',
          },
          {
            libraryId: testLibrary.id,
            policyId: testPolicy.id,
            nodeId: testNode.id,
            filePath: '/test/completed.mp4',
            stage: 'COMPLETED',
          },
          {
            libraryId: testLibrary.id,
            policyId: testPolicy.id,
            filePath: '/test/failed.mp4',
            stage: 'FAILED',
          },
        ],
      });

      return request(app.getHttpServer())
        .get('/api/v1/queue/stats')
        .expect(200)
        .expect((res) => {
          expect(res.body.queued).toBe(1);
          expect(res.body.encoding).toBe(1);
          expect(res.body.completed).toBe(1);
          expect(res.body.failed).toBe(1);
          expect(res.body.total).toBe(4);
        });
    });

    it('should return zero stats when no jobs exist', () => {
      return request(app.getHttpServer())
        .get('/api/v1/queue/stats')
        .expect(200)
        .expect((res) => {
          expect(res.body.queued).toBe(0);
          expect(res.body.total).toBe(0);
        });
    });
  });
});
