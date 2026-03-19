import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import type { Library, License, Node } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../../../app.module';
import { PrismaService } from '../../../prisma/prisma.service';

/**
 * E2E tests for Policies API endpoints
 *
 * These tests verify the full HTTP request/response cycle:
 * - Request validation (DTOs)
 * - HTTP status codes
 * - Response format
 * - Error handling
 * - Database integration
 */
describe('Policies API (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let testLibrary: Library;
  let testNode: Node;
  let testLicense: License;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();

    // Apply same validation pipe as production
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      })
    );

    await app.init();

    prisma = app.get<PrismaService>(PrismaService);

    // Create test data
    testLicense = await prisma.license.create({
      data: {
        key: 'E2E-TEST-LICENSE',
        tier: 'FREE',
        status: 'ACTIVE',
        email: 'e2e@example.com',
        maxNodes: 1,
        maxConcurrentJobs: 2,
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
        apiKey: 'e2e-test-api-key',
        lastHeartbeat: new Date(),
        licenseId: testLicense.id,
      },
    });

    testLibrary = await prisma.library.create({
      data: {
        name: 'E2E Test Library',
        path: '/e2e/test',
        mediaType: 'MIXED',
        enabled: true,
        totalFiles: 0,
        totalSizeBytes: BigInt(0),
        nodeId: testNode.id,
      },
    });
  });

  afterAll(async () => {
    // Clean up test data
    await prisma.policy.deleteMany({});
    await prisma.library.deleteMany({});
    await prisma.node.deleteMany({});
    await prisma.license.deleteMany({});
    await app.close();
  });

  afterEach(async () => {
    // Clean up policies between tests
    await prisma.policy.deleteMany({});
  });

  describe('POST /api/v1/policies', () => {
    it('should create a policy with valid data', () => {
      return request(app.getHttpServer())
        .post('/api/v1/policies')
        .send({
          name: 'Test Policy',
          preset: 'BALANCED_HEVC',
          targetCodec: 'HEVC',
          targetQuality: 23,
          libraryId: testLibrary.id,
        })
        .expect(201)
        .expect((res) => {
          expect(res.body).toHaveProperty('id');
          expect(res.body.name).toBe('Test Policy');
          expect(res.body.targetCodec).toBe('HEVC');
          expect(res.body.libraryId).toBe(testLibrary.id);
        });
    });

    it('should return 500 with foreign key constraint error for non-existent libraryId', () => {
      return request(app.getHttpServer())
        .post('/api/v1/policies')
        .send({
          name: 'Test Policy',
          preset: 'BALANCED_HEVC',
          targetCodec: 'HEVC',
          targetQuality: 23,
          libraryId: 'non-existent-library-id',
        })
        .expect(500)
        .expect((res) => {
          expect(res.body.message).toBe('Internal server error');
        });
    });

    it('should return 400 with validation error for invalid preset', () => {
      return request(app.getHttpServer())
        .post('/api/v1/policies')
        .send({
          name: 'Test Policy',
          preset: 'INVALID_PRESET',
          targetCodec: 'HEVC',
          targetQuality: 23,
        })
        .expect(400);
    });

    it('should return 400 with validation error for invalid targetCodec', () => {
      return request(app.getHttpServer())
        .post('/api/v1/policies')
        .send({
          name: 'Test Policy',
          preset: 'BALANCED_HEVC',
          targetCodec: 'INVALID_CODEC',
          targetQuality: 23,
        })
        .expect(400);
    });

    it('should return 400 when missing required fields', () => {
      return request(app.getHttpServer())
        .post('/api/v1/policies')
        .send({
          name: 'Test Policy',
          // Missing preset, targetCodec, targetQuality
        })
        .expect(400);
    });

    it('should create policy with custom device profiles', () => {
      return request(app.getHttpServer())
        .post('/api/v1/policies')
        .send({
          name: 'Custom Policy',
          preset: 'CUSTOM',
          targetCodec: 'AV1',
          targetQuality: 28,
          deviceProfiles: {
            appleTv: false,
            roku: false,
            web: true,
            chromecast: true,
            ps5: false,
            xbox: false,
          },
        })
        .expect(201)
        .expect((res) => {
          expect(res.body.deviceProfiles.web).toBe(true);
          expect(res.body.deviceProfiles.appleTv).toBe(false);
        });
    });

    it('should create policy with advanced settings', () => {
      return request(app.getHttpServer())
        .post('/api/v1/policies')
        .send({
          name: 'Advanced Policy',
          preset: 'CUSTOM',
          targetCodec: 'HEVC',
          targetQuality: 23,
          advancedSettings: {
            ffmpegFlags: ['-preset', 'slow', '-tune', 'film'],
            hwaccel: 'nvidia',
            audioCodec: 'aac',
            subtitleHandling: 'burn',
          },
        })
        .expect(201)
        .expect((res) => {
          expect(res.body.advancedSettings.hwaccel).toBe('nvidia');
          expect(res.body.advancedSettings.ffmpegFlags).toContain('-preset');
        });
    });
  });

  describe('GET /api/v1/policies', () => {
    it('should return empty array when no policies exist', () => {
      return request(app.getHttpServer())
        .get('/api/v1/policies')
        .expect(200)
        .expect((res) => {
          expect(res.body).toEqual([]);
        });
    });

    it('should return all policies', async () => {
      // Create test policies
      await request(app.getHttpServer()).post('/api/v1/policies').send({
        name: 'Policy 1',
        preset: 'BALANCED_HEVC',
        targetCodec: 'HEVC',
        targetQuality: 23,
      });

      await request(app.getHttpServer()).post('/api/v1/policies').send({
        name: 'Policy 2',
        preset: 'FAST_HEVC',
        targetCodec: 'HEVC',
        targetQuality: 26,
      });

      return request(app.getHttpServer())
        .get('/api/v1/policies')
        .expect(200)
        .expect((res) => {
          expect(res.body).toHaveLength(2);
          expect(res.body[0]).toHaveProperty('id');
          expect(res.body[0]).toHaveProperty('name');
        });
    });
  });

  describe('GET /api/v1/policies/:id', () => {
    it('should return policy by id', async () => {
      const createRes = await request(app.getHttpServer()).post('/api/v1/policies').send({
        name: 'Test Policy',
        preset: 'BALANCED_HEVC',
        targetCodec: 'HEVC',
        targetQuality: 23,
        libraryId: testLibrary.id,
      });

      const policyId = createRes.body.id;

      return request(app.getHttpServer())
        .get(`/api/v1/policies/${policyId}`)
        .expect(200)
        .expect((res) => {
          expect(res.body.id).toBe(policyId);
          expect(res.body.name).toBe('Test Policy');
          expect(res.body.library).not.toBeNull();
          expect(res.body._count).not.toBeNull();
        });
    });

    it('should return 404 for non-existent policy', () => {
      return request(app.getHttpServer())
        .get('/api/v1/policies/non-existent-id')
        .expect(404)
        .expect((res) => {
          expect(res.body.message).toContain('not found');
        });
    });
  });

  describe('PATCH /api/v1/policies/:id', () => {
    it('should update existing policy', async () => {
      const createRes = await request(app.getHttpServer()).post('/api/v1/policies').send({
        name: 'Original Name',
        preset: 'BALANCED_HEVC',
        targetCodec: 'HEVC',
        targetQuality: 23,
      });

      const policyId = createRes.body.id;

      return request(app.getHttpServer())
        .patch(`/api/v1/policies/${policyId}`)
        .send({
          name: 'Updated Name',
          targetQuality: 26,
        })
        .expect(200)
        .expect((res) => {
          expect(res.body.name).toBe('Updated Name');
          expect(res.body.targetQuality).toBe(26);
        });
    });

    it('should return 404 for non-existent policy', () => {
      return request(app.getHttpServer())
        .patch('/api/v1/policies/non-existent-id')
        .send({ name: 'New Name' })
        .expect(404);
    });
  });

  describe('DELETE /api/v1/policies/:id', () => {
    it('should delete existing policy', async () => {
      const createRes = await request(app.getHttpServer()).post('/api/v1/policies').send({
        name: 'To Delete',
        preset: 'BALANCED_HEVC',
        targetCodec: 'HEVC',
        targetQuality: 23,
      });

      const policyId = createRes.body.id;

      await request(app.getHttpServer()).delete(`/api/v1/policies/${policyId}`).expect(200);

      // Verify it's deleted
      return request(app.getHttpServer()).get(`/api/v1/policies/${policyId}`).expect(404);
    });

    it('should return 404 for non-existent policy', () => {
      return request(app.getHttpServer()).delete('/api/v1/policies/non-existent-id').expect(404);
    });
  });

  describe('GET /api/v1/policies/presets', () => {
    it('should return all available presets', () => {
      return request(app.getHttpServer())
        .get('/api/v1/policies/presets')
        .expect(200)
        .expect((res) => {
          expect(Array.isArray(res.body)).toBe(true);
          expect(res.body.length).toBeGreaterThan(0);
          expect(res.body[0]).toHaveProperty('preset');
          expect(res.body[0]).toHaveProperty('name');
          expect(res.body[0]).toHaveProperty('defaultCodec');
          expect(res.body[0]).toHaveProperty('recommendedQuality');
          expect(res.body[0]).toHaveProperty('description');
        });
    });
  });
});
