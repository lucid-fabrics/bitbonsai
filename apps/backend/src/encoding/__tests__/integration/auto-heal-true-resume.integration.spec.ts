import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Test, TestingModule } from '@nestjs/testing';
import { JobStage } from '@prisma/client';
import { DataAccessService } from '../../../core/services/data-access.service';
import { FileRelocatorService } from '../../../core/services/file-relocator.service';
import { LibrariesService } from '../../../libraries/libraries.service';
import { NodesService } from '../../../nodes/nodes.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { QueueService } from '../../../queue/queue.service';
import { EncodingProcessorService } from '../../encoding-processor.service';
import { FfmpegService } from '../../ffmpeg.service';

/**
 * TRUE RESUME Integration Tests
 *
 * CRITICAL: Tests the TRUE RESUME feature that allows encoding to resume
 * from saved progress after backend restarts (killer feature vs Unmanic/Tdarr)
 *
 * Test Scenarios:
 * 1. Resume calculation accuracy (progress → seconds conversion)
 * 2. Temp file existence validation
 * 3. Resume timestamp format (HH:MM:SS)
 * 4. Progress preservation when temp file exists
 * 5. Progress reset when temp file missing
 * 6. Edge cases (0% progress, 100% progress, corrupted temp files)
 */
describe('EncodingProcessorService - TRUE RESUME Integration', () => {
  let service: EncodingProcessorService;
  let prisma: PrismaService;
  let _ffmpegService: FfmpegService;
  let moduleRef: TestingModule;

  // Test fixture paths
  const testFixturesDir = join(__dirname, '../fixtures/temp-files');
  const testTempFile = join(testFixturesDir, '.test-video.tmp-test123');

  beforeAll(async () => {
    // Create test fixtures directory
    await fs.mkdir(testFixturesDir, { recursive: true });

    moduleRef = await Test.createTestingModule({
      providers: [
        EncodingProcessorService,
        PrismaService,
        {
          provide: QueueService,
          useValue: {
            getNextJob: jest.fn(),
            completeJob: jest.fn(),
            failJob: jest.fn(),
            updateProgress: jest.fn(),
          },
        },
        {
          provide: FfmpegService,
          useValue: {
            encode: jest.fn(),
            verifyFile: jest.fn(),
            killProcess: jest.fn(),
            hasActiveProcess: jest.fn().mockReturnValue(false),
            getLastStderr: jest.fn(),
            getVideoDuration: jest.fn().mockResolvedValue(3600), // 1 hour video
          },
        },
        {
          provide: LibrariesService,
          useValue: {
            findOne: jest.fn(),
            update: jest.fn(),
          },
        },
        {
          provide: EventEmitter2,
          useValue: {
            emit: jest.fn(),
            on: jest.fn(),
            once: jest.fn(),
            removeListener: jest.fn(),
            removeAllListeners: jest.fn(),
          },
        },
        {
          provide: NodesService,
          useValue: { findOne: jest.fn(), findAll: jest.fn(), getCurrentNode: jest.fn() },
        },
        {
          provide: DataAccessService,
          useValue: { getNextJob: jest.fn(), updateJobProgress: jest.fn() },
        },
        {
          provide: FileRelocatorService,
          useValue: { relocateFile: jest.fn(), verifyRelocation: jest.fn() },
        },
      ],
    }).compile();

    service = moduleRef.get<EncodingProcessorService>(EncodingProcessorService);
    prisma = moduleRef.get<PrismaService>(PrismaService);
    _ffmpegService = moduleRef.get<FfmpegService>(FfmpegService);
  });

  afterAll(async () => {
    // Cleanup test fixtures
    await fs.rm(testFixturesDir, { recursive: true, force: true });
    await moduleRef.close();
  });

  beforeEach(async () => {
    // Clean up temp files
    try {
      await fs.rm(testTempFile, { force: true });
    } catch (_error) {
      // Ignore if file doesn't exist
    }

    jest.clearAllMocks();
  });

  describe('TRUE RESUME: Resume Position Calculation', () => {
    it('should calculate correct resume position for 50% progress', async () => {
      // ARRANGE: Create orphaned job at 50% progress
      const testNode = await prisma.node.findFirst();
      const testLibrary = await prisma.library.findFirst();
      const testPolicy = await prisma.policy.findFirst();

      if (!testNode || !testLibrary || !testPolicy) {
        throw new Error('Test database not seeded');
      }

      // Create temp file to simulate partial encoding
      await fs.writeFile(testTempFile, 'partial video data');

      const jobId = 'test-resume-50pct';
      await prisma.job.create({
        data: {
          id: jobId,
          filePath: '/tmp/test-video.mkv',
          fileLabel: 'Test Video 50%.mkv',
          sourceCodec: 'H.264',
          targetCodec: 'HEVC',
          beforeSizeBytes: BigInt(1000000000),
          stage: JobStage.ENCODING,
          progress: 50.0, // 50% complete
          tempFilePath: testTempFile,
          nodeId: testNode.id,
          libraryId: testLibrary.id,
          policyId: testPolicy.id,
          startedAt: new Date(),
        },
      });

      // ACT: Trigger auto-heal
      await service.onModuleInit();

      // ASSERT: Resume timestamp should be 00:30:00 (50% of 1 hour)
      const healedJob = await prisma.job.findUnique({
        where: { id: jobId },
      });

      expect(healedJob).toBeTruthy();
      expect(healedJob?.stage).toBe(JobStage.QUEUED);
      expect(healedJob?.progress).toBe(50.0); // Progress preserved
      expect(healedJob?.resumeTimestamp).toBe('00:30:00'); // 1800 seconds = 30 minutes
      expect(healedJob?.tempFilePath).toBe(testTempFile); // Temp file path preserved

      // Cleanup
      await prisma.job.delete({ where: { id: jobId } });
    });

    it('should calculate correct resume position for 25% progress', async () => {
      const testNode = await prisma.node.findFirst();
      const testLibrary = await prisma.library.findFirst();
      const testPolicy = await prisma.policy.findFirst();

      if (!testNode || !testLibrary || !testPolicy) {
        throw new Error('Test database not seeded');
      }

      await fs.writeFile(testTempFile, 'partial video data');

      const jobId = 'test-resume-25pct';
      await prisma.job.create({
        data: {
          id: jobId,
          filePath: '/tmp/test-video.mkv',
          fileLabel: 'Test Video 25%.mkv',
          sourceCodec: 'H.264',
          targetCodec: 'HEVC',
          beforeSizeBytes: BigInt(1000000000),
          stage: JobStage.ENCODING,
          progress: 25.0, // 25% complete
          tempFilePath: testTempFile,
          nodeId: testNode.id,
          libraryId: testLibrary.id,
          policyId: testPolicy.id,
        },
      });

      await service.onModuleInit();

      const healedJob = await prisma.job.findUnique({
        where: { id: jobId },
      });

      expect(healedJob?.resumeTimestamp).toBe('00:15:00'); // 900 seconds = 15 minutes
      expect(healedJob?.progress).toBe(25.0);

      await prisma.job.delete({ where: { id: jobId } });
    });

    it('should calculate correct resume position for 75.5% progress (decimal)', async () => {
      const testNode = await prisma.node.findFirst();
      const testLibrary = await prisma.library.findFirst();
      const testPolicy = await prisma.policy.findFirst();

      if (!testNode || !testLibrary || !testPolicy) {
        throw new Error('Test database not seeded');
      }

      await fs.writeFile(testTempFile, 'partial video data');

      const jobId = 'test-resume-75pct';
      await prisma.job.create({
        data: {
          id: jobId,
          filePath: '/tmp/test-video.mkv',
          fileLabel: 'Test Video 75.5%.mkv',
          sourceCodec: 'H.264',
          targetCodec: 'HEVC',
          beforeSizeBytes: BigInt(1000000000),
          stage: JobStage.ENCODING,
          progress: 75.5, // 75.5% complete
          tempFilePath: testTempFile,
          nodeId: testNode.id,
          libraryId: testLibrary.id,
          policyId: testPolicy.id,
        },
      });

      await service.onModuleInit();

      const healedJob = await prisma.job.findUnique({
        where: { id: jobId },
      });

      // 75.5% of 3600s = 2718s = 00:45:18
      expect(healedJob?.resumeTimestamp).toBe('00:45:18');
      expect(healedJob?.progress).toBe(75.5);

      await prisma.job.delete({ where: { id: jobId } });
    });
  });

  describe('TRUE RESUME: Temp File Validation', () => {
    it('should preserve progress when temp file EXISTS', async () => {
      const testNode = await prisma.node.findFirst();
      const testLibrary = await prisma.library.findFirst();
      const testPolicy = await prisma.policy.findFirst();

      if (!testNode || !testLibrary || !testPolicy) {
        throw new Error('Test database not seeded');
      }

      // Create temp file
      await fs.writeFile(testTempFile, 'partial video data');

      const jobId = 'test-temp-exists';
      await prisma.job.create({
        data: {
          id: jobId,
          filePath: '/tmp/test-video.mkv',
          fileLabel: 'Test Temp Exists.mkv',
          sourceCodec: 'H.264',
          targetCodec: 'HEVC',
          beforeSizeBytes: BigInt(1000000000),
          stage: JobStage.ENCODING,
          progress: 45.0,
          tempFilePath: testTempFile,
          nodeId: testNode.id,
          libraryId: testLibrary.id,
          policyId: testPolicy.id,
        },
      });

      await service.onModuleInit();

      const healedJob = await prisma.job.findUnique({
        where: { id: jobId },
      });

      expect(healedJob?.progress).toBe(45.0); // Progress PRESERVED
      expect(healedJob?.tempFilePath).toBe(testTempFile); // Path PRESERVED
      expect(healedJob?.resumeTimestamp).toBeTruthy(); // Timestamp SET

      await prisma.job.delete({ where: { id: jobId } });
    });

    it('should reset progress when temp file MISSING', async () => {
      const testNode = await prisma.node.findFirst();
      const testLibrary = await prisma.library.findFirst();
      const testPolicy = await prisma.policy.findFirst();

      if (!testNode || !testLibrary || !testPolicy) {
        throw new Error('Test database not seeded');
      }

      // DO NOT create temp file - simulating missing file

      const jobId = 'test-temp-missing';
      await prisma.job.create({
        data: {
          id: jobId,
          filePath: '/tmp/test-video.mkv',
          fileLabel: 'Test Temp Missing.mkv',
          sourceCodec: 'H.264',
          targetCodec: 'HEVC',
          beforeSizeBytes: BigInt(1000000000),
          stage: JobStage.ENCODING,
          progress: 60.0, // Was at 60%
          tempFilePath: testTempFile, // Path exists in DB but file is missing
          nodeId: testNode.id,
          libraryId: testLibrary.id,
          policyId: testPolicy.id,
        },
      });

      await service.onModuleInit();

      const healedJob = await prisma.job.findUnique({
        where: { id: jobId },
      });

      expect(healedJob?.progress).toBe(0); // Progress RESET
      expect(healedJob?.tempFilePath).toBeNull(); // Path CLEARED
      expect(healedJob?.resumeTimestamp).toBeNull(); // Timestamp CLEARED

      await prisma.job.delete({ where: { id: jobId } });
    });
  });

  describe('TRUE RESUME: Edge Cases', () => {
    it('should handle 0% progress (job just started)', async () => {
      const testNode = await prisma.node.findFirst();
      const testLibrary = await prisma.library.findFirst();
      const testPolicy = await prisma.policy.findFirst();

      if (!testNode || !testLibrary || !testPolicy) {
        throw new Error('Test database not seeded');
      }

      await fs.writeFile(testTempFile, '');

      const jobId = 'test-0pct';
      await prisma.job.create({
        data: {
          id: jobId,
          filePath: '/tmp/test-video.mkv',
          fileLabel: 'Test 0%.mkv',
          sourceCodec: 'H.264',
          targetCodec: 'HEVC',
          beforeSizeBytes: BigInt(1000000000),
          stage: JobStage.ENCODING,
          progress: 0.0,
          tempFilePath: testTempFile,
          nodeId: testNode.id,
          libraryId: testLibrary.id,
          policyId: testPolicy.id,
        },
      });

      await service.onModuleInit();

      const healedJob = await prisma.job.findUnique({
        where: { id: jobId },
      });

      // 0% should NOT calculate resume position
      expect(healedJob?.progress).toBe(0.0);
      // Resume timestamp might not be set for 0% progress

      await prisma.job.delete({ where: { id: jobId } });
    });

    it('should handle job with tempFilePath=null', async () => {
      const testNode = await prisma.node.findFirst();
      const testLibrary = await prisma.library.findFirst();
      const testPolicy = await prisma.policy.findFirst();

      if (!testNode || !testLibrary || !testPolicy) {
        throw new Error('Test database not seeded');
      }

      const jobId = 'test-null-temp';
      await prisma.job.create({
        data: {
          id: jobId,
          filePath: '/tmp/test-video.mkv',
          fileLabel: 'Test Null Temp.mkv',
          sourceCodec: 'H.264',
          targetCodec: 'HEVC',
          beforeSizeBytes: BigInt(1000000000),
          stage: JobStage.ENCODING,
          progress: 30.0,
          tempFilePath: null, // NULL temp path
          nodeId: testNode.id,
          libraryId: testLibrary.id,
          policyId: testPolicy.id,
        },
      });

      await service.onModuleInit();

      const healedJob = await prisma.job.findUnique({
        where: { id: jobId },
      });

      // Should reset progress since no temp file
      expect(healedJob?.progress).toBe(0);
      expect(healedJob?.tempFilePath).toBeNull();

      await prisma.job.delete({ where: { id: jobId } });
    });

    it('should handle multiple orphaned jobs with mixed temp file states', async () => {
      const testNode = await prisma.node.findFirst();
      const testLibrary = await prisma.library.findFirst();
      const testPolicy = await prisma.policy.findFirst();

      if (!testNode || !testLibrary || !testPolicy) {
        throw new Error('Test database not seeded');
      }

      // Create temp file for first job only
      const tempFile1 = join(testFixturesDir, '.test1.tmp-test1');
      await fs.writeFile(tempFile1, 'data');

      const jobs = [
        {
          id: 'test-multi-1',
          tempFilePath: tempFile1,
          progress: 40.0,
          shouldPreserve: true,
        },
        {
          id: 'test-multi-2',
          tempFilePath: join(testFixturesDir, '.test2.tmp-test2'), // Doesn't exist
          progress: 50.0,
          shouldPreserve: false,
        },
        {
          id: 'test-multi-3',
          tempFilePath: null,
          progress: 60.0,
          shouldPreserve: false,
        },
      ];

      for (const jobData of jobs) {
        await prisma.job.create({
          data: {
            id: jobData.id,
            filePath: '/tmp/test-video.mkv',
            fileLabel: `Test ${jobData.id}.mkv`,
            sourceCodec: 'H.264',
            targetCodec: 'HEVC',
            beforeSizeBytes: BigInt(1000000000),
            stage: JobStage.ENCODING,
            progress: jobData.progress,
            tempFilePath: jobData.tempFilePath,
            nodeId: testNode.id,
            libraryId: testLibrary.id,
            policyId: testPolicy.id,
          },
        });
      }

      await service.onModuleInit();

      for (const jobData of jobs) {
        const healedJob = await prisma.job.findUnique({
          where: { id: jobData.id },
        });

        if (jobData.shouldPreserve) {
          expect(healedJob?.progress).toBe(jobData.progress);
          expect(healedJob?.tempFilePath).toBeTruthy();
        } else {
          expect(healedJob?.progress).toBe(0);
          expect(healedJob?.tempFilePath).toBeNull();
        }
      }

      // Cleanup
      await prisma.job.deleteMany({
        where: { id: { in: jobs.map((j) => j.id) } },
      });
    });
  });

  describe('TRUE RESUME: Resume Timestamp Format', () => {
    it('should format timestamp as HH:MM:SS', async () => {
      const testNode = await prisma.node.findFirst();
      const testLibrary = await prisma.library.findFirst();
      const testPolicy = await prisma.policy.findFirst();

      if (!testNode || !testLibrary || !testPolicy) {
        throw new Error('Test database not seeded');
      }

      await fs.writeFile(testTempFile, 'data');

      const testCases = [
        { progress: 10.0, expected: '00:06:00' }, // 360s
        { progress: 33.33, expected: '00:19:59' }, // 1199s
        { progress: 99.0, expected: '00:59:24' }, // 3564s
      ];

      for (const testCase of testCases) {
        const jobId = `test-format-${testCase.progress}`;
        await prisma.job.create({
          data: {
            id: jobId,
            filePath: '/tmp/test-video.mkv',
            fileLabel: `Test ${testCase.progress}%.mkv`,
            sourceCodec: 'H.264',
            targetCodec: 'HEVC',
            beforeSizeBytes: BigInt(1000000000),
            stage: JobStage.ENCODING,
            progress: testCase.progress,
            tempFilePath: testTempFile,
            nodeId: testNode.id,
            libraryId: testLibrary.id,
            policyId: testPolicy.id,
          },
        });

        await service.onModuleInit();

        const healedJob = await prisma.job.findUnique({
          where: { id: jobId },
        });

        expect(healedJob?.resumeTimestamp).toMatch(/^\d{2}:\d{2}:\d{2}$/);
        expect(healedJob?.resumeTimestamp).toBe(testCase.expected);

        await prisma.job.delete({ where: { id: jobId } });
      }
    });
  });
});
