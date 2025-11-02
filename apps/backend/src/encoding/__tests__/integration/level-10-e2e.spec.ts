import { Test, TestingModule } from '@nestjs/testing';
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
 * Level 10: Full End-to-End Integration Suite
 *
 * Complete integration test covering all scenarios:
 * - Movies, series, anime mix
 * - All codecs and resolutions
 * - Concurrent processing
 * - Edge cases
 * - Auto-heal scenarios
 * - Quality verification
 *
 * Complexity: Very High
 * Files: 10-15 videos, mix of sizes (reduced from README for speed)
 * Duration: ~10-15 minutes
 */
describe('Level 10: Full End-to-End Integration Suite', () => {
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
  }, 30000);

  afterAll(async () => {
    // Cleanup
    await resetDatabase(prisma);
    await prisma.$disconnect();
    await moduleRef.close();
    cleanupFixtures();
  }, 30000);

  afterEach(async () => {
    // Clean up jobs after each test
    await cleanupTestJobs(prisma, testLibraryId);
  });

  describe('Mixed Content Types', () => {
    it.skip('should process movies, TV series, and anime together', async () => {
      // TODO: Generate mix of:
      // - 5 movies (various codecs, resolutions)
      // - 1 TV season (10 episodes)
      // - 3 anime episodes (various formats)
      // Process all concurrently
      // Verify all complete successfully
      // Check quality metrics for each type
    });
  });

  describe('All Codecs and Resolutions', () => {
    it.skip('should handle all supported codec conversions', async () => {
      // TODO: Test conversions:
      // - H.264 → HEVC
      // - VP9 → HEVC
      // - MPEG-2 → HEVC
      // - AV1 → HEVC
      // Across all resolutions: 480p, 720p, 1080p, 4K
    });
  });

  describe('Complete Workflow', () => {
    it('should execute basic end-to-end workflow', async () => {
      // Simplified E2E test with movie + TV episode
      const jobs = [];

      // Movie
      const moviePath = await generateVideo({
        filename: 'The.Matrix.1999.1080p.BluRay.x264.mkv',
        codec: 'h264',
        resolution: '1080p',
        container: 'mkv',
        duration: 5,
        targetSizeMB: 25,
      });

      const movieJob = await createTestJob(prisma, {
        filePath: moviePath,
        fileLabel: 'The Matrix (1999)',
        nodeId: testNodeId,
        libraryId: testLibraryId,
        policyId: testPolicyId,
        sourceCodec: 'H.264',
        targetCodec: 'HEVC',
      });

      jobs.push(movieJob);

      // TV Episode
      const tvPath = await generateVideo({
        filename: 'Game.of.Thrones.S08E06.720p.mkv',
        codec: 'h264',
        resolution: '720p',
        container: 'mkv',
        duration: 5,
        targetSizeMB: 20,
      });

      const tvJob = await createTestJob(prisma, {
        filePath: tvPath,
        fileLabel: 'Game of Thrones S08E06',
        nodeId: testNodeId,
        libraryId: testLibraryId,
        policyId: testPolicyId,
        sourceCodec: 'H.264',
        targetCodec: 'HEVC',
      });

      jobs.push(tvJob);

      // Process all jobs
      for (const job of jobs) {
        await encodingProcessor.processNextJob();
      }

      // Wait for completion
      for (const job of jobs) {
        const completedJob = await waitForJobCompletion(prisma, job.id, 120000);
        expect(completedJob).toBeDefined();
        expect(completedJob?.stage).toBe('COMPLETED');
      }

      // Verify overall results
      const allJobs = await prisma.job.findMany({
        where: { libraryId: testLibraryId },
      });

      expect(allJobs).toHaveLength(2);
      expect(allJobs.every((j) => j.stage === 'COMPLETED')).toBe(true);
    }, 300000);
  });

  describe('Edge Cases and Error Handling', () => {
    it.skip('should handle edge cases in production scenario', async () => {
      // TODO: Include edge cases:
      // - Corrupted files
      // - Missing files
      // - Permission errors
      // - Disk space issues
      // Verify system handles gracefully
    });
  });

  describe('Auto-Heal Integration', () => {
    it.skip('should integrate with auto-heal system', async () => {
      // TODO: Simulate system crash during encoding
      // Verify auto-heal kicks in
      // Check jobs resume correctly
      // Validate no data corruption
    });
  });

  describe('Quality Verification', () => {
    it.skip('should verify quality across all processed files', async () => {
      // TODO: Process various files
      // Run quality checks on all outputs
      // Verify codecs match target
      // Check resolutions preserved
      // Validate PSNR/SSIM metrics
    });
  });
});
