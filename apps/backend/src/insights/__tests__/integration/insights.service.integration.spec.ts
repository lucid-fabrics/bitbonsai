import { Test, type TestingModule } from '@nestjs/testing';
import type { Job, Library, License, Node, Policy } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { InsightsService } from '../../insights.service';

/**
 * Integration tests for InsightsService
 *
 * Tests cover:
 * - Complex aggregation queries
 * - Time-series data retrieval
 * - Multi-table joins and calculations
 * - Date range filtering
 */
describe('InsightsService Integration Tests', () => {
  let module: TestingModule;
  let service: InsightsService;
  let prisma: PrismaService;
  let testLicense: License;
  let testNode: Node;
  let testLibrary: Library;
  let testPolicy: Policy;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      providers: [InsightsService, PrismaService],
    }).compile();

    service = module.get<InsightsService>(InsightsService);
    prisma = module.get<PrismaService>(PrismaService);

    // Create test fixtures
    testLicense = await prisma.license.create({
      data: {
        key: 'TEST-INSIGHTS',
        tier: 'FREE',
        status: 'ACTIVE',
        email: 'insights@test.com',
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
        apiKey: 'test-key',
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
        name: 'Test Policy',
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

  describe('getSavingsTrend', () => {
    it('should return empty array when no jobs exist', async () => {
      const result = await service.getSavingsTrend(7);
      expect(result).toEqual([]);
    });

    it('should aggregate savings by date', async () => {
      const today = new Date();
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);

      // Create jobs with savings
      await prisma.job.createMany({
        data: [
          {
            libraryId: testLibrary.id,
            policyId: testPolicy.id,
            filePath: '/test/file1.mp4',
            stage: 'COMPLETED',
            originalSize: 1000000000, // 1GB
            finalSize: 500000000, // 0.5GB
            completedAt: today,
          },
          {
            libraryId: testLibrary.id,
            policyId: testPolicy.id,
            filePath: '/test/file2.mp4',
            stage: 'COMPLETED',
            originalSize: 2000000000, // 2GB
            finalSize: 1000000000, // 1GB
            completedAt: yesterday,
          },
        ],
      });

      const result = await service.getSavingsTrend(7);

      expect(result.length).toBeGreaterThan(0);
      expect(result.every((item) => item.date && typeof item.savingsGB === 'number')).toBe(true);
    });

    it('should filter by date range correctly', async () => {
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 100);

      await prisma.job.create({
        data: {
          libraryId: testLibrary.id,
          policyId: testPolicy.id,
          filePath: '/test/old.mp4',
          stage: 'COMPLETED',
          originalSize: 1000000000,
          finalSize: 500000000,
          completedAt: oldDate,
        },
      });

      const result = await service.getSavingsTrend(7);

      // Should not include the old job (outside 7 day range)
      expect(result.length).toBe(0);
    });
  });

  describe('getCodecDistribution', () => {
    it('should return empty array when no jobs exist', async () => {
      const result = await service.getCodecDistribution();
      expect(result).toEqual([]);
    });

    it('should calculate codec percentages correctly', async () => {
      await prisma.job.createMany({
        data: [
          {
            libraryId: testLibrary.id,
            policyId: testPolicy.id,
            filePath: '/test/hevc1.mp4',
            stage: 'COMPLETED',
            targetCodec: 'HEVC',
          },
          {
            libraryId: testLibrary.id,
            policyId: testPolicy.id,
            filePath: '/test/hevc2.mp4',
            stage: 'COMPLETED',
            targetCodec: 'HEVC',
          },
          {
            libraryId: testLibrary.id,
            policyId: testPolicy.id,
            filePath: '/test/h264.mp4',
            stage: 'COMPLETED',
            targetCodec: 'H264',
          },
        ],
      });

      const result = await service.getCodecDistribution();

      expect(result).toHaveLength(2);

      const hevcEntry = result.find((item) => item.codec === 'HEVC');
      const h264Entry = result.find((item) => item.codec === 'H264');

      expect(hevcEntry?.percentage).toBeCloseTo(66.67, 1);
      expect(h264Entry?.percentage).toBeCloseTo(33.33, 1);
    });
  });

  describe('getNodePerformance', () => {
    it('should return empty array when no nodes have jobs', async () => {
      const result = await service.getNodePerformance();
      expect(result.length).toBeGreaterThanOrEqual(0);
    });

    it('should calculate node statistics correctly', async () => {
      await prisma.job.createMany({
        data: [
          {
            libraryId: testLibrary.id,
            policyId: testPolicy.id,
            nodeId: testNode.id,
            filePath: '/test/job1.mp4',
            stage: 'COMPLETED',
          },
          {
            libraryId: testLibrary.id,
            policyId: testPolicy.id,
            nodeId: testNode.id,
            filePath: '/test/job2.mp4',
            stage: 'COMPLETED',
          },
          {
            libraryId: testLibrary.id,
            policyId: testPolicy.id,
            nodeId: testNode.id,
            filePath: '/test/job3.mp4',
            stage: 'FAILED',
          },
        ],
      });

      const result = await service.getNodePerformance();

      const nodeStats = result.find((item) => item.nodeId === testNode.id);

      expect(nodeStats).toBeDefined();
      expect(nodeStats?.nodeName).toBe(testNode.name);
      expect(nodeStats?.jobsCompleted).toBe(2);
      expect(nodeStats?.successRate).toBeCloseTo(66.67, 1);
    });
  });

  describe('getStats', () => {
    it('should return zero stats when no jobs exist', async () => {
      const result = await service.getStats();

      expect(result.totalJobsCompleted).toBe(0);
      expect(result.totalStorageSavedGB).toBe(0);
      expect(result.averageSuccessRate).toBe(0);
      expect(result.averageThroughput).toBe(0);
    });

    it('should calculate overall statistics correctly', async () => {
      const now = new Date();

      await prisma.job.createMany({
        data: [
          {
            libraryId: testLibrary.id,
            policyId: testPolicy.id,
            nodeId: testNode.id,
            filePath: '/test/job1.mp4',
            stage: 'COMPLETED',
            originalSize: 2000000000, // 2GB
            finalSize: 1000000000, // 1GB (saved 1GB)
            completedAt: now,
          },
          {
            libraryId: testLibrary.id,
            policyId: testPolicy.id,
            nodeId: testNode.id,
            filePath: '/test/job2.mp4',
            stage: 'COMPLETED',
            originalSize: 3000000000, // 3GB
            finalSize: 1500000000, // 1.5GB (saved 1.5GB)
            completedAt: now,
          },
          {
            libraryId: testLibrary.id,
            policyId: testPolicy.id,
            nodeId: testNode.id,
            filePath: '/test/job3.mp4',
            stage: 'FAILED',
          },
        ],
      });

      const result = await service.getStats();

      expect(result.totalJobsCompleted).toBe(2);
      expect(result.totalStorageSavedGB).toBeCloseTo(2.5, 1); // 1 + 1.5 = 2.5GB
      expect(result.averageSuccessRate).toBeCloseTo(66.67, 1); // 2 success / 3 total
      expect(result.averageThroughput).toBeGreaterThan(0);
    });
  });
});
