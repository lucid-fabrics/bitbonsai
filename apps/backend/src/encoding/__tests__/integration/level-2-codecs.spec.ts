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
import { cleanupFixtures, generateVideo, verifyVideoFile } from '../fixtures/video-generator';

/**
 * Level 2: Multiple Codecs
 *
 * Tests encoding from various source codecs to HEVC:
 * - H.264 → HEVC
 * - VP9 → HEVC
 * - MPEG-2 → HEVC
 * - Verify output codec matches target
 *
 * Complexity: Low-Medium
 * Files: 3-5 videos, 20-50MB each
 * Duration: ~2-3 minutes
 */
describe('Level 2: Multiple Codecs', () => {
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

  describe('Codec Conversion', () => {
    it('should convert H.264 to HEVC', async () => {
      // ARRANGE
      const videoPath = await generateVideo({
        filename: 'H264.to.HEVC.720p.mkv',
        codec: 'h264',
        resolution: '720p',
        container: 'mkv',
        duration: 15,
        targetSizeMB: 30,
      });

      // Verify source codec
      const sourceInfo = await verifyVideoFile(videoPath);
      expect(sourceInfo.isValid).toBe(true);
      expect(sourceInfo.codec).toBe('h264');

      const job = await createTestJob(prisma, {
        filePath: videoPath,
        fileLabel: 'H.264 to HEVC Test',
        nodeId: testNodeId,
        libraryId: testLibraryId,
        policyId: testPolicyId,
        sourceCodec: 'H.264',
        targetCodec: 'HEVC',
        beforeSizeBytes: BigInt(fs.statSync(videoPath).size),
        stage: 'QUEUED',
      });

      // ACT
      await encodingProcessor.processNextJob(`${testNodeId}-worker-1`);
      const completedJob = await waitForJobCompletion(prisma, job.id, 120000);

      // ASSERT
      expect(completedJob).toBeTruthy();
      expect(completedJob?.stage).toBe(JobStage.COMPLETED);

      // Verify output codec is HEVC
      const outputInfo = await verifyVideoFile(videoPath);
      expect(outputInfo.isValid).toBe(true);
      expect(outputInfo.codec).toBe('hevc');

      // Verify resolution preserved
      expect(outputInfo.resolution).toBe(sourceInfo.resolution);
    }, 180000);

    it('should convert VP9 to HEVC', async () => {
      // ARRANGE
      const videoPath = await generateVideo({
        filename: 'VP9.to.HEVC.720p.mkv',
        codec: 'vp9',
        resolution: '720p',
        container: 'mkv',
        duration: 12,
        targetSizeMB: 25,
      });

      const sourceInfo = await verifyVideoFile(videoPath);
      expect(sourceInfo.isValid).toBe(true);
      expect(sourceInfo.codec).toBe('vp9');

      const job = await createTestJob(prisma, {
        filePath: videoPath,
        fileLabel: 'VP9 to HEVC Test',
        nodeId: testNodeId,
        libraryId: testLibraryId,
        policyId: testPolicyId,
        sourceCodec: 'VP9',
        targetCodec: 'HEVC',
        beforeSizeBytes: BigInt(fs.statSync(videoPath).size),
        stage: 'QUEUED',
      });

      // ACT
      await encodingProcessor.processNextJob(`${testNodeId}-worker-1`);
      const completedJob = await waitForJobCompletion(prisma, job.id, 120000);

      // ASSERT
      expect(completedJob).toBeTruthy();
      expect(completedJob?.stage).toBe(JobStage.COMPLETED);

      const outputInfo = await verifyVideoFile(videoPath);
      expect(outputInfo.isValid).toBe(true);
      expect(outputInfo.codec).toBe('hevc');
    }, 180000);

    it('should convert MPEG-2 to HEVC with significant size reduction', async () => {
      // ARRANGE
      const videoPath = await generateVideo({
        filename: 'MPEG2.to.HEVC.720p.mkv',
        codec: 'mpeg2',
        resolution: '720p',
        container: 'mkv',
        duration: 10,
        targetSizeMB: 40, // MPEG-2 is typically larger
      });

      const sourceInfo = await verifyVideoFile(videoPath);
      expect(sourceInfo.isValid).toBe(true);
      expect(sourceInfo.codec).toBe('mpeg2video');

      const job = await createTestJob(prisma, {
        filePath: videoPath,
        fileLabel: 'MPEG-2 to HEVC Test',
        nodeId: testNodeId,
        libraryId: testLibraryId,
        policyId: testPolicyId,
        sourceCodec: 'MPEG-2',
        targetCodec: 'HEVC',
        beforeSizeBytes: BigInt(fs.statSync(videoPath).size),
        stage: 'QUEUED',
      });

      // ACT
      await encodingProcessor.processNextJob(`${testNodeId}-worker-1`);
      const completedJob = await waitForJobCompletion(prisma, job.id, 120000);

      // ASSERT
      expect(completedJob).toBeTruthy();
      expect(completedJob?.stage).toBe(JobStage.COMPLETED);

      // MPEG-2 to HEVC should have significant size reduction (>30%)
      expect(completedJob?.savedPercent).toBeGreaterThan(30);

      const outputInfo = await verifyVideoFile(videoPath);
      expect(outputInfo.isValid).toBe(true);
      expect(outputInfo.codec).toBe('hevc');
    }, 180000);
  });

  describe('Container Formats', () => {
    it('should handle MP4 container', async () => {
      const videoPath = await generateVideo({
        filename: 'Container.Test.MP4.720p.mp4',
        codec: 'h264',
        resolution: '720p',
        container: 'mp4',
        duration: 10,
        targetSizeMB: 20,
      });

      const job = await createTestJob(prisma, {
        filePath: videoPath,
        fileLabel: 'MP4 Container Test',
        nodeId: testNodeId,
        libraryId: testLibraryId,
        policyId: testPolicyId,
        beforeSizeBytes: BigInt(fs.statSync(videoPath).size),
        stage: 'QUEUED',
      });

      await encodingProcessor.processNextJob(`${testNodeId}-worker-1`);
      const completedJob = await waitForJobCompletion(prisma, job.id);

      expect(completedJob).toBeTruthy();
      expect(completedJob?.stage).toBe(JobStage.COMPLETED);
    }, 120000);

    it('should handle MKV container', async () => {
      const videoPath = await generateVideo({
        filename: 'Container.Test.MKV.720p.mkv',
        codec: 'h264',
        resolution: '720p',
        container: 'mkv',
        duration: 10,
        targetSizeMB: 20,
      });

      const job = await createTestJob(prisma, {
        filePath: videoPath,
        fileLabel: 'MKV Container Test',
        nodeId: testNodeId,
        libraryId: testLibraryId,
        policyId: testPolicyId,
        beforeSizeBytes: BigInt(fs.statSync(videoPath).size),
        stage: 'QUEUED',
      });

      await encodingProcessor.processNextJob(`${testNodeId}-worker-1`);
      const completedJob = await waitForJobCompletion(prisma, job.id);

      expect(completedJob).toBeTruthy();
      expect(completedJob?.stage).toBe(JobStage.COMPLETED);
    }, 120000);

    it('should handle AVI container', async () => {
      const videoPath = await generateVideo({
        filename: 'Container.Test.AVI.480p.avi',
        codec: 'h264',
        resolution: '480p',
        container: 'avi',
        duration: 10,
        targetSizeMB: 15,
      });

      const job = await createTestJob(prisma, {
        filePath: videoPath,
        fileLabel: 'AVI Container Test',
        nodeId: testNodeId,
        libraryId: testLibraryId,
        policyId: testPolicyId,
        beforeSizeBytes: BigInt(fs.statSync(videoPath).size),
        stage: 'QUEUED',
      });

      await encodingProcessor.processNextJob(`${testNodeId}-worker-1`);
      const completedJob = await waitForJobCompletion(prisma, job.id);

      expect(completedJob).toBeTruthy();
      expect(completedJob?.stage).toBe(JobStage.COMPLETED);
    }, 120000);
  });

  describe('Resolution Handling', () => {
    it('should preserve 480p resolution', async () => {
      const videoPath = await generateVideo({
        filename: 'Resolution.480p.Test.mkv',
        codec: 'h264',
        resolution: '480p',
        container: 'mkv',
        duration: 10,
        targetSizeMB: 15,
      });

      const sourceInfo = await verifyVideoFile(videoPath);
      expect(sourceInfo.resolution).toBe('854x480');

      const job = await createTestJob(prisma, {
        filePath: videoPath,
        fileLabel: '480p Resolution Test',
        nodeId: testNodeId,
        libraryId: testLibraryId,
        policyId: testPolicyId,
        beforeSizeBytes: BigInt(fs.statSync(videoPath).size),
        stage: 'QUEUED',
      });

      await encodingProcessor.processNextJob(`${testNodeId}-worker-1`);
      await waitForJobCompletion(prisma, job.id);

      const outputInfo = await verifyVideoFile(videoPath);
      expect(outputInfo.resolution).toBe('854x480');
    }, 120000);

    it('should preserve 1080p resolution', async () => {
      const videoPath = await generateVideo({
        filename: 'Resolution.1080p.Test.mkv',
        codec: 'h264',
        resolution: '1080p',
        container: 'mkv',
        duration: 12,
        targetSizeMB: 35,
      });

      const sourceInfo = await verifyVideoFile(videoPath);
      expect(sourceInfo.resolution).toBe('1920x1080');

      const job = await createTestJob(prisma, {
        filePath: videoPath,
        fileLabel: '1080p Resolution Test',
        nodeId: testNodeId,
        libraryId: testLibraryId,
        policyId: testPolicyId,
        beforeSizeBytes: BigInt(fs.statSync(videoPath).size),
        stage: 'QUEUED',
      });

      await encodingProcessor.processNextJob(`${testNodeId}-worker-1`);
      await waitForJobCompletion(prisma, job.id);

      const outputInfo = await verifyVideoFile(videoPath);
      expect(outputInfo.resolution).toBe('1920x1080');
    }, 150000);
  });
});
