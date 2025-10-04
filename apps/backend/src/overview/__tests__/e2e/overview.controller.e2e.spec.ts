import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import type { Library, License, Node, Policy } from '@prisma/client';
import * as request from 'supertest';
import { AppModule } from '../../../app.module';
import { PrismaService } from '../../../prisma/prisma.service';

/**
 * E2E tests for Overview Controller
 *
 * Tests cover:
 * - Dashboard statistics aggregation
 * - Active/completed job counts
 * - Storage savings calculations
 * - Recent activity feeds
 */
describe('OverviewController (E2E)', () => {
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
        key: 'TEST-OVERVIEW-E2E',
        tier: 'FREE',
        status: 'ACTIVE',
        email: 'overview-e2e@test.com',
        maxNodes: 5,
        maxConcurrentJobs: 10,
        features: {},
      },
    });

    testNode = await prisma.node.create({
      data: {
        name: 'Overview Test Node',
        role: 'MAIN',
        status: 'ONLINE',
        version: '1.0.0',
        acceleration: 'CPU',
        apiKey: 'overview-key',
        lastHeartbeat: new Date(),
        licenseId: testLicense.id,
      },
    });

    testLibrary = await prisma.library.create({
      data: {
        name: 'Overview Test Library',
        path: '/test/overview',
        mediaType: 'MOVIE',
        nodeId: testNode.id,
      },
    });

    testPolicy = await prisma.policy.create({
      data: {
        name: 'Overview Test Policy',
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

  describe('GET /api/v1/overview/stats', () => {
    it('should return zero stats when no data exists', () => {
      return request(app.getHttpServer())
        .get('/api/v1/overview/stats')
        .expect(200)
        .expect((res) => {
          expect(res.body.activeJobs).toBe(0);
          expect(res.body.completedJobs).toBe(0);
          expect(res.body.totalStorageSavedGB).toBe(0);
          expect(res.body.onlineNodes).toBeDefined();
          expect(res.body.totalNodes).toBeDefined();
        });
    });

    it('should count active jobs correctly', async () => {
      await prisma.job.createMany({
        data: [
          {
            libraryId: testLibrary.id,
            policyId: testPolicy.id,
            nodeId: testNode.id,
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
            originalSize: 1000000000,
            finalSize: 500000000,
            completedAt: new Date(),
          },
        ],
      });

      return request(app.getHttpServer())
        .get('/api/v1/overview/stats')
        .expect(200)
        .expect((res) => {
          expect(res.body.activeJobs).toBe(2); // QUEUED + ENCODING
          expect(res.body.completedJobs).toBe(1);
          expect(res.body.totalStorageSavedGB).toBeCloseTo(0.5, 1); // 500MB saved
        });
    });

    it('should count online nodes', async () => {
      await prisma.node.update({
        where: { id: testNode.id },
        data: { status: 'ONLINE' },
      });

      return request(app.getHttpServer())
        .get('/api/v1/overview/stats')
        .expect(200)
        .expect((res) => {
          expect(res.body.onlineNodes).toBeGreaterThanOrEqual(1);
          expect(res.body.totalNodes).toBeGreaterThanOrEqual(1);
        });
    });

    it('should calculate total storage saved', async () => {
      await prisma.job.createMany({
        data: [
          {
            libraryId: testLibrary.id,
            policyId: testPolicy.id,
            nodeId: testNode.id,
            filePath: '/test/video1.mp4',
            stage: 'COMPLETED',
            originalSize: 2000000000, // 2GB
            finalSize: 1000000000, // 1GB saved
            completedAt: new Date(),
          },
          {
            libraryId: testLibrary.id,
            policyId: testPolicy.id,
            nodeId: testNode.id,
            filePath: '/test/video2.mp4',
            stage: 'COMPLETED',
            originalSize: 4000000000, // 4GB
            finalSize: 2000000000, // 2GB saved
            completedAt: new Date(),
          },
        ],
      });

      return request(app.getHttpServer())
        .get('/api/v1/overview/stats')
        .expect(200)
        .expect((res) => {
          expect(res.body.totalStorageSavedGB).toBeCloseTo(3, 0); // 1GB + 2GB
        });
    });

    it('should not count failed jobs in storage savings', async () => {
      await prisma.job.createMany({
        data: [
          {
            libraryId: testLibrary.id,
            policyId: testPolicy.id,
            nodeId: testNode.id,
            filePath: '/test/completed.mp4',
            stage: 'COMPLETED',
            originalSize: 1000000000,
            finalSize: 500000000,
            completedAt: new Date(),
          },
          {
            libraryId: testLibrary.id,
            policyId: testPolicy.id,
            nodeId: testNode.id,
            filePath: '/test/failed.mp4',
            stage: 'FAILED',
            error: 'Test error',
            completedAt: new Date(),
          },
        ],
      });

      return request(app.getHttpServer())
        .get('/api/v1/overview/stats')
        .expect(200)
        .expect((res) => {
          expect(res.body.completedJobs).toBe(1);
          expect(res.body.totalStorageSavedGB).toBeCloseTo(0.5, 1);
        });
    });
  });

  describe('GET /api/v1/overview/recent-activity', () => {
    it('should return empty array when no jobs exist', () => {
      return request(app.getHttpServer())
        .get('/api/v1/overview/recent-activity')
        .expect(200)
        .expect([]);
    });

    it('should return recent jobs with limit', async () => {
      await prisma.job.createMany({
        data: Array.from({ length: 15 }, (_, i) => ({
          libraryId: testLibrary.id,
          policyId: testPolicy.id,
          nodeId: testNode.id,
          filePath: `/test/video${i}.mp4`,
          stage: 'COMPLETED',
          originalSize: 1000000000,
          finalSize: 500000000,
          completedAt: new Date(Date.now() - i * 1000),
        })),
      });

      return request(app.getHttpServer())
        .get('/api/v1/overview/recent-activity?limit=10')
        .expect(200)
        .expect((res) => {
          expect(Array.isArray(res.body)).toBe(true);
          expect(res.body.length).toBe(10);
          expect(res.body[0]).toHaveProperty('id');
          expect(res.body[0]).toHaveProperty('filePath');
          expect(res.body[0]).toHaveProperty('stage');
          expect(res.body[0]).toHaveProperty('library');
          expect(res.body[0]).toHaveProperty('policy');
        });
    });

    it('should order by most recent first', async () => {
      const oldJob = await prisma.job.create({
        data: {
          libraryId: testLibrary.id,
          policyId: testPolicy.id,
          nodeId: testNode.id,
          filePath: '/test/old.mp4',
          stage: 'COMPLETED',
          originalSize: 1000000000,
          finalSize: 500000000,
          completedAt: new Date(Date.now() - 10000),
        },
      });

      await new Promise((resolve) => setTimeout(resolve, 10));

      const newJob = await prisma.job.create({
        data: {
          libraryId: testLibrary.id,
          policyId: testPolicy.id,
          nodeId: testNode.id,
          filePath: '/test/new.mp4',
          stage: 'COMPLETED',
          originalSize: 1000000000,
          finalSize: 500000000,
          completedAt: new Date(),
        },
      });

      return request(app.getHttpServer())
        .get('/api/v1/overview/recent-activity')
        .expect(200)
        .expect((res) => {
          expect(res.body[0].id).toBe(newJob.id);
          expect(res.body[1].id).toBe(oldJob.id);
        });
    });

    it('should include library and policy information', async () => {
      await prisma.job.create({
        data: {
          libraryId: testLibrary.id,
          policyId: testPolicy.id,
          nodeId: testNode.id,
          filePath: '/test/video.mp4',
          stage: 'COMPLETED',
          originalSize: 1000000000,
          finalSize: 500000000,
          completedAt: new Date(),
        },
      });

      return request(app.getHttpServer())
        .get('/api/v1/overview/recent-activity')
        .expect(200)
        .expect((res) => {
          expect(res.body[0].library).toBeDefined();
          expect(res.body[0].policy).toBeDefined();
          expect(res.body[0].library.name).toBe(testLibrary.name);
          expect(res.body[0].policy.name).toBe(testPolicy.name);
        });
    });

    it('should respect default limit of 20', async () => {
      await prisma.job.createMany({
        data: Array.from({ length: 30 }, (_, i) => ({
          libraryId: testLibrary.id,
          policyId: testPolicy.id,
          nodeId: testNode.id,
          filePath: `/test/video${i}.mp4`,
          stage: 'COMPLETED',
          originalSize: 1000000000,
          finalSize: 500000000,
          completedAt: new Date(),
        })),
      });

      return request(app.getHttpServer())
        .get('/api/v1/overview/recent-activity')
        .expect(200)
        .expect((res) => {
          expect(res.body.length).toBeLessThanOrEqual(20);
        });
    });

    it('should include jobs of all stages', async () => {
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
            originalSize: 1000000000,
            finalSize: 500000000,
            completedAt: new Date(),
          },
          {
            libraryId: testLibrary.id,
            policyId: testPolicy.id,
            nodeId: testNode.id,
            filePath: '/test/failed.mp4',
            stage: 'FAILED',
            error: 'Test error',
            completedAt: new Date(),
          },
        ],
      });

      return request(app.getHttpServer())
        .get('/api/v1/overview/recent-activity')
        .expect(200)
        .expect((res) => {
          expect(res.body.length).toBe(4);
          const stages = res.body.map((job: { stage: string }) => job.stage);
          expect(stages).toContain('QUEUED');
          expect(stages).toContain('ENCODING');
          expect(stages).toContain('COMPLETED');
          expect(stages).toContain('FAILED');
        });
    });
  });
});
