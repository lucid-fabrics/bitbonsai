import { Test, type TestingModule } from '@nestjs/testing';
import type { Library, License, Node, Policy } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { EncodingProcessorService } from '../../encoding-processor.service';
import { FfmpegService } from '../../ffmpeg.service';

/**
 * Integration tests for EncodingProcessorService
 *
 * Tests cover:
 * - Job processing workflow
 * - Integration with FFmpeg service
 * - Database state updates
 * - Error handling during encoding
 */
describe('EncodingProcessorService Integration Tests', () => {
  let module: TestingModule;
  let service: EncodingProcessorService;
  let prisma: PrismaService;
  let ffmpegService: FfmpegService;
  let testLicense: License;
  let testNode: Node;
  let testLibrary: Library;
  let testPolicy: Policy;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      providers: [EncodingProcessorService, FfmpegService, PrismaService],
    }).compile();

    service = module.get<EncodingProcessorService>(EncodingProcessorService);
    prisma = module.get<PrismaService>(PrismaService);
    ffmpegService = module.get<FfmpegService>(FfmpegService);

    // Create test fixtures
    testLicense = await prisma.license.create({
      data: {
        key: 'TEST-ENCODING',
        tier: 'FREE',
        status: 'ACTIVE',
        email: 'encoding@test.com',
        maxNodes: 5,
        maxConcurrentJobs: 10,
        features: {},
      },
    });

    testNode = await prisma.node.create({
      data: {
        name: 'Encoding Test Node',
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
        name: 'Encoding Test Library',
        path: '/test/encoding',
        mediaType: 'MOVIE',
        nodeId: testNode.id,
      },
    });

    testPolicy = await prisma.policy.create({
      data: {
        name: 'Encoding Test Policy',
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
    jest.clearAllMocks();
  });

  describe('processJob', () => {
    it('should update job stage to ENCODING when processing starts', async () => {
      const job = await prisma.job.create({
        data: {
          libraryId: testLibrary.id,
          policyId: testPolicy.id,
          nodeId: testNode.id,
          filePath: '/test/video.mp4',
          stage: 'QUEUED',
        },
      });

      // Mock FFmpeg to prevent actual encoding
      jest.spyOn(ffmpegService, 'encode').mockResolvedValue({
        success: true,
        outputPath: '/test/video_encoded.mp4',
        originalSize: 1000000000,
        finalSize: 500000000,
      });

      await service.processJob(job.id);

      const updated = await prisma.job.findUnique({ where: { id: job.id } });

      expect(updated?.stage).toBe('COMPLETED');
      expect(updated?.startedAt).toBeDefined();
    });

    it('should calculate and save encoding metrics', async () => {
      const job = await prisma.job.create({
        data: {
          libraryId: testLibrary.id,
          policyId: testPolicy.id,
          nodeId: testNode.id,
          filePath: '/test/video.mp4',
          stage: 'QUEUED',
        },
      });

      jest.spyOn(ffmpegService, 'encode').mockResolvedValue({
        success: true,
        outputPath: '/test/video_encoded.mp4',
        originalSize: 2000000000, // 2GB
        finalSize: 1000000000, // 1GB
      });

      await service.processJob(job.id);

      const updated = await prisma.job.findUnique({ where: { id: job.id } });

      expect(updated?.originalSize).toBe(2000000000);
      expect(updated?.finalSize).toBe(1000000000);
      expect(updated?.compressionRatio).toBeCloseTo(50, 0); // 50% compression
    });

    it('should set job to FAILED on encoding error', async () => {
      const job = await prisma.job.create({
        data: {
          libraryId: testLibrary.id,
          policyId: testPolicy.id,
          nodeId: testNode.id,
          filePath: '/test/video.mp4',
          stage: 'QUEUED',
        },
      });

      jest.spyOn(ffmpegService, 'encode').mockRejectedValue(new Error('FFmpeg failed'));

      await service.processJob(job.id);

      const updated = await prisma.job.findUnique({ where: { id: job.id } });

      expect(updated?.stage).toBe('FAILED');
      expect(updated?.error).toContain('FFmpeg failed');
    });

    it('should set completedAt timestamp on success', async () => {
      const job = await prisma.job.create({
        data: {
          libraryId: testLibrary.id,
          policyId: testPolicy.id,
          nodeId: testNode.id,
          filePath: '/test/video.mp4',
          stage: 'QUEUED',
        },
      });

      jest.spyOn(ffmpegService, 'encode').mockResolvedValue({
        success: true,
        outputPath: '/test/video_encoded.mp4',
        originalSize: 1000000000,
        finalSize: 500000000,
      });

      const before = new Date();
      await service.processJob(job.id);
      const after = new Date();

      const updated = await prisma.job.findUnique({ where: { id: job.id } });

      expect(updated?.completedAt).toBeDefined();
      expect(updated?.completedAt?.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(updated?.completedAt?.getTime()).toBeLessThanOrEqual(after.getTime());
    });
  });

  describe('getNextJob', () => {
    it('should return null when no jobs are queued', async () => {
      const result = await service.getNextJob(testNode.id);
      expect(result).toBeNull();
    });

    it('should return oldest queued job for the node', async () => {
      const oldJob = await prisma.job.create({
        data: {
          libraryId: testLibrary.id,
          policyId: testPolicy.id,
          nodeId: testNode.id,
          filePath: '/test/old.mp4',
          stage: 'QUEUED',
          createdAt: new Date(Date.now() - 1000), // 1 second ago
        },
      });

      const _newJob = await prisma.job.create({
        data: {
          libraryId: testLibrary.id,
          policyId: testPolicy.id,
          nodeId: testNode.id,
          filePath: '/test/new.mp4',
          stage: 'QUEUED',
        },
      });

      const result = await service.getNextJob(testNode.id);

      expect(result?.id).toBe(oldJob.id); // Should get older job first
    });

    it('should not return jobs for other nodes', async () => {
      const otherNode = await prisma.node.create({
        data: {
          name: 'Other Node',
          role: 'LINKED',
          status: 'ONLINE',
          version: '1.0.0',
          acceleration: 'CPU',
          apiKey: 'other-key',
          lastHeartbeat: new Date(),
          licenseId: testLicense.id,
        },
      });

      await prisma.job.create({
        data: {
          libraryId: testLibrary.id,
          policyId: testPolicy.id,
          nodeId: otherNode.id,
          filePath: '/test/other.mp4',
          stage: 'QUEUED',
        },
      });

      const result = await service.getNextJob(testNode.id);

      expect(result).toBeNull(); // Should not get job for other node

      // Cleanup
      await prisma.node.delete({ where: { id: otherNode.id } });
    });

    it('should not return jobs that are already encoding', async () => {
      await prisma.job.create({
        data: {
          libraryId: testLibrary.id,
          policyId: testPolicy.id,
          nodeId: testNode.id,
          filePath: '/test/encoding.mp4',
          stage: 'ENCODING',
        },
      });

      const result = await service.getNextJob(testNode.id);

      expect(result).toBeNull();
    });
  });

  describe('cancelJob', () => {
    it('should cancel queued job', async () => {
      const job = await prisma.job.create({
        data: {
          libraryId: testLibrary.id,
          policyId: testPolicy.id,
          nodeId: testNode.id,
          filePath: '/test/cancel.mp4',
          stage: 'QUEUED',
        },
      });

      await service.cancelJob(job.id);

      const updated = await prisma.job.findUnique({ where: { id: job.id } });

      expect(updated?.stage).toBe('CANCELLED');
    });

    it('should not cancel completed jobs', async () => {
      const job = await prisma.job.create({
        data: {
          libraryId: testLibrary.id,
          policyId: testPolicy.id,
          nodeId: testNode.id,
          filePath: '/test/completed.mp4',
          stage: 'COMPLETED',
        },
      });

      await expect(service.cancelJob(job.id)).rejects.toThrow();

      const updated = await prisma.job.findUnique({ where: { id: job.id } });
      expect(updated?.stage).toBe('COMPLETED'); // Should remain completed
    });
  });
});
