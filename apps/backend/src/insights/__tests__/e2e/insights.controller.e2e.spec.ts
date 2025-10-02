import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import type { License, Node, Library, Policy } from '@prisma/client';
import * as request from 'supertest';
import { AppModule } from '../../../app.module';
import { PrismaService } from '../../../prisma/prisma.service';

/**
 * E2E tests for Insights Controller
 *
 * Tests cover:
 * - Savings trend analytics over time periods
 * - Codec distribution statistics
 * - Node performance metrics
 * - Aggregate insights statistics
 */
describe('InsightsController (E2E)', () => {
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
        key: 'TEST-INSIGHTS-E2E',
        tier: 'FREE',
        status: 'ACTIVE',
        email: 'insights-e2e@test.com',
        maxNodes: 5,
        maxConcurrentJobs: 10,
        features: {},
      },
    });

    testNode = await prisma.node.create({
      data: {
        name: 'Insights Test Node',
        role: 'MAIN',
        status: 'ONLINE',
        version: '1.0.0',
        acceleration: 'CPU',
        apiKey: 'insights-key',
        lastHeartbeat: new Date(),
        licenseId: testLicense.id,
      },
    });

    testLibrary = await prisma.library.create({
      data: {
        name: 'Insights Test Library',
        path: '/test/insights',
        mediaType: 'MOVIE',
        nodeId: testNode.id,
      },
    });

    testPolicy = await prisma.policy.create({
      data: {
        name: 'Insights Test Policy',
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

  describe('GET /api/v1/insights/savings-trend', () => {
    it('should return empty array when no completed jobs exist', () => {
      return request(app.getHttpServer())
        .get('/api/v1/insights/savings-trend?days=7')
        .expect(200)
        .expect([]);
    });

    it('should return savings trend for 7 days', async () => {
      const today = new Date();
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);

      await prisma.job.createMany({
        data: [
          {
            libraryId: testLibrary.id,
            policyId: testPolicy.id,
            nodeId: testNode.id,
            filePath: '/test/video1.mp4',
            stage: 'COMPLETED',
            originalSize: 2000000000, // 2GB
            finalSize: 1000000000, // 1GB
            completedAt: today,
          },
          {
            libraryId: testLibrary.id,
            policyId: testPolicy.id,
            nodeId: testNode.id,
            filePath: '/test/video2.mp4',
            stage: 'COMPLETED',
            originalSize: 4000000000, // 4GB
            finalSize: 2000000000, // 2GB
            completedAt: yesterday,
          },
        ],
      });

      return request(app.getHttpServer())
        .get('/api/v1/insights/savings-trend?days=7')
        .expect(200)
        .expect((res) => {
          expect(Array.isArray(res.body)).toBe(true);
          expect(res.body.length).toBeGreaterThan(0);
          expect(res.body[0]).toHaveProperty('date');
          expect(res.body[0]).toHaveProperty('savingsGB');
        });
    });

    it('should support 30 day period', async () => {
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
        .get('/api/v1/insights/savings-trend?days=30')
        .expect(200)
        .expect((res) => {
          expect(Array.isArray(res.body)).toBe(true);
        });
    });

    it('should support 90 day period', () => {
      return request(app.getHttpServer())
        .get('/api/v1/insights/savings-trend?days=90')
        .expect(200);
    });

    it('should validate days parameter', () => {
      return request(app.getHttpServer())
        .get('/api/v1/insights/savings-trend?days=invalid')
        .expect(400);
    });
  });

  describe('GET /api/v1/insights/codec-distribution', () => {
    it('should return empty array when no completed jobs exist', () => {
      return request(app.getHttpServer())
        .get('/api/v1/insights/codec-distribution')
        .expect(200)
        .expect([]);
    });

    it('should return codec distribution statistics', async () => {
      await prisma.job.createMany({
        data: [
          {
            libraryId: testLibrary.id,
            policyId: testPolicy.id,
            nodeId: testNode.id,
            filePath: '/test/hevc1.mp4',
            stage: 'COMPLETED',
            sourceCodec: 'H264',
            targetCodec: 'HEVC',
            originalSize: 2000000000,
            finalSize: 1000000000,
            completedAt: new Date(),
          },
          {
            libraryId: testLibrary.id,
            policyId: testPolicy.id,
            nodeId: testNode.id,
            filePath: '/test/hevc2.mp4',
            stage: 'COMPLETED',
            sourceCodec: 'H264',
            targetCodec: 'HEVC',
            originalSize: 3000000000,
            finalSize: 1500000000,
            completedAt: new Date(),
          },
          {
            libraryId: testLibrary.id,
            policyId: testPolicy.id,
            nodeId: testNode.id,
            filePath: '/test/av1.mp4',
            stage: 'COMPLETED',
            sourceCodec: 'H264',
            targetCodec: 'AV1',
            originalSize: 2000000000,
            finalSize: 800000000,
            completedAt: new Date(),
          },
        ],
      });

      return request(app.getHttpServer())
        .get('/api/v1/insights/codec-distribution')
        .expect(200)
        .expect((res) => {
          expect(Array.isArray(res.body)).toBe(true);
          expect(res.body.length).toBe(2); // HEVC and AV1
          expect(res.body[0]).toHaveProperty('codec');
          expect(res.body[0]).toHaveProperty('count');
          expect(res.body[0]).toHaveProperty('percentage');
          expect(res.body[0]).toHaveProperty('totalSavingsGB');
        });
    });

    it('should calculate percentages correctly', async () => {
      await prisma.job.createMany({
        data: [
          {
            libraryId: testLibrary.id,
            policyId: testPolicy.id,
            nodeId: testNode.id,
            filePath: '/test/video1.mp4',
            stage: 'COMPLETED',
            targetCodec: 'HEVC',
            originalSize: 1000000000,
            finalSize: 500000000,
            completedAt: new Date(),
          },
          {
            libraryId: testLibrary.id,
            policyId: testPolicy.id,
            nodeId: testNode.id,
            filePath: '/test/video2.mp4',
            stage: 'COMPLETED',
            targetCodec: 'HEVC',
            originalSize: 1000000000,
            finalSize: 500000000,
            completedAt: new Date(),
          },
          {
            libraryId: testLibrary.id,
            policyId: testPolicy.id,
            nodeId: testNode.id,
            filePath: '/test/video3.mp4',
            stage: 'COMPLETED',
            targetCodec: 'HEVC',
            originalSize: 1000000000,
            finalSize: 500000000,
            completedAt: new Date(),
          },
          {
            libraryId: testLibrary.id,
            policyId: testPolicy.id,
            nodeId: testNode.id,
            filePath: '/test/video4.mp4',
            stage: 'COMPLETED',
            targetCodec: 'AV1',
            originalSize: 1000000000,
            finalSize: 500000000,
            completedAt: new Date(),
          },
        ],
      });

      return request(app.getHttpServer())
        .get('/api/v1/insights/codec-distribution')
        .expect(200)
        .expect((res) => {
          const hevcEntry = res.body.find((entry: { codec: string }) => entry.codec === 'HEVC');
          const av1Entry = res.body.find((entry: { codec: string }) => entry.codec === 'AV1');

          expect(hevcEntry.count).toBe(3);
          expect(hevcEntry.percentage).toBeCloseTo(75, 0);
          expect(av1Entry.count).toBe(1);
          expect(av1Entry.percentage).toBeCloseTo(25, 0);
        });
    });
  });

  describe('GET /api/v1/insights/node-performance', () => {
    it('should return empty array when no nodes have completed jobs', () => {
      return request(app.getHttpServer())
        .get('/api/v1/insights/node-performance')
        .expect(200)
        .expect([]);
    });

    it('should return node performance metrics', async () => {
      await prisma.job.createMany({
        data: [
          {
            libraryId: testLibrary.id,
            policyId: testPolicy.id,
            nodeId: testNode.id,
            filePath: '/test/success1.mp4',
            stage: 'COMPLETED',
            originalSize: 1000000000,
            finalSize: 500000000,
            completedAt: new Date(),
          },
          {
            libraryId: testLibrary.id,
            policyId: testPolicy.id,
            nodeId: testNode.id,
            filePath: '/test/success2.mp4',
            stage: 'COMPLETED',
            originalSize: 2000000000,
            finalSize: 1000000000,
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
        .get('/api/v1/insights/node-performance')
        .expect(200)
        .expect((res) => {
          expect(Array.isArray(res.body)).toBe(true);
          expect(res.body.length).toBe(1);
          expect(res.body[0]).toHaveProperty('nodeId');
          expect(res.body[0]).toHaveProperty('nodeName');
          expect(res.body[0]).toHaveProperty('totalJobs');
          expect(res.body[0]).toHaveProperty('completedJobs');
          expect(res.body[0]).toHaveProperty('failedJobs');
          expect(res.body[0]).toHaveProperty('successRate');
          expect(res.body[0]).toHaveProperty('totalSavingsGB');

          expect(res.body[0].totalJobs).toBe(3);
          expect(res.body[0].completedJobs).toBe(2);
          expect(res.body[0].failedJobs).toBe(1);
        });
    });

    it('should calculate success rate correctly', async () => {
      await prisma.job.createMany({
        data: [
          {
            libraryId: testLibrary.id,
            policyId: testPolicy.id,
            nodeId: testNode.id,
            filePath: '/test/success1.mp4',
            stage: 'COMPLETED',
            originalSize: 1000000000,
            finalSize: 500000000,
            completedAt: new Date(),
          },
          {
            libraryId: testLibrary.id,
            policyId: testPolicy.id,
            nodeId: testNode.id,
            filePath: '/test/success2.mp4',
            stage: 'COMPLETED',
            originalSize: 1000000000,
            finalSize: 500000000,
            completedAt: new Date(),
          },
          {
            libraryId: testLibrary.id,
            policyId: testPolicy.id,
            nodeId: testNode.id,
            filePath: '/test/success3.mp4',
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
        .get('/api/v1/insights/node-performance')
        .expect(200)
        .expect((res) => {
          expect(res.body[0].successRate).toBeCloseTo(75, 0); // 3 out of 4
        });
    });

    it('should handle multiple nodes', async () => {
      const secondNode = await prisma.node.create({
        data: {
          name: 'Second Node',
          role: 'LINKED',
          status: 'ONLINE',
          version: '1.0.0',
          acceleration: 'GPU',
          apiKey: 'second-key',
          lastHeartbeat: new Date(),
          licenseId: testLicense.id,
        },
      });

      await prisma.job.createMany({
        data: [
          {
            libraryId: testLibrary.id,
            policyId: testPolicy.id,
            nodeId: testNode.id,
            filePath: '/test/node1.mp4',
            stage: 'COMPLETED',
            originalSize: 1000000000,
            finalSize: 500000000,
            completedAt: new Date(),
          },
          {
            libraryId: testLibrary.id,
            policyId: testPolicy.id,
            nodeId: secondNode.id,
            filePath: '/test/node2.mp4',
            stage: 'COMPLETED',
            originalSize: 2000000000,
            finalSize: 1000000000,
            completedAt: new Date(),
          },
        ],
      });

      const response = await request(app.getHttpServer())
        .get('/api/v1/insights/node-performance')
        .expect(200);

      expect(response.body).toHaveLength(2);
      expect(response.body.some((n: { nodeId: string }) => n.nodeId === testNode.id)).toBe(true);
      expect(response.body.some((n: { nodeId: string }) => n.nodeId === secondNode.id)).toBe(true);

      // Cleanup
      await prisma.node.delete({ where: { id: secondNode.id } });
    });
  });

  describe('GET /api/v1/insights/stats', () => {
    it('should return zero stats when no jobs exist', () => {
      return request(app.getHttpServer())
        .get('/api/v1/insights/stats')
        .expect(200)
        .expect((res) => {
          expect(res.body.totalSavingsGB).toBe(0);
          expect(res.body.totalJobsCompleted).toBe(0);
          expect(res.body.averageCompressionRatio).toBe(0);
          expect(res.body.mostUsedCodec).toBeNull();
        });
    });

    it('should calculate aggregate statistics', async () => {
      await prisma.job.createMany({
        data: [
          {
            libraryId: testLibrary.id,
            policyId: testPolicy.id,
            nodeId: testNode.id,
            filePath: '/test/video1.mp4',
            stage: 'COMPLETED',
            targetCodec: 'HEVC',
            originalSize: 2000000000, // 2GB
            finalSize: 1000000000, // 1GB saved
            compressionRatio: 50,
            completedAt: new Date(),
          },
          {
            libraryId: testLibrary.id,
            policyId: testPolicy.id,
            nodeId: testNode.id,
            filePath: '/test/video2.mp4',
            stage: 'COMPLETED',
            targetCodec: 'HEVC',
            originalSize: 4000000000, // 4GB
            finalSize: 2000000000, // 2GB saved
            compressionRatio: 50,
            completedAt: new Date(),
          },
          {
            libraryId: testLibrary.id,
            policyId: testPolicy.id,
            nodeId: testNode.id,
            filePath: '/test/video3.mp4',
            stage: 'COMPLETED',
            targetCodec: 'AV1',
            originalSize: 2000000000, // 2GB
            finalSize: 800000000, // 1.2GB saved
            compressionRatio: 60,
            completedAt: new Date(),
          },
        ],
      });

      return request(app.getHttpServer())
        .get('/api/v1/insights/stats')
        .expect(200)
        .expect((res) => {
          expect(res.body.totalJobsCompleted).toBe(3);
          expect(res.body.totalSavingsGB).toBeCloseTo(4.2, 1); // 1 + 2 + 1.2 GB
          expect(res.body.averageCompressionRatio).toBeCloseTo(53.33, 1); // (50 + 50 + 60) / 3
          expect(res.body.mostUsedCodec).toBe('HEVC');
        });
    });

    it('should handle failed jobs correctly', async () => {
      await prisma.job.createMany({
        data: [
          {
            libraryId: testLibrary.id,
            policyId: testPolicy.id,
            nodeId: testNode.id,
            filePath: '/test/success.mp4',
            stage: 'COMPLETED',
            targetCodec: 'HEVC',
            originalSize: 1000000000,
            finalSize: 500000000,
            compressionRatio: 50,
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
        .get('/api/v1/insights/stats')
        .expect(200)
        .expect((res) => {
          expect(res.body.totalJobsCompleted).toBe(1); // Only completed jobs
          expect(res.body.totalSavingsGB).toBeCloseTo(0.5, 1);
        });
    });
  });
});
