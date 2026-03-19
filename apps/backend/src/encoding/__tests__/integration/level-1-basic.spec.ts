import * as fs from 'node:fs';
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
} from '../fixtures/test-helpers';
import { cleanupFixtures, generateVideo, REALISTIC_FILENAMES } from '../fixtures/video-generator';

/**
 * Level 1: Basic Integration Tests
 *
 * Tests basic single job flow with simple video files:
 * - Single H.264 video encoding to HEVC
 * - Job lifecycle: QUEUED → ENCODING → COMPLETED
 * - File replacement verification
 * - Size reduction verification
 *
 * Complexity: Low
 * Files: 1 video, 10-50MB
 * Duration: ~30 seconds
 */
describe('Level 1: Basic Single Job Flow', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let _queueService: QueueService;
  let encodingProcessor: EncodingProcessorService;
  let _ffmpegService: FfmpegService;

  let testNodeId: string;
  let testLibraryId: string;
  let testPolicyId: string;

  beforeAll(async () => {
    // Create test module with in-memory database
    moduleRef = await createTestModule();

    prisma = moduleRef.get<PrismaService>(PrismaService);
    _queueService = moduleRef.get<QueueService>(QueueService);
    encodingProcessor = moduleRef.get<EncodingProcessorService>(EncodingProcessorService);
    _ffmpegService = moduleRef.get<FfmpegService>(FfmpegService);

    // Initialize in-memory database
    await prisma.$connect();

    // Seed test database
    const { node, library, policy } = await seedTestDatabase(prisma);
    testNodeId = node.id;
    testLibraryId = library.id;
    testPolicyId = policy.id;
  });

  afterAll(async () => {
    // Cleanup
    await resetDatabase(prisma);
    await prisma.$disconnect();
    await moduleRef.close();
    cleanupFixtures();
  });

  afterEach(async () => {
    // Clean up jobs after each test
    await cleanupTestJobs(prisma, testLibraryId);
  });

  describe('Basic Job Lifecycle', () => {
    it('should encode a simple H.264 video to HEVC', async () => {
      // ARRANGE: Generate test video
      const videoPath = await generateVideo({
        filename: 'Test.Movie.2024.720p.BluRay.x264.mkv',
        codec: 'h264',
        resolution: '720p',
        container: 'mkv',
        duration: 10,
        targetSizeMB: 20,
      });

      expect(fs.existsSync(videoPath)).toBe(true);

      const beforeStats = fs.statSync(videoPath);
      const beforeSize = beforeStats.size;

      // Create job in database
      const job = await createTestJob(prisma, {
        filePath: videoPath,
        fileLabel: 'Test Movie (2024)',
        nodeId: testNodeId,
        libraryId: testLibraryId,
        policyId: testPolicyId,
        sourceCodec: 'H.264',
        targetCodec: 'HEVC',
        beforeSizeBytes: BigInt(beforeSize),
        stage: 'QUEUED',
      });

      // ACT: Process the job
      const _processedJob = await encodingProcessor.processNextJob(`${testNodeId}-worker-1`);

      // Wait for job to complete (with timeout)
      const completedJob = await waitForJobCompletion(prisma, job.id, 60000);

      // ASSERT: Job completed successfully
      expect(completedJob).not.toBeNull();
      expect(completedJob?.stage).toBe(JobStage.COMPLETED);
      expect(completedJob?.progress).toBe(100);
      expect(completedJob?.error).toBeNull();

      // Verify file still exists (atomic replacement)
      expect(fs.existsSync(videoPath)).toBe(true);

      // Verify file size changed
      const afterStats = fs.statSync(videoPath);
      const afterSize = afterStats.size;

      expect(completedJob?.afterSizeBytes).not.toBeNull();
      expect(Number(completedJob?.afterSizeBytes)).toBe(afterSize);

      // Verify size reduction (HEVC should be smaller than H.264)
      expect(completedJob?.savedBytes).not.toBeNull();
      expect(Number(completedJob?.savedBytes)).toBeGreaterThan(0);

      // Verify saved percentage is reasonable (10-50% reduction)
      expect(completedJob?.savedPercent).toBeGreaterThan(10);
      expect(completedJob?.savedPercent).toBeLessThan(50);

      // Verify timestamps
      expect(completedJob?.startedAt).not.toBeNull();
      expect(completedJob?.completedAt).not.toBeNull();
      expect(completedJob?.completedAt?.getTime()).toBeGreaterThan(
        completedJob?.startedAt?.getTime() ?? 0
      );
    }, 120000); // 2 minute timeout

    it('should handle job with realistic movie filename', async () => {
      // ARRANGE: Generate test video with realistic filename
      const videoPath = await generateVideo({
        filename: REALISTIC_FILENAMES.movies[0],
        codec: 'h264',
        resolution: '1080p',
        container: 'mkv',
        duration: 15,
        targetSizeMB: 30,
      });

      const beforeStats = fs.statSync(videoPath);

      const job = await createTestJob(prisma, {
        filePath: videoPath,
        fileLabel: 'The Matrix (1999)',
        nodeId: testNodeId,
        libraryId: testLibraryId,
        policyId: testPolicyId,
        beforeSizeBytes: BigInt(beforeStats.size),
        stage: 'QUEUED',
      });

      // ACT: Process the job
      await encodingProcessor.processNextJob(`${testNodeId}-worker-1`);

      // Wait for completion
      const completedJob = await waitForJobCompletion(prisma, job.id, 90000);

      // ASSERT
      expect(completedJob).not.toBeNull();
      expect(completedJob?.stage).toBe(JobStage.COMPLETED);
      expect(completedJob?.fileLabel).toBe('The Matrix (1999)');
    }, 150000);

    it('should track progress during encoding', async () => {
      // ARRANGE
      const videoPath = await generateVideo({
        filename: 'Progress.Test.720p.mkv',
        codec: 'h264',
        resolution: '720p',
        container: 'mkv',
        duration: 20,
        targetSizeMB: 40,
      });

      const job = await createTestJob(prisma, {
        filePath: videoPath,
        fileLabel: 'Progress Test',
        nodeId: testNodeId,
        libraryId: testLibraryId,
        policyId: testPolicyId,
        beforeSizeBytes: BigInt(fs.statSync(videoPath).size),
        stage: 'QUEUED',
      });

      // ACT: Start encoding
      const processPromise = encodingProcessor.processNextJob(`${testNodeId}-worker-1`);

      // Track progress updates
      const progressUpdates: number[] = [];

      // Poll job status every second for progress updates
      const pollInterval = setInterval(async () => {
        const currentJob = await prisma.job.findUnique({ where: { id: job.id } });
        if (currentJob && currentJob.progress > 0) {
          progressUpdates.push(currentJob.progress);
        }
      }, 1000);

      // Wait for completion
      await processPromise;
      clearInterval(pollInterval);

      const completedJob = await prisma.job.findUnique({ where: { id: job.id } });

      // ASSERT: Progress was tracked
      expect(progressUpdates.length).toBeGreaterThan(0);
      expect(completedJob?.progress).toBe(100);

      // Progress should increase monotonically (or stay same)
      for (let i = 1; i < progressUpdates.length; i++) {
        expect(progressUpdates[i]).toBeGreaterThanOrEqual(progressUpdates[i - 1]);
      }
    }, 180000);
  });

  describe('File Operations', () => {
    it('should atomically replace original file', async () => {
      // ARRANGE
      const videoPath = await generateVideo({
        filename: 'Atomic.Replace.Test.mkv',
        codec: 'h264',
        resolution: '480p',
        container: 'mkv',
        duration: 10,
        targetSizeMB: 15,
      });

      const _beforeInode = fs.statSync(videoPath).ino;

      const job = await createTestJob(prisma, {
        filePath: videoPath,
        fileLabel: 'Atomic Replace Test',
        nodeId: testNodeId,
        libraryId: testLibraryId,
        policyId: testPolicyId,
        beforeSizeBytes: BigInt(fs.statSync(videoPath).size),
        stage: 'QUEUED',
      });

      // ACT
      await encodingProcessor.processNextJob(`${testNodeId}-worker-1`);
      await waitForJobCompletion(prisma, job.id);

      // ASSERT: File still exists at same path
      expect(fs.existsSync(videoPath)).toBe(true);

      // Inode may change (atomic replacement)
      const afterInode = fs.statSync(videoPath).ino;
      // Note: Can't reliably test inode change across platforms
      expect(afterInode).toBeGreaterThan(0);

      // Verify no temp files left behind
      const dir = fs.readdirSync(videoPath.substring(0, videoPath.lastIndexOf('/')));
      const tempFiles = dir.filter((f) => f.includes('.tmp'));
      expect(tempFiles.length).toBe(0);
    }, 120000);

    it('should not leave backup files after successful encoding', async () => {
      // ARRANGE
      const videoPath = await generateVideo({
        filename: 'Backup.Cleanup.Test.mkv',
        codec: 'h264',
        resolution: '480p',
        container: 'mkv',
        duration: 10,
        targetSizeMB: 15,
      });

      const job = await createTestJob(prisma, {
        filePath: videoPath,
        fileLabel: 'Backup Cleanup Test',
        nodeId: testNodeId,
        libraryId: testLibraryId,
        policyId: testPolicyId,
        beforeSizeBytes: BigInt(fs.statSync(videoPath).size),
        stage: 'QUEUED',
      });

      // ACT
      await encodingProcessor.processNextJob(`${testNodeId}-worker-1`);
      await waitForJobCompletion(prisma, job.id);

      // ASSERT: No backup files
      const backupPath = `${videoPath}.backup`;
      expect(fs.existsSync(backupPath)).toBe(false);
    }, 120000);
  });
});
