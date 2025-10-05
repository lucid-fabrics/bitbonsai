import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import type { Library, License, Node, Policy } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../../../app.module';
import { PrismaService } from '../../../prisma/prisma.service';

/**
 * E2E tests for Overview Controller
 *
 * Tests cover:
 * - GET /api/v1/overview endpoint
 * - Dashboard statistics aggregation in snake_case format
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
        preset: 'BALANCED_HEVC',
        targetCodec: 'HEVC',
        targetQuality: 23,
        deviceProfiles: {},
        advancedSettings: {},
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

  describe('GET /api/v1/overview', () => {
    it('should return overview with snake_case field names', () => {
      return request(app.getHttpServer())
        .get('/api/v1/overview')
        .expect(200)
        .expect((res) => {
          // Verify snake_case structure
          expect(res.body).toHaveProperty('system_health');
          expect(res.body).toHaveProperty('queue_summary');
          expect(res.body).toHaveProperty('recent_activity');
          expect(res.body).toHaveProperty('top_libraries');
          expect(res.body).toHaveProperty('last_updated');

          // Verify nested snake_case fields
          expect(res.body.system_health).toHaveProperty('active_nodes');
          expect(res.body.system_health).toHaveProperty('queue_status');
          expect(res.body.system_health).toHaveProperty('storage_saved');
          expect(res.body.system_health).toHaveProperty('success_rate');
        });
    });

    it('should return empty arrays when no jobs exist', () => {
      return request(app.getHttpServer())
        .get('/api/v1/overview')
        .expect(200)
        .expect((res) => {
          expect(res.body.recent_activity).toEqual([]);
          expect(res.body.top_libraries).toEqual([]);
          expect(res.body.queue_summary.queued).toBe(0);
          expect(res.body.queue_summary.encoding).toBe(0);
          expect(res.body.queue_summary.completed).toBe(0);
          expect(res.body.queue_summary.failed).toBe(0);
        });
    });

    it('should include active node counts', async () => {
      await prisma.node.update({
        where: { id: testNode.id },
        data: { status: 'ONLINE' },
      });

      return request(app.getHttpServer())
        .get('/api/v1/overview')
        .expect(200)
        .expect((res) => {
          expect(res.body.system_health.active_nodes.current).toBeGreaterThanOrEqual(1);
          expect(res.body.system_health.active_nodes.total).toBeGreaterThanOrEqual(1);
        });
    });

    it('should aggregate queue summary correctly', async () => {
      await prisma.job.createMany({
        data: [
          {
            libraryId: testLibrary.id,
            policyId: testPolicy.id,
            nodeId: testNode.id,
            filePath: '/test/queued.mp4',
            stage: 'QUEUED',
            fileLabel: 'queued.mp4',
            sourceCodec: 'H.264',
            targetCodec: 'HEVC',
            beforeSizeBytes: BigInt(2000000000),
          },
          {
            libraryId: testLibrary.id,
            policyId: testPolicy.id,
            nodeId: testNode.id,
            filePath: '/test/encoding.mp4',
            stage: 'ENCODING',
            fileLabel: 'encoding.mp4',
            sourceCodec: 'H.264',
            targetCodec: 'HEVC',
            beforeSizeBytes: BigInt(2000000000),
          },
          {
            libraryId: testLibrary.id,
            policyId: testPolicy.id,
            nodeId: testNode.id,
            filePath: '/test/completed.mp4',
            stage: 'COMPLETED',
            fileLabel: 'completed.mp4',
            sourceCodec: 'H.264',
            targetCodec: 'HEVC',
            beforeSizeBytes: BigInt(2000000000),
            afterSizeBytes: BigInt(1000000000),
            savedBytes: BigInt(1000000000),
            savedPercent: 50.0,
            completedAt: new Date(),
          },
          {
            libraryId: testLibrary.id,
            policyId: testPolicy.id,
            nodeId: testNode.id,
            filePath: '/test/failed.mp4',
            stage: 'FAILED',
            fileLabel: 'failed.mp4',
            sourceCodec: 'H.264',
            targetCodec: 'HEVC',
            beforeSizeBytes: BigInt(2000000000),
            error: 'Test error',
          },
        ],
      });

      return request(app.getHttpServer())
        .get('/api/v1/overview')
        .expect(200)
        .expect((res) => {
          expect(res.body.queue_summary.queued).toBe(1);
          expect(res.body.queue_summary.encoding).toBe(1);
          expect(res.body.queue_summary.completed).toBe(1);
          expect(res.body.queue_summary.failed).toBe(1);
          expect(res.body.system_health.queue_status.encoding_count).toBe(1);
        });
    });

    it('should include recent activity with snake_case fields', async () => {
      await prisma.job.create({
        data: {
          libraryId: testLibrary.id,
          policyId: testPolicy.id,
          nodeId: testNode.id,
          filePath: '/test/movie.mp4',
          stage: 'COMPLETED',
          fileLabel: 'The Matrix (1999).mkv',
          sourceCodec: 'H.264',
          targetCodec: 'HEVC',
          beforeSizeBytes: BigInt(2000000000),
          afterSizeBytes: BigInt(1000000000),
          savedBytes: BigInt(1000000000),
          savedPercent: 50.0,
          completedAt: new Date(),
        },
      });

      return request(app.getHttpServer())
        .get('/api/v1/overview')
        .expect(200)
        .expect((res) => {
          expect(res.body.recent_activity).toHaveLength(1);
          expect(res.body.recent_activity[0]).toHaveProperty('id');
          expect(res.body.recent_activity[0]).toHaveProperty('file_name');
          expect(res.body.recent_activity[0]).toHaveProperty('library');
          expect(res.body.recent_activity[0]).toHaveProperty('codec_change');
          expect(res.body.recent_activity[0]).toHaveProperty('savings_gb');
          expect(res.body.recent_activity[0]).toHaveProperty('duration_seconds');
          expect(res.body.recent_activity[0]).toHaveProperty('completed_at');

          expect(res.body.recent_activity[0].file_name).toBe('The Matrix (1999).mkv');
          expect(res.body.recent_activity[0].library).toBe(testLibrary.name);
          expect(res.body.recent_activity[0].codec_change).toBe('H.264 → HEVC');
        });
    });

    it('should include top libraries with snake_case fields', async () => {
      await prisma.job.createMany({
        data: Array.from({ length: 5 }, (_, i) => ({
          libraryId: testLibrary.id,
          policyId: testPolicy.id,
          nodeId: testNode.id,
          filePath: `/test/video${i}.mp4`,
          stage: 'COMPLETED',
          fileLabel: `video${i}.mp4`,
          sourceCodec: 'H.264',
          targetCodec: 'HEVC',
          beforeSizeBytes: BigInt(2000000000),
          afterSizeBytes: BigInt(1000000000),
          savedBytes: BigInt(1000000000),
          savedPercent: 50.0,
          completedAt: new Date(),
        })),
      });

      return request(app.getHttpServer())
        .get('/api/v1/overview')
        .expect(200)
        .expect((res) => {
          expect(res.body.top_libraries).toHaveLength(1);
          expect(res.body.top_libraries[0]).toHaveProperty('name');
          expect(res.body.top_libraries[0]).toHaveProperty('job_count');
          expect(res.body.top_libraries[0]).toHaveProperty('total_savings_gb');

          expect(res.body.top_libraries[0].name).toBe(testLibrary.name);
          expect(res.body.top_libraries[0].job_count).toBe(5);
        });
    });

    it('should calculate storage saved in TB correctly', async () => {
      // Create jobs with 1TB total savings
      await prisma.job.createMany({
        data: Array.from({ length: 10 }, (_, i) => ({
          libraryId: testLibrary.id,
          policyId: testPolicy.id,
          nodeId: testNode.id,
          filePath: `/test/video${i}.mp4`,
          stage: 'COMPLETED',
          fileLabel: `video${i}.mp4`,
          sourceCodec: 'H.264',
          targetCodec: 'HEVC',
          beforeSizeBytes: BigInt(200000000000), // 200GB each
          afterSizeBytes: BigInt(100000000000), // 100GB each
          savedBytes: BigInt(100000000000), // 100GB saved each
          savedPercent: 50.0,
          completedAt: new Date(),
        })),
      });

      return request(app.getHttpServer())
        .get('/api/v1/overview')
        .expect(200)
        .expect((res) => {
          // 10 jobs * 100GB = 1000GB = ~0.93TB
          expect(res.body.system_health.storage_saved.total_tb).toBeGreaterThan(0.9);
          expect(res.body.system_health.storage_saved.total_tb).toBeLessThan(1.0);
        });
    });

    it('should calculate success rate correctly', async () => {
      await prisma.job.createMany({
        data: [
          ...Array.from({ length: 95 }, (_, i) => ({
            libraryId: testLibrary.id,
            policyId: testPolicy.id,
            nodeId: testNode.id,
            filePath: `/test/completed${i}.mp4`,
            stage: 'COMPLETED' as const,
            fileLabel: `completed${i}.mp4`,
            sourceCodec: 'H.264',
            targetCodec: 'HEVC',
            beforeSizeBytes: BigInt(1000000000),
            afterSizeBytes: BigInt(500000000),
            savedBytes: BigInt(500000000),
            savedPercent: 50.0,
            completedAt: new Date(),
          })),
          ...Array.from({ length: 5 }, (_, i) => ({
            libraryId: testLibrary.id,
            policyId: testPolicy.id,
            nodeId: testNode.id,
            filePath: `/test/failed${i}.mp4`,
            stage: 'FAILED' as const,
            fileLabel: `failed${i}.mp4`,
            sourceCodec: 'H.264',
            targetCodec: 'HEVC',
            beforeSizeBytes: BigInt(1000000000),
            error: 'Test error',
          })),
        ],
      });

      return request(app.getHttpServer())
        .get('/api/v1/overview')
        .expect(200)
        .expect((res) => {
          // 95 completed / 100 total = 95% success rate
          expect(res.body.system_health.success_rate.percentage).toBeCloseTo(95, 0);
        });
    });
  });
});
