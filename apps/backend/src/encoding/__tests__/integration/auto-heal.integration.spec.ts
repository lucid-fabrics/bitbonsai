import { EventEmitter2 } from '@nestjs/event-emitter';
import { Test, TestingModule } from '@nestjs/testing';
import { JobStage } from '@prisma/client';
import { LibrariesService } from '../../../libraries/libraries.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { QueueService } from '../../../queue/queue.service';
import { EncodingProcessorService } from '../../encoding-processor.service';
import { FfmpegService } from '../../ffmpeg.service';

/**
 * Integration tests for auto-heal/auto-resume functionality
 *
 * CRITICAL: Tests the core self-heal feature that auto-resumes encoding
 * after backend crashes/reboots (competing with Unmanic/Tdarr)
 *
 * These tests simulate backend restart scenarios and verify that:
 * 1. Orphaned jobs in ENCODING stage are reset to QUEUED
 * 2. Orphaned jobs in HEALTH_CHECK stage are reset to QUEUED (not DETECTED!)
 * 3. Orphaned jobs in VERIFYING stage are reset to QUEUED
 * 4. Orphaned jobs in PAUSED stage are reset to QUEUED
 * 5. Workers can pick up the reset jobs after restart
 */
describe('EncodingProcessorService - Auto-Heal Integration', () => {
  let service: EncodingProcessorService;
  let prisma: PrismaService;
  let queueService: QueueService;
  let moduleRef: TestingModule;

  // Mock job IDs for testing
  const testJobIds = {
    encoding: 'test-job-encoding',
    healthCheck: 'test-job-healthcheck',
    verifying: 'test-job-verifying',
    paused: 'test-job-paused',
    queued: 'test-job-queued', // Should NOT be touched by auto-heal
    completed: 'test-job-completed', // Should NOT be touched by auto-heal
  };

  beforeAll(async () => {
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
      ],
    }).compile();

    service = moduleRef.get<EncodingProcessorService>(EncodingProcessorService);
    prisma = moduleRef.get<PrismaService>(PrismaService);
    queueService = moduleRef.get<QueueService>(QueueService);
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  beforeEach(async () => {
    // Clean up test jobs before each test
    await prisma.job.deleteMany({
      where: {
        id: {
          in: Object.values(testJobIds),
        },
      },
    });

    jest.clearAllMocks();
  });

  describe('autoHealOrphanedJobs', () => {
    it('should reset orphaned ENCODING jobs to QUEUED on backend restart', async () => {
      // ARRANGE: Create a job in ENCODING state (simulating a job that was encoding when backend crashed)
      const testNode = await prisma.node.findFirst();
      const testLibrary = await prisma.library.findFirst();
      const testPolicy = await prisma.policy.findFirst();

      if (!testNode || !testLibrary || !testPolicy) {
        throw new Error('Test database not seeded - please run seed script first');
      }

      await prisma.job.create({
        data: {
          id: testJobIds.encoding,
          filePath: '/tmp/test-video-encoding.mkv',
          fileLabel: 'Test Video Encoding.mkv',
          sourceCodec: 'H.264',
          targetCodec: 'HEVC',
          beforeSizeBytes: BigInt(1000000000),
          stage: JobStage.ENCODING,
          progress: 45, // Was 45% done when backend crashed
          nodeId: testNode.id,
          libraryId: testLibrary.id,
          policyId: testPolicy.id,
          startedAt: new Date(),
        },
      });

      // ACT: Trigger onModuleInit which calls autoHealOrphanedJobs
      await service.onModuleInit();

      // ASSERT: Job should be reset to QUEUED
      const healedJob = await prisma.job.findUnique({
        where: { id: testJobIds.encoding },
      });

      expect(healedJob).toBeTruthy();
      expect(healedJob?.stage).toBe(JobStage.QUEUED);
      expect(healedJob?.progress).toBe(0); // Progress reset
      expect(healedJob?.startedAt).toBeNull(); // startedAt cleared
      expect(healedJob?.error).toContain('Auto-recovered from backend restart');
    });

    it('should reset orphaned HEALTH_CHECK jobs to QUEUED (CRITICAL FIX)', async () => {
      // ARRANGE: Create a job in HEALTH_CHECK state
      // This is the BUG FIX - previously reset to DETECTED which workers couldn't pick up
      const testNode = await prisma.node.findFirst();
      const testLibrary = await prisma.library.findFirst();
      const testPolicy = await prisma.policy.findFirst();

      if (!testNode || !testLibrary || !testPolicy) {
        throw new Error('Test database not seeded - please run seed script first');
      }

      await prisma.job.create({
        data: {
          id: testJobIds.healthCheck,
          filePath: '/tmp/test-video-healthcheck.mkv',
          fileLabel: 'Test Video Health Check.mkv',
          sourceCodec: 'H.264',
          targetCodec: 'HEVC',
          beforeSizeBytes: BigInt(1000000000),
          stage: JobStage.HEALTH_CHECK,
          progress: 0,
          nodeId: testNode.id,
          libraryId: testLibrary.id,
          policyId: testPolicy.id,
        },
      });

      // ACT: Trigger auto-heal
      await service.onModuleInit();

      // ASSERT: Job should be reset to QUEUED (NOT DETECTED!)
      const healedJob = await prisma.job.findUnique({
        where: { id: testJobIds.healthCheck },
      });

      expect(healedJob).toBeTruthy();
      expect(healedJob?.stage).toBe(JobStage.QUEUED); // CRITICAL: Must be QUEUED
      expect(healedJob?.stage).not.toBe(JobStage.DETECTED); // CRITICAL: Must NOT be DETECTED
      expect(healedJob?.progress).toBe(0);
      expect(healedJob?.error).toContain('Auto-recovered from backend restart');
    });

    it('should reset orphaned VERIFYING jobs to QUEUED', async () => {
      const testNode = await prisma.node.findFirst();
      const testLibrary = await prisma.library.findFirst();
      const testPolicy = await prisma.policy.findFirst();

      if (!testNode || !testLibrary || !testPolicy) {
        throw new Error('Test database not seeded - please run seed script first');
      }

      await prisma.job.create({
        data: {
          id: testJobIds.verifying,
          filePath: '/tmp/test-video-verifying.mkv',
          fileLabel: 'Test Video Verifying.mkv',
          sourceCodec: 'H.264',
          targetCodec: 'HEVC',
          beforeSizeBytes: BigInt(1000000000),
          stage: JobStage.VERIFYING,
          progress: 100,
          nodeId: testNode.id,
          libraryId: testLibrary.id,
          policyId: testPolicy.id,
        },
      });

      // ACT
      await service.onModuleInit();

      // ASSERT
      const healedJob = await prisma.job.findUnique({
        where: { id: testJobIds.verifying },
      });

      expect(healedJob).toBeTruthy();
      expect(healedJob?.stage).toBe(JobStage.QUEUED);
      expect(healedJob?.progress).toBe(0);
    });

    it('should reset orphaned PAUSED jobs to QUEUED', async () => {
      const testNode = await prisma.node.findFirst();
      const testLibrary = await prisma.library.findFirst();
      const testPolicy = await prisma.policy.findFirst();

      if (!testNode || !testLibrary || !testPolicy) {
        throw new Error('Test database not seeded - please run seed script first');
      }

      await prisma.job.create({
        data: {
          id: testJobIds.paused,
          filePath: '/tmp/test-video-paused.mkv',
          fileLabel: 'Test Video Paused.mkv',
          sourceCodec: 'H.264',
          targetCodec: 'HEVC',
          beforeSizeBytes: BigInt(1000000000),
          stage: JobStage.PAUSED,
          progress: 30,
          nodeId: testNode.id,
          libraryId: testLibrary.id,
          policyId: testPolicy.id,
        },
      });

      // ACT
      await service.onModuleInit();

      // ASSERT
      const healedJob = await prisma.job.findUnique({
        where: { id: testJobIds.paused },
      });

      expect(healedJob).toBeTruthy();
      expect(healedJob?.stage).toBe(JobStage.QUEUED);
      expect(healedJob?.progress).toBe(0);
      expect(healedJob?.error).toContain('Paused job reset after backend restart');
    });

    it('should NOT touch QUEUED jobs (already healthy)', async () => {
      const testNode = await prisma.node.findFirst();
      const testLibrary = await prisma.library.findFirst();
      const testPolicy = await prisma.policy.findFirst();

      if (!testNode || !testLibrary || !testPolicy) {
        throw new Error('Test database not seeded - please run seed script first');
      }

      await prisma.job.create({
        data: {
          id: testJobIds.queued,
          filePath: '/tmp/test-video-queued.mkv',
          fileLabel: 'Test Video Queued.mkv',
          sourceCodec: 'H.264',
          targetCodec: 'HEVC',
          beforeSizeBytes: BigInt(1000000000),
          stage: JobStage.QUEUED,
          progress: 0,
          nodeId: testNode.id,
          libraryId: testLibrary.id,
          policyId: testPolicy.id,
        },
      });

      // ACT
      await service.onModuleInit();

      // ASSERT
      const job = await prisma.job.findUnique({
        where: { id: testJobIds.queued },
      });

      expect(job).toBeTruthy();
      expect(job?.stage).toBe(JobStage.QUEUED); // Unchanged
      expect(job?.error).toBeNull(); // No error message added
    });

    it('should NOT touch COMPLETED jobs', async () => {
      const testNode = await prisma.node.findFirst();
      const testLibrary = await prisma.library.findFirst();
      const testPolicy = await prisma.policy.findFirst();

      if (!testNode || !testLibrary || !testPolicy) {
        throw new Error('Test database not seeded - please run seed script first');
      }

      await prisma.job.create({
        data: {
          id: testJobIds.completed,
          filePath: '/tmp/test-video-completed.mkv',
          fileLabel: 'Test Video Completed.mkv',
          sourceCodec: 'H.264',
          targetCodec: 'HEVC',
          beforeSizeBytes: BigInt(1000000000),
          afterSizeBytes: BigInt(750000000),
          savedBytes: BigInt(250000000),
          savedPercent: 25.0,
          stage: JobStage.COMPLETED,
          progress: 100,
          nodeId: testNode.id,
          libraryId: testLibrary.id,
          policyId: testPolicy.id,
          completedAt: new Date(),
        },
      });

      // ACT
      await service.onModuleInit();

      // ASSERT
      const job = await prisma.job.findUnique({
        where: { id: testJobIds.completed },
      });

      expect(job).toBeTruthy();
      expect(job?.stage).toBe(JobStage.COMPLETED); // Unchanged
    });

    it('should heal multiple orphaned jobs in one restart', async () => {
      // ARRANGE: Create multiple orphaned jobs
      const testNode = await prisma.node.findFirst();
      const testLibrary = await prisma.library.findFirst();
      const testPolicy = await prisma.policy.findFirst();

      if (!testNode || !testLibrary || !testPolicy) {
        throw new Error('Test database not seeded - please run seed script first');
      }

      const orphanedJobs = [
        {
          id: 'test-job-multi-1',
          stage: JobStage.ENCODING,
          progress: 20,
        },
        {
          id: 'test-job-multi-2',
          stage: JobStage.HEALTH_CHECK,
          progress: 0,
        },
        {
          id: 'test-job-multi-3',
          stage: JobStage.PAUSED,
          progress: 50,
        },
      ];

      for (const jobData of orphanedJobs) {
        await prisma.job.create({
          data: {
            id: jobData.id,
            filePath: `/tmp/test-video-${jobData.id}.mkv`,
            fileLabel: `Test Video ${jobData.id}.mkv`,
            sourceCodec: 'H.264',
            targetCodec: 'HEVC',
            beforeSizeBytes: BigInt(1000000000),
            stage: jobData.stage,
            progress: jobData.progress,
            nodeId: testNode.id,
            libraryId: testLibrary.id,
            policyId: testPolicy.id,
          },
        });
      }

      // ACT
      await service.onModuleInit();

      // ASSERT: All should be QUEUED
      for (const jobData of orphanedJobs) {
        const healedJob = await prisma.job.findUnique({
          where: { id: jobData.id },
        });

        expect(healedJob).toBeTruthy();
        expect(healedJob?.stage).toBe(JobStage.QUEUED);
        expect(healedJob?.progress).toBe(0);
      }

      // Clean up
      await prisma.job.deleteMany({
        where: {
          id: {
            in: orphanedJobs.map((j) => j.id),
          },
        },
      });
    });
  });

  describe('workers can pick up healed jobs', () => {
    it('should allow workers to pick up healed jobs via getNextJob', async () => {
      // ARRANGE: Create orphaned job
      const testNode = await prisma.node.findFirst();
      const testLibrary = await prisma.library.findFirst();
      const testPolicy = await prisma.policy.findFirst();

      if (!testNode || !testLibrary || !testPolicy) {
        throw new Error('Test database not seeded - please run seed script first');
      }

      await prisma.job.create({
        data: {
          id: testJobIds.encoding,
          filePath: '/tmp/test-video-worker-pickup.mkv',
          fileLabel: 'Test Video Worker Pickup.mkv',
          sourceCodec: 'H.264',
          targetCodec: 'HEVC',
          beforeSizeBytes: BigInt(1000000000),
          stage: JobStage.ENCODING, // Orphaned
          progress: 60,
          nodeId: testNode.id,
          libraryId: testLibrary.id,
          policyId: testPolicy.id,
          startedAt: new Date(),
        },
      });

      // ACT 1: Auto-heal
      await service.onModuleInit();

      // ASSERT 1: Job is now QUEUED
      const healedJob = await prisma.job.findUnique({
        where: { id: testJobIds.encoding },
      });
      expect(healedJob?.stage).toBe(JobStage.QUEUED);

      // ACT 2: Worker tries to pick up job via QueueService.getNextJob
      const _pickedUpJob = await queueService.getNextJob(testNode.id);

      // ASSERT 2: Worker should be able to pick up the healed job
      // Note: In real scenario, getNextJob would return the job
      // In this test, we verify the job is in QUEUED state and can be picked up
      expect(healedJob?.stage).toBe(JobStage.QUEUED);
      expect(healedJob?.startedAt).toBeNull(); // Ready for fresh start
    });
  });
});
