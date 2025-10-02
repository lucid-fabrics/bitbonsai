import { Test, type TestingModule } from '@nestjs/testing';
import type { License, Node, Library, Policy } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { OverviewService } from '../../overview.service';

/**
 * Integration tests for OverviewService
 *
 * Tests cover:
 * - Dashboard overview statistics
 * - Multi-entity aggregations
 * - System-wide metrics
 */
describe('OverviewService Integration Tests', () => {
  let module: TestingModule;
  let service: OverviewService;
  let prisma: PrismaService;
  let testLicense: License;
  let testNode: Node;
  let testLibrary: Library;
  let testPolicy: Policy;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      providers: [OverviewService, PrismaService],
    }).compile();

    service = module.get<OverviewService>(OverviewService);
    prisma = module.get<PrismaService>(PrismaService);

    // Create test fixtures
    testLicense = await prisma.license.create({
      data: {
        key: 'TEST-OVERVIEW',
        tier: 'FREE',
        status: 'ACTIVE',
        email: 'overview@test.com',
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
        apiKey: 'test-key',
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
    await module.close();
  });

  afterEach(async () => {
    await prisma.job.deleteMany({});
  });

  describe('getOverviewStats', () => {
    it('should return zero stats for empty database', async () => {
      await prisma.job.deleteMany({});

      const result = await service.getOverviewStats();

      expect(result.totalLibraries).toBe(1); // testLibrary exists
      expect(result.totalNodes).toBe(1); // testNode exists
      expect(result.activeJobs).toBe(0);
      expect(result.completedJobs).toBe(0);
      expect(result.totalStorageSaved).toBe(0);
    });

    it('should count active jobs correctly', async () => {
      await prisma.job.createMany({
        data: [
          {
            libraryId: testLibrary.id,
            policyId: testPolicy.id,
            filePath: '/test/encoding1.mp4',
            stage: 'ENCODING',
          },
          {
            libraryId: testLibrary.id,
            policyId: testPolicy.id,
            filePath: '/test/queued1.mp4',
            stage: 'QUEUED',
          },
          {
            libraryId: testLibrary.id,
            policyId: testPolicy.id,
            filePath: '/test/completed1.mp4',
            stage: 'COMPLETED',
          },
        ],
      });

      const result = await service.getOverviewStats();

      expect(result.activeJobs).toBe(2); // ENCODING + QUEUED
      expect(result.completedJobs).toBe(1);
    });

    it('should calculate total storage saved', async () => {
      await prisma.job.createMany({
        data: [
          {
            libraryId: testLibrary.id,
            policyId: testPolicy.id,
            filePath: '/test/file1.mp4',
            stage: 'COMPLETED',
            originalSize: 5000000000, // 5GB
            finalSize: 2000000000, // 2GB (saved 3GB)
          },
          {
            libraryId: testLibrary.id,
            policyId: testPolicy.id,
            filePath: '/test/file2.mp4',
            stage: 'COMPLETED',
            originalSize: 3000000000, // 3GB
            finalSize: 1500000000, // 1.5GB (saved 1.5GB)
          },
        ],
      });

      const result = await service.getOverviewStats();

      expect(result.totalStorageSaved).toBeCloseTo(4.5, 1); // 3 + 1.5 = 4.5GB
    });

    it('should count libraries and nodes correctly', async () => {
      // Create additional library
      const secondLibrary = await prisma.library.create({
        data: {
          name: 'Second Library',
          path: '/test/second',
          mediaType: 'TV',
          nodeId: testNode.id,
        },
      });

      const result = await service.getOverviewStats();

      expect(result.totalLibraries).toBe(2);
      expect(result.totalNodes).toBe(1);

      // Cleanup
      await prisma.library.delete({ where: { id: secondLibrary.id } });
    });

    it('should handle nodes with different statuses', async () => {
      const offlineNode = await prisma.node.create({
        data: {
          name: 'Offline Node',
          role: 'LINKED',
          status: 'OFFLINE',
          version: '1.0.0',
          acceleration: 'CPU',
          apiKey: 'offline-key',
          lastHeartbeat: new Date(),
          licenseId: testLicense.id,
        },
      });

      const result = await service.getOverviewStats();

      expect(result.totalNodes).toBe(2);
      expect(result.onlineNodes).toBe(1); // Only testNode is ONLINE

      // Cleanup
      await prisma.node.delete({ where: { id: offlineNode.id } });
    });

    it('should calculate success rate', async () => {
      await prisma.job.createMany({
        data: [
          {
            libraryId: testLibrary.id,
            policyId: testPolicy.id,
            filePath: '/test/success1.mp4',
            stage: 'COMPLETED',
          },
          {
            libraryId: testLibrary.id,
            policyId: testPolicy.id,
            filePath: '/test/success2.mp4',
            stage: 'COMPLETED',
          },
          {
            libraryId: testLibrary.id,
            policyId: testPolicy.id,
            filePath: '/test/failed1.mp4',
            stage: 'FAILED',
          },
        ],
      });

      const result = await service.getOverviewStats();

      expect(result.successRate).toBeCloseTo(66.67, 1); // 2 success / 3 total
    });

    it('should handle zero division for success rate', async () => {
      await prisma.job.deleteMany({});

      const result = await service.getOverviewStats();

      expect(result.successRate).toBe(0);
    });

    it('should aggregate recent activity', async () => {
      const now = new Date();
      const recentJob = await prisma.job.create({
        data: {
          libraryId: testLibrary.id,
          policyId: testPolicy.id,
          filePath: '/test/recent.mp4',
          stage: 'COMPLETED',
          completedAt: now,
        },
      });

      const result = await service.getOverviewStats();

      expect(result.recentCompletedJobs).toBeGreaterThan(0);

      // Cleanup
      await prisma.job.delete({ where: { id: recentJob.id } });
    });
  });
});
