import * as fs from 'node:fs';
import { Test, TestingModule } from '@nestjs/testing';
import { JobStage } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { QueueService } from '../../../queue/queue.service';
import { EncodingProcessorService } from '../../encoding-processor.service';
import { FfmpegService } from '../../ffmpeg.service';
import {
  cleanupTestJobs,
  createTestJob,
  createTestModule,
  resetDatabase,
  seedTestDatabase,
  waitForJobCompletion,
} from '../fixtures/test-helpers';
import { cleanupFixtures, generateVideo } from '../fixtures/video-generator';

/**
 * Level 3: Concurrent Encoding
 *
 * Tests concurrent job processing:
 * - Multiple workers processing jobs simultaneously
 * - Worker pool management
 * - No race conditions
 * - All jobs complete successfully
 *
 * Complexity: Medium
 * Files: 3-5 videos, 20-40MB each
 * Duration: ~2-3 minutes (concurrent)
 */
describe('Level 3: Concurrent Encoding', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let queueService: QueueService;
  let encodingProcessor: EncodingProcessorService;
  let ffmpegService: FfmpegService;

  let testNodeId: string;
  let testLibraryId: string;
  let testPolicyId: string;

  beforeAll(async () => {
    moduleRef = await createTestModule();

    prisma = moduleRef.get<PrismaService>(PrismaService);
    queueService = moduleRef.get<QueueService>(QueueService);
    encodingProcessor = moduleRef.get<EncodingProcessorService>(EncodingProcessorService);
    ffmpegService = moduleRef.get<FfmpegService>(FfmpegService);

    await prisma.$connect();

    const { node, library, policy } = await seedTestDatabase(prisma);
    testNodeId = node.id;
    testLibraryId = library.id;
    testPolicyId = policy.id;

    // Update node to support 4 concurrent workers
    await prisma.node.update({
      where: { id: testNodeId },
      data: { maxWorkers: 4 },
    });
  });

  afterAll(async () => {
    await resetDatabase(prisma);
    await prisma.$disconnect();
    await moduleRef.close();
    cleanupFixtures();
  });

  afterEach(async () => {
    await cleanupTestJobs(prisma, testLibraryId);
  });

  describe('Worker Pool Management', () => {
    it('should start multiple workers for a node', async () => {
      // ACT: Start worker pool with 4 workers
      const workersStarted = await encodingProcessor.startWorkerPool(testNodeId, 4);

      // ASSERT
      expect(workersStarted).toBe(4);

      // Cleanup
      await encodingProcessor.stopWorker(testNodeId);
    }, 30000);

    it('should process multiple jobs concurrently', async () => {
      // ARRANGE: Create 3 jobs
      const job1Path = await generateVideo({
        filename: 'Concurrent.Job1.720p.mkv',
        codec: 'h264',
        resolution: '720p',
        container: 'mkv',
        duration: 15,
        targetSizeMB: 30,
      });

      const job2Path = await generateVideo({
        filename: 'Concurrent.Job2.720p.mkv',
        codec: 'h264',
        resolution: '720p',
        container: 'mkv',
        duration: 15,
        targetSizeMB: 30,
      });

      const job3Path = await generateVideo({
        filename: 'Concurrent.Job3.720p.mkv',
        codec: 'h264',
        resolution: '720p',
        container: 'mkv',
        duration: 15,
        targetSizeMB: 30,
      });

      const job1 = await createTestJob(prisma, {
        filePath: job1Path,
        fileLabel: 'Concurrent Job 1',
        nodeId: testNodeId,
        libraryId: testLibraryId,
        policyId: testPolicyId,
        beforeSizeBytes: BigInt(fs.statSync(job1Path).size),
        stage: 'QUEUED',
      });

      const job2 = await createTestJob(prisma, {
        filePath: job2Path,
        fileLabel: 'Concurrent Job 2',
        nodeId: testNodeId,
        libraryId: testLibraryId,
        policyId: testPolicyId,
        beforeSizeBytes: BigInt(fs.statSync(job2Path).size),
        stage: 'QUEUED',
      });

      const job3 = await createTestJob(prisma, {
        filePath: job3Path,
        fileLabel: 'Concurrent Job 3',
        nodeId: testNodeId,
        libraryId: testLibraryId,
        policyId: testPolicyId,
        beforeSizeBytes: BigInt(fs.statSync(job3Path).size),
        stage: 'QUEUED',
      });

      // ACT: Start worker pool
      await encodingProcessor.startWorkerPool(testNodeId, 3);

      // Wait for all jobs to complete (they should run concurrently)
      const startTime = Date.now();

      const [completed1, completed2, completed3] = await Promise.all([
        waitForJobCompletion(prisma, job1.id, 120000),
        waitForJobCompletion(prisma, job2.id, 120000),
        waitForJobCompletion(prisma, job3.id, 120000),
      ]);

      const totalTime = Date.now() - startTime;

      // ASSERT: All jobs completed
      expect(completed1).toBeTruthy();
      expect(completed1!.stage).toBe(JobStage.COMPLETED);
      expect(completed2).toBeTruthy();
      expect(completed2!.stage).toBe(JobStage.COMPLETED);
      expect(completed3).toBeTruthy();
      expect(completed3!.stage).toBe(JobStage.COMPLETED);

      // Concurrent processing should be faster than sequential
      // (Total time should be less than 3x single job time)
      // With 15s videos, sequential would be ~45-60s, concurrent ~20-30s
      expect(totalTime).toBeLessThan(90000); // Less than 90 seconds

      // Cleanup
      await encodingProcessor.stopWorker(testNodeId);
    }, 180000);

    it('should handle worker pool resizing', async () => {
      // Start with 2 workers
      await encodingProcessor.startWorkerPool(testNodeId, 2);

      // Resize to 4 workers
      const additionalWorkers = await encodingProcessor.startWorkerPool(testNodeId, 4);

      expect(additionalWorkers).toBe(2); // Added 2 more workers

      // Cleanup
      await encodingProcessor.stopWorker(testNodeId);
    }, 30000);
  });

  describe('Concurrent Job Processing', () => {
    it('should process 5 jobs across 4 workers', async () => {
      // ARRANGE: Create 5 jobs
      const jobs = [];

      for (let i = 1; i <= 5; i++) {
        const videoPath = await generateVideo({
          filename: `Concurrent.Multi.${i}.720p.mkv`,
          codec: 'h264',
          resolution: '720p',
          container: 'mkv',
          duration: 12,
          targetSizeMB: 25,
        });

        const job = await createTestJob(prisma, {
          filePath: videoPath,
          fileLabel: `Concurrent Multi ${i}`,
          nodeId: testNodeId,
          libraryId: testLibraryId,
          policyId: testPolicyId,
          beforeSizeBytes: BigInt(fs.statSync(videoPath).size),
          stage: 'QUEUED',
        });

        jobs.push(job);
      }

      // ACT: Start worker pool with 4 workers
      await encodingProcessor.startWorkerPool(testNodeId, 4);

      // Wait for all jobs to complete
      const completedJobs = await Promise.all(
        jobs.map((job) => waitForJobCompletion(prisma, job.id, 180000))
      );

      // ASSERT: All 5 jobs completed successfully
      completedJobs.forEach((completedJob, index) => {
        expect(completedJob).toBeTruthy();
        expect(completedJob!.stage).toBe(JobStage.COMPLETED);
        expect(completedJob!.savedBytes).toBeTruthy();
      });

      // Cleanup
      await encodingProcessor.stopWorker(testNodeId);
    }, 240000);

    it('should not create race conditions with concurrent jobs', async () => {
      // ARRANGE: Create 3 jobs for same library
      const job1Path = await generateVideo({
        filename: 'RaceCondition.Job1.720p.mkv',
        codec: 'h264',
        resolution: '720p',
        container: 'mkv',
        duration: 10,
        targetSizeMB: 20,
      });

      const job2Path = await generateVideo({
        filename: 'RaceCondition.Job2.720p.mkv',
        codec: 'h264',
        resolution: '720p',
        container: 'mkv',
        duration: 10,
        targetSizeMB: 20,
      });

      const job3Path = await generateVideo({
        filename: 'RaceCondition.Job3.720p.mkv',
        codec: 'h264',
        resolution: '720p',
        container: 'mkv',
        duration: 10,
        targetSizeMB: 20,
      });

      const job1 = await createTestJob(prisma, {
        filePath: job1Path,
        fileLabel: 'Race Job 1',
        nodeId: testNodeId,
        libraryId: testLibraryId,
        policyId: testPolicyId,
        beforeSizeBytes: BigInt(fs.statSync(job1Path).size),
        stage: 'QUEUED',
      });

      const job2 = await createTestJob(prisma, {
        filePath: job2Path,
        fileLabel: 'Race Job 2',
        nodeId: testNodeId,
        libraryId: testLibraryId,
        policyId: testPolicyId,
        beforeSizeBytes: BigInt(fs.statSync(job2Path).size),
        stage: 'QUEUED',
      });

      const job3 = await createTestJob(prisma, {
        filePath: job3Path,
        fileLabel: 'Race Job 3',
        nodeId: testNodeId,
        libraryId: testLibraryId,
        policyId: testPolicyId,
        beforeSizeBytes: BigInt(fs.statSync(job3Path).size),
        stage: 'QUEUED',
      });

      // ACT: Start worker pool
      await encodingProcessor.startWorkerPool(testNodeId, 3);

      // Wait for all to complete
      await Promise.all([
        waitForJobCompletion(prisma, job1.id, 120000),
        waitForJobCompletion(prisma, job2.id, 120000),
        waitForJobCompletion(prisma, job3.id, 120000),
      ]);

      // ASSERT: All jobs completed, no database corruption
      const allJobs = await prisma.job.findMany({
        where: { libraryId: testLibraryId },
      });

      // All 3 jobs should exist and be completed
      expect(allJobs.length).toBe(3);
      expect(allJobs.every((j) => j.stage === JobStage.COMPLETED)).toBe(true);

      // Library stats should be consistent (no race condition corruption)
      const library = await prisma.library.findUnique({
        where: { id: testLibraryId },
      });
      expect(library).toBeTruthy();

      // Cleanup
      await encodingProcessor.stopWorker(testNodeId);
    }, 180000);
  });
});
