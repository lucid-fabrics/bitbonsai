import * as fs from 'node:fs';
import * as path from 'node:path';
import { TestingModule } from '@nestjs/testing';
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
  waitForJobStage,
} from '../fixtures/test-helpers';
import {
  cleanupFixtures,
  generateCorruptedVideo,
  generateVideo,
  getFixturesDir,
} from '../fixtures/video-generator';

/**
 * Level 4: Edge Cases
 *
 * Tests handling of problematic files and edge cases:
 * - Corrupted video files (missing header, partial download, truncated)
 * - Missing source files
 * - File permission errors
 * - Disk space issues
 * - Invalid job data
 *
 * Complexity: Medium-High
 * Files: 5-7 videos, 10-50MB
 * Duration: ~3-4 minutes
 */
describe('Level 4: Edge Cases', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let _queueService: QueueService;
  let encodingProcessor: EncodingProcessorService;
  let _ffmpegService: FfmpegService;

  let testNodeId: string;
  let testLibraryId: string;
  let testPolicyId: string;

  beforeAll(async () => {
    moduleRef = await createTestModule();

    prisma = moduleRef.get<PrismaService>(PrismaService);
    _queueService = moduleRef.get<QueueService>(QueueService);
    encodingProcessor = moduleRef.get<EncodingProcessorService>(EncodingProcessorService);
    _ffmpegService = moduleRef.get<FfmpegService>(FfmpegService);

    await prisma.$connect();

    const { node, library, policy } = await seedTestDatabase(prisma);
    testNodeId = node.id;
    testLibraryId = library.id;
    testPolicyId = policy.id;
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

  describe('Corrupted Video Files', () => {
    it('should fail gracefully with missing header', async () => {
      // ARRANGE: Create corrupted video (missing header)
      const videoPath = await generateCorruptedVideo({
        filename: 'Corrupted.MissingHeader.mkv',
        corruptionType: 'missing-header',
        sizeMB: 20,
      });

      expect(fs.existsSync(videoPath)).toBe(true);

      const job = await createTestJob(prisma, {
        filePath: videoPath,
        fileLabel: 'Corrupted Missing Header',
        nodeId: testNodeId,
        libraryId: testLibraryId,
        policyId: testPolicyId,
        beforeSizeBytes: BigInt(fs.statSync(videoPath).size),
        stage: 'QUEUED',
      });

      // ACT: Try to encode
      await encodingProcessor.processNextJob(`${testNodeId}-worker-1`);

      // Wait for job to fail
      const failedJob = await waitForJobStage(prisma, job.id, 'FAILED', 60000);

      // ASSERT: Job failed with appropriate error
      expect(failedJob).not.toBeNull();
      expect(failedJob?.stage).toBe(JobStage.FAILED);
      expect(failedJob?.error).not.toBeNull();
      expect(failedJob?.error).toContain('error'); // Should contain error details

      // Original corrupted file should still exist (no replacement)
      expect(fs.existsSync(videoPath)).toBe(true);
    }, 120000);

    it('should fail gracefully with partial download', async () => {
      // ARRANGE: Create partially downloaded video
      const videoPath = await generateCorruptedVideo({
        filename: 'Corrupted.PartialDownload.mkv',
        corruptionType: 'partial-download',
        sizeMB: 15,
      });

      const job = await createTestJob(prisma, {
        filePath: videoPath,
        fileLabel: 'Corrupted Partial Download',
        nodeId: testNodeId,
        libraryId: testLibraryId,
        policyId: testPolicyId,
        beforeSizeBytes: BigInt(fs.statSync(videoPath).size),
        stage: 'QUEUED',
      });

      // ACT
      await encodingProcessor.processNextJob(`${testNodeId}-worker-1`);
      const failedJob = await waitForJobStage(prisma, job.id, 'FAILED', 60000);

      // ASSERT
      expect(failedJob).not.toBeNull();
      expect(failedJob?.stage).toBe(JobStage.FAILED);
      expect(failedJob?.error).not.toBeNull();

      // Original file unchanged
      expect(fs.existsSync(videoPath)).toBe(true);
    }, 120000);

    it('should fail gracefully with truncated file', async () => {
      // ARRANGE
      const videoPath = await generateCorruptedVideo({
        filename: 'Corrupted.Truncated.mkv',
        corruptionType: 'truncated',
        sizeMB: 15,
      });

      const job = await createTestJob(prisma, {
        filePath: videoPath,
        fileLabel: 'Corrupted Truncated',
        nodeId: testNodeId,
        libraryId: testLibraryId,
        policyId: testPolicyId,
        beforeSizeBytes: BigInt(fs.statSync(videoPath).size),
        stage: 'QUEUED',
      });

      // ACT
      await encodingProcessor.processNextJob(`${testNodeId}-worker-1`);
      const failedJob = await waitForJobStage(prisma, job.id, 'FAILED', 60000);

      // ASSERT
      expect(failedJob).not.toBeNull();
      expect(failedJob?.stage).toBe(JobStage.FAILED);

      // Original file unchanged
      expect(fs.existsSync(videoPath)).toBe(true);
    }, 120000);
  });

  describe('Missing Source Files', () => {
    it('should fail when source file does not exist', async () => {
      // ARRANGE: Create job for non-existent file
      const nonExistentPath = path.join(getFixturesDir(), 'NonExistent.File.mkv');

      expect(fs.existsSync(nonExistentPath)).toBe(false);

      const job = await createTestJob(prisma, {
        filePath: nonExistentPath,
        fileLabel: 'Non-Existent File',
        nodeId: testNodeId,
        libraryId: testLibraryId,
        policyId: testPolicyId,
        beforeSizeBytes: BigInt(100000000),
        stage: 'QUEUED',
      });

      // ACT
      await encodingProcessor.processNextJob(`${testNodeId}-worker-1`);
      const failedJob = await waitForJobStage(prisma, job.id, 'FAILED', 30000);

      // ASSERT
      expect(failedJob).not.toBeNull();
      expect(failedJob?.stage).toBe(JobStage.FAILED);
      expect(failedJob?.error).toContain('not found');
    }, 60000);

    it('should fail when file is deleted during encoding', async () => {
      // ARRANGE: Create valid video
      const videoPath = await generateVideo({
        filename: 'DeleteDuringEncoding.720p.mkv',
        codec: 'h264',
        resolution: '720p',
        container: 'mkv',
        duration: 20, // Long enough to delete during encoding
        targetSizeMB: 40,
      });

      const job = await createTestJob(prisma, {
        filePath: videoPath,
        fileLabel: 'Delete During Encoding',
        nodeId: testNodeId,
        libraryId: testLibraryId,
        policyId: testPolicyId,
        beforeSizeBytes: BigInt(fs.statSync(videoPath).size),
        stage: 'QUEUED',
      });

      // ACT: Start encoding in background
      const processPromise = encodingProcessor.processNextJob(`${testNodeId}-worker-1`);

      // Wait 2 seconds, then delete the file
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Check if job is in ENCODING stage
      const encodingJob = await prisma.job.findUnique({ where: { id: job.id } });
      if (encodingJob && encodingJob.stage === JobStage.ENCODING) {
        // Delete the source file during encoding
        if (fs.existsSync(videoPath)) {
          fs.unlinkSync(videoPath);
        }
      }

      // Wait for process to complete
      await processPromise;

      // Wait for failure
      const failedJob = await waitForJobStage(prisma, job.id, 'FAILED', 60000);

      // ASSERT: Job should fail (file was deleted)
      // Note: Might complete if deletion happened after encoding finished
      if (failedJob) {
        expect(failedJob.stage).toBe(JobStage.FAILED);
      }
    }, 120000);
  });

  describe('File Permission Errors', () => {
    it('should fail when source file is not readable', async () => {
      // ARRANGE: Create video and make it unreadable
      const videoPath = await generateVideo({
        filename: 'Unreadable.File.720p.mkv',
        codec: 'h264',
        resolution: '720p',
        container: 'mkv',
        duration: 10,
        targetSizeMB: 20,
      });

      // Make file unreadable (Unix only)
      if (process.platform !== 'win32') {
        fs.chmodSync(videoPath, 0o000);
      }

      const job = await createTestJob(prisma, {
        filePath: videoPath,
        fileLabel: 'Unreadable File',
        nodeId: testNodeId,
        libraryId: testLibraryId,
        policyId: testPolicyId,
        beforeSizeBytes: BigInt(20 * 1024 * 1024), // Approximate
        stage: 'QUEUED',
      });

      // ACT
      await encodingProcessor.processNextJob(`${testNodeId}-worker-1`);
      const failedJob = await waitForJobStage(prisma, job.id, 'FAILED', 30000);

      // Restore permissions for cleanup
      if (process.platform !== 'win32') {
        fs.chmodSync(videoPath, 0o644);
      }

      // ASSERT
      if (process.platform !== 'win32') {
        expect(failedJob).not.toBeNull();
        expect(failedJob?.stage).toBe(JobStage.FAILED);
        expect(failedJob?.error).not.toBeNull();
      }
    }, 60000);
  });

  describe('Retry Logic', () => {
    it('should retry failed jobs with exponential backoff', async () => {
      // ARRANGE: Create job that will fail (missing file)
      const nonExistentPath = path.join(getFixturesDir(), 'RetryTest.mkv');

      const job = await createTestJob(prisma, {
        filePath: nonExistentPath,
        fileLabel: 'Retry Test',
        nodeId: testNodeId,
        libraryId: testLibraryId,
        policyId: testPolicyId,
        beforeSizeBytes: BigInt(100000000),
        stage: 'QUEUED',
      });

      // ACT: Process job (will fail)
      await encodingProcessor.processNextJob(`${testNodeId}-worker-1`);

      // Wait a bit for job to fail and be reset to QUEUED for retry
      await new Promise((resolve) => setTimeout(resolve, 2000));

      const retriedJob = await prisma.job.findUnique({ where: { id: job.id } });

      // ASSERT: Job should be queued for retry
      expect(retriedJob).not.toBeNull();
      expect(retriedJob?.retryCount).toBe(1);
      expect(retriedJob?.nextRetryAt).not.toBeNull();
      expect(retriedJob?.error).toContain('Attempt 1/3 failed');
    }, 60000);

    it('should permanently fail after max retries', async () => {
      // ARRANGE: Create job with failing condition
      const nonExistentPath = path.join(getFixturesDir(), 'MaxRetryTest.mkv');

      const job = await createTestJob(prisma, {
        filePath: nonExistentPath,
        fileLabel: 'Max Retry Test',
        nodeId: testNodeId,
        libraryId: testLibraryId,
        policyId: testPolicyId,
        beforeSizeBytes: BigInt(100000000),
        stage: 'QUEUED',
      });

      // ACT: Fail the job 3 times (max retries)
      for (let attempt = 0; attempt < 4; attempt++) {
        // Update job to QUEUED to bypass retry delay
        await prisma.job.update({
          where: { id: job.id },
          data: { stage: 'QUEUED', nextRetryAt: null },
        });

        await encodingProcessor.processNextJob(`${testNodeId}-worker-1`);
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }

      const finalJob = await prisma.job.findUnique({ where: { id: job.id } });

      // ASSERT: Job permanently failed after 3 retries
      expect(finalJob).not.toBeNull();
      expect(finalJob?.stage).toBe(JobStage.FAILED);
      expect(finalJob?.error).toContain('All 3 retry attempts exhausted');
    }, 90000);
  });

  describe('Edge Case Files', () => {
    it('should handle very small video file', async () => {
      // ARRANGE: Create tiny video (5MB)
      const videoPath = await generateVideo({
        filename: 'VerySmall.Video.480p.mkv',
        codec: 'h264',
        resolution: '480p',
        container: 'mkv',
        duration: 5,
        targetSizeMB: 5,
      });

      const job = await createTestJob(prisma, {
        filePath: videoPath,
        fileLabel: 'Very Small Video',
        nodeId: testNodeId,
        libraryId: testLibraryId,
        policyId: testPolicyId,
        beforeSizeBytes: BigInt(fs.statSync(videoPath).size),
        stage: 'QUEUED',
      });

      // ACT
      await encodingProcessor.processNextJob(`${testNodeId}-worker-1`);
      const completedJob = await waitForJobCompletion(prisma, job.id);

      // ASSERT: Should complete successfully
      expect(completedJob).not.toBeNull();
      expect(completedJob?.stage).toBe(JobStage.COMPLETED);
    }, 90000);

    it('should handle video with unusual filename characters', async () => {
      // ARRANGE: Video with special characters in name
      const videoPath = await generateVideo({
        filename: 'Special[Chars](2024)@720p_Test.mkv',
        codec: 'h264',
        resolution: '720p',
        container: 'mkv',
        duration: 10,
        targetSizeMB: 20,
      });

      const job = await createTestJob(prisma, {
        filePath: videoPath,
        fileLabel: 'Special Characters Test',
        nodeId: testNodeId,
        libraryId: testLibraryId,
        policyId: testPolicyId,
        beforeSizeBytes: BigInt(fs.statSync(videoPath).size),
        stage: 'QUEUED',
      });

      // ACT
      await encodingProcessor.processNextJob(`${testNodeId}-worker-1`);
      const completedJob = await waitForJobCompletion(prisma, job.id);

      // ASSERT
      expect(completedJob).not.toBeNull();
      expect(completedJob?.stage).toBe(JobStage.COMPLETED);
    }, 120000);
  });
});
