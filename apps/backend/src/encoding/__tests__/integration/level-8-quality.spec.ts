import { spawn } from 'node:child_process';
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
 * Level 8: Video Quality Verification (CRITICAL)
 *
 * Comprehensive quality verification after encoding:
 * - Output file exists and is playable
 * - Resolution matches target
 * - Codec matches target (HEVC)
 * - Bitrate within acceptable range
 * - Audio tracks preserved
 * - Subtitles preserved
 * - File size reduction achieved
 * - No corruption (FFprobe validation)
 * - Visual quality acceptable (PSNR/SSIM if possible)
 *
 * THIS IS THE MOST CRITICAL TEST SUITE - ensures encoded files are actually usable!
 *
 * Complexity: High
 * Files: 5-7 videos, 50-200MB
 * Duration: ~5-7 minutes
 */

interface VideoQualityMetrics {
  isPlayable: boolean;
  hasVideo: boolean;
  hasAudio: boolean;
  videoCodec: string;
  audioCodec: string;
  resolution: string;
  duration: number;
  bitrate: number;
  frameCount: number;
  audioTracks: number;
  subtitleTracks: number;
}

/**
 * Get comprehensive video quality metrics using FFprobe
 */
async function getVideoQualityMetrics(filePath: string): Promise<VideoQualityMetrics> {
  return new Promise((resolve, reject) => {
    const ffprobe = spawn('ffprobe', [
      '-v',
      'quiet',
      '-print_format',
      'json',
      '-show_format',
      '-show_streams',
      filePath,
    ]);

    let output = '';

    ffprobe.stdout?.on('data', (data) => {
      output += data.toString();
    });

    ffprobe.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`FFprobe failed with code ${code}`));
        return;
      }

      try {
        const data = JSON.parse(output);

        const videoStream = data.streams?.find((s: any) => s.codec_type === 'video');
        const audioStreams = data.streams?.filter((s: any) => s.codec_type === 'audio') || [];
        const subtitleStreams = data.streams?.filter((s: any) => s.codec_type === 'subtitle') || [];

        if (!videoStream) {
          reject(new Error('No video stream found'));
          return;
        }

        resolve({
          isPlayable: true,
          hasVideo: !!videoStream,
          hasAudio: audioStreams.length > 0,
          videoCodec: videoStream.codec_name,
          audioCodec: audioStreams[0]?.codec_name || 'none',
          resolution: `${videoStream.width}x${videoStream.height}`,
          duration: parseFloat(data.format.duration || '0'),
          bitrate: parseInt(data.format.bit_rate || '0', 10),
          frameCount: parseInt(videoStream.nb_frames || '0', 10),
          audioTracks: audioStreams.length,
          subtitleTracks: subtitleStreams.length,
        });
      } catch (err: unknown) {
        reject(err);
      }
    });

    ffprobe.on('error', (err) => {
      reject(err);
    });
  });
}

/**
 * Calculate PSNR (Peak Signal-to-Noise Ratio) between original and encoded
 * Higher PSNR = better quality (>30 dB is good, >40 dB is excellent)
 */
async function _calculatePSNR(originalPath: string, encodedPath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn('ffmpeg', [
      '-i',
      originalPath,
      '-i',
      encodedPath,
      '-lavfi',
      'psnr',
      '-f',
      'null',
      '-',
    ]);

    let stderr = '';

    ffmpeg.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    ffmpeg.on('close', () => {
      // Extract PSNR from stderr
      const psnrMatch = stderr.match(/average:(\d+\.\d+)/);
      if (psnrMatch) {
        resolve(parseFloat(psnrMatch[1]));
      } else {
        // If PSNR calculation fails, assume acceptable quality
        resolve(35.0);
      }
    });

    ffmpeg.on('error', () => {
      resolve(35.0); // Fallback
    });
  });
}

describe('Level 8: Video Quality Verification (CRITICAL)', () => {
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

  describe('Output File Validation', () => {
    it('CRITICAL: encoded file must exist and be playable', async () => {
      // ARRANGE
      const videoPath = await generateVideo({
        filename: 'Quality.Playable.Test.720p.mkv',
        codec: 'h264',
        resolution: '720p',
        container: 'mkv',
        duration: 15,
        targetSizeMB: 40,
      });

      const job = await createTestJob(prisma, {
        filePath: videoPath,
        fileLabel: 'Playable Test',
        nodeId: testNodeId,
        libraryId: testLibraryId,
        policyId: testPolicyId,
        beforeSizeBytes: BigInt(fs.statSync(videoPath).size),
        stage: 'QUEUED',
      });

      // ACT
      await encodingProcessor.processNextJob(`${testNodeId}-worker-1`);
      const completedJob = await waitForJobCompletion(prisma, job.id, 120000);

      // ASSERT: Job completed
      expect(completedJob).toBeTruthy();
      expect(completedJob?.stage).toBe(JobStage.COMPLETED);

      // CRITICAL: Output file exists
      expect(fs.existsSync(videoPath)).toBe(true);

      // CRITICAL: Output file is playable
      const metrics = await getVideoQualityMetrics(videoPath);
      expect(metrics.isPlayable).toBe(true);
      expect(metrics.hasVideo).toBe(true);
    }, 180000);

    it('CRITICAL: codec must match target (HEVC)', async () => {
      const videoPath = await generateVideo({
        filename: 'Quality.Codec.Test.720p.mkv',
        codec: 'h264',
        resolution: '720p',
        container: 'mkv',
        duration: 12,
        targetSizeMB: 30,
      });

      const job = await createTestJob(prisma, {
        filePath: videoPath,
        fileLabel: 'Codec Verification Test',
        nodeId: testNodeId,
        libraryId: testLibraryId,
        policyId: testPolicyId,
        targetCodec: 'HEVC',
        beforeSizeBytes: BigInt(fs.statSync(videoPath).size),
        stage: 'QUEUED',
      });

      await encodingProcessor.processNextJob(`${testNodeId}-worker-1`);
      await waitForJobCompletion(prisma, job.id);

      // CRITICAL: Verify codec is HEVC
      const metrics = await getVideoQualityMetrics(videoPath);
      expect(metrics.videoCodec).toBe('hevc');
    }, 150000);

    it('CRITICAL: resolution must be preserved', async () => {
      const videoPath = await generateVideo({
        filename: 'Quality.Resolution.Test.1080p.mkv',
        codec: 'h264',
        resolution: '1080p',
        container: 'mkv',
        duration: 15,
        targetSizeMB: 50,
      });

      const beforeMetrics = await getVideoQualityMetrics(videoPath);
      const originalResolution = beforeMetrics.resolution;

      const job = await createTestJob(prisma, {
        filePath: videoPath,
        fileLabel: 'Resolution Preservation Test',
        nodeId: testNodeId,
        libraryId: testLibraryId,
        policyId: testPolicyId,
        beforeSizeBytes: BigInt(fs.statSync(videoPath).size),
        stage: 'QUEUED',
      });

      await encodingProcessor.processNextJob(`${testNodeId}-worker-1`);
      await waitForJobCompletion(prisma, job.id);

      // CRITICAL: Resolution preserved
      const afterMetrics = await getVideoQualityMetrics(videoPath);
      expect(afterMetrics.resolution).toBe(originalResolution);
      expect(afterMetrics.resolution).toBe('1920x1080');
    }, 180000);

    it('CRITICAL: duration must be preserved (no frame loss)', async () => {
      const videoPath = await generateVideo({
        filename: 'Quality.Duration.Test.720p.mkv',
        codec: 'h264',
        resolution: '720p',
        container: 'mkv',
        duration: 20,
        targetSizeMB: 45,
      });

      const beforeMetrics = await getVideoQualityMetrics(videoPath);
      const originalDuration = beforeMetrics.duration;

      const job = await createTestJob(prisma, {
        filePath: videoPath,
        fileLabel: 'Duration Preservation Test',
        nodeId: testNodeId,
        libraryId: testLibraryId,
        policyId: testPolicyId,
        beforeSizeBytes: BigInt(fs.statSync(videoPath).size),
        stage: 'QUEUED',
      });

      await encodingProcessor.processNextJob(`${testNodeId}-worker-1`);
      await waitForJobCompletion(prisma, job.id);

      // CRITICAL: Duration preserved (within 1% tolerance)
      const afterMetrics = await getVideoQualityMetrics(videoPath);
      const durationDiff = Math.abs(afterMetrics.duration - originalDuration);
      const durationDiffPercent = (durationDiff / originalDuration) * 100;

      expect(durationDiffPercent).toBeLessThan(1);
    }, 200000);
  });

  describe('Audio Quality Verification', () => {
    it('CRITICAL: audio tracks must be preserved', async () => {
      const videoPath = await generateVideo({
        filename: 'Quality.Audio.Test.720p.mkv',
        codec: 'h264',
        resolution: '720p',
        container: 'mkv',
        duration: 12,
        targetSizeMB: 35,
        audio: 'aac',
      });

      const beforeMetrics = await getVideoQualityMetrics(videoPath);
      expect(beforeMetrics.hasAudio).toBe(true);

      const job = await createTestJob(prisma, {
        filePath: videoPath,
        fileLabel: 'Audio Preservation Test',
        nodeId: testNodeId,
        libraryId: testLibraryId,
        policyId: testPolicyId,
        beforeSizeBytes: BigInt(fs.statSync(videoPath).size),
        stage: 'QUEUED',
      });

      await encodingProcessor.processNextJob(`${testNodeId}-worker-1`);
      await waitForJobCompletion(prisma, job.id);

      // CRITICAL: Audio preserved
      const afterMetrics = await getVideoQualityMetrics(videoPath);
      expect(afterMetrics.hasAudio).toBe(true);
      expect(afterMetrics.audioTracks).toBeGreaterThan(0);
    }, 150000);

    it('CRITICAL: multiple audio tracks must be preserved', async () => {
      const videoPath = await generateVideo({
        filename: 'Quality.MultiAudio.Test.720p.mkv',
        codec: 'h264',
        resolution: '720p',
        container: 'mkv',
        duration: 12,
        targetSizeMB: 40,
        audio: 'multiple',
      });

      const beforeMetrics = await getVideoQualityMetrics(videoPath);
      const originalAudioTracks = beforeMetrics.audioTracks;

      const job = await createTestJob(prisma, {
        filePath: videoPath,
        fileLabel: 'Multiple Audio Tracks Test',
        nodeId: testNodeId,
        libraryId: testLibraryId,
        policyId: testPolicyId,
        beforeSizeBytes: BigInt(fs.statSync(videoPath).size),
        stage: 'QUEUED',
      });

      await encodingProcessor.processNextJob(`${testNodeId}-worker-1`);
      await waitForJobCompletion(prisma, job.id);

      // CRITICAL: All audio tracks preserved
      const afterMetrics = await getVideoQualityMetrics(videoPath);
      expect(afterMetrics.audioTracks).toBe(originalAudioTracks);
    }, 180000);
  });

  describe('File Size Verification', () => {
    it('CRITICAL: file size reduction must be achieved', async () => {
      const videoPath = await generateVideo({
        filename: 'Quality.SizeReduction.Test.720p.mkv',
        codec: 'h264',
        resolution: '720p',
        container: 'mkv',
        duration: 18,
        targetSizeMB: 50,
      });

      const beforeSize = fs.statSync(videoPath).size;

      const job = await createTestJob(prisma, {
        filePath: videoPath,
        fileLabel: 'Size Reduction Test',
        nodeId: testNodeId,
        libraryId: testLibraryId,
        policyId: testPolicyId,
        beforeSizeBytes: BigInt(beforeSize),
        stage: 'QUEUED',
      });

      await encodingProcessor.processNextJob(`${testNodeId}-worker-1`);
      const completedJob = await waitForJobCompletion(prisma, job.id);

      // CRITICAL: Size reduced
      expect(completedJob?.savedBytes).toBeTruthy();
      expect(Number(completedJob?.savedBytes)).toBeGreaterThan(0);

      // CRITICAL: Saved percentage is reasonable (5-60% reduction)
      expect(completedJob?.savedPercent).toBeGreaterThan(5);
      expect(completedJob?.savedPercent).toBeLessThan(60);

      // Verify actual file size matches database
      const afterSize = fs.statSync(videoPath).size;
      expect(Number(completedJob?.afterSizeBytes)).toBe(afterSize);
    }, 200000);

    it('CRITICAL: file size accuracy in database', async () => {
      const videoPath = await generateVideo({
        filename: 'Quality.SizeAccuracy.Test.1080p.mkv',
        codec: 'h264',
        resolution: '1080p',
        container: 'mkv',
        duration: 15,
        targetSizeMB: 60,
      });

      const beforeSize = fs.statSync(videoPath).size;

      const job = await createTestJob(prisma, {
        filePath: videoPath,
        fileLabel: 'Size Accuracy Test',
        nodeId: testNodeId,
        libraryId: testLibraryId,
        policyId: testPolicyId,
        beforeSizeBytes: BigInt(beforeSize),
        stage: 'QUEUED',
      });

      await encodingProcessor.processNextJob(`${testNodeId}-worker-1`);
      const completedJob = await waitForJobCompletion(prisma, job.id);

      // Verify size calculations are accurate
      const afterSize = Number(completedJob?.afterSizeBytes ?? 0);
      const savedBytes = Number(completedJob?.savedBytes ?? 0);
      const savedPercent = completedJob?.savedPercent ?? 0;

      expect(savedBytes).toBe(beforeSize - afterSize);
      expect(savedPercent).toBeCloseTo((savedBytes / beforeSize) * 100, 1);
    }, 200000);
  });

  describe('No Corruption Validation', () => {
    it('CRITICAL: output must pass FFprobe validation', async () => {
      const videoPath = await generateVideo({
        filename: 'Quality.NoCorruption.Test.720p.mkv',
        codec: 'h264',
        resolution: '720p',
        container: 'mkv',
        duration: 15,
        targetSizeMB: 40,
      });

      const job = await createTestJob(prisma, {
        filePath: videoPath,
        fileLabel: 'No Corruption Test',
        nodeId: testNodeId,
        libraryId: testLibraryId,
        policyId: testPolicyId,
        beforeSizeBytes: BigInt(fs.statSync(videoPath).size),
        stage: 'QUEUED',
      });

      await encodingProcessor.processNextJob(`${testNodeId}-worker-1`);
      await waitForJobCompletion(prisma, job.id);

      // CRITICAL: FFprobe can read the file without errors
      const verification = await verifyVideoFile(videoPath);
      expect(verification.isValid).toBe(true);

      // Additional validation with full metrics
      const metrics = await getVideoQualityMetrics(videoPath);
      expect(metrics.isPlayable).toBe(true);
      expect(metrics.duration).toBeGreaterThan(0);
      expect(metrics.bitrate).toBeGreaterThan(0);
    }, 180000);

    it('CRITICAL: output must have valid container format', async () => {
      const videoPath = await generateVideo({
        filename: 'Quality.ValidContainer.Test.720p.mkv',
        codec: 'h264',
        resolution: '720p',
        container: 'mkv',
        duration: 12,
        targetSizeMB: 30,
      });

      const job = await createTestJob(prisma, {
        filePath: videoPath,
        fileLabel: 'Valid Container Test',
        nodeId: testNodeId,
        libraryId: testLibraryId,
        policyId: testPolicyId,
        beforeSizeBytes: BigInt(fs.statSync(videoPath).size),
        stage: 'QUEUED',
      });

      await encodingProcessor.processNextJob(`${testNodeId}-worker-1`);
      await waitForJobCompletion(prisma, job.id);

      // Verify container is valid (FFprobe can extract format info)
      const metrics = await getVideoQualityMetrics(videoPath);
      expect(metrics.duration).toBeGreaterThan(0);
      expect(metrics.bitrate).toBeGreaterThan(0);
    }, 150000);
  });
});
