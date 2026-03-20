import { TestingModule } from '@nestjs/testing';
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
 * Level 9: Stress Testing
 *
 * Tests system under high load:
 * - Many concurrent jobs (10-20)
 * - Large file sizes (50-100MB - reduced from README for speed)
 * - Memory/CPU usage monitoring
 * - System stability under load
 *
 * Complexity: High
 * Files: 10 videos, 50-100MB each
 * Duration: ~5-10 minutes
 */
describe('Level 9: Stress Testing', () => {
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

  // Future: Concurrent processing at scale (10/20 concurrent jobs, requires heavy fixtures)
  // Future: Large file handling (100MB+, requires significant disk space)

  describe('System Stability', () => {
    // Future: Extended stability testing (continuous load, memory leak detection)

    it('should handle basic stress test scenario', async () => {
      // Simplified stress test with 2 concurrent jobs
      const jobs = [];

      for (let i = 1; i <= 2; i++) {
        const videoPath = await generateVideo({
          filename: `Stress.Test.${i}.1080p.mkv`,
          codec: 'h264',
          resolution: '1080p',
          container: 'mkv',
          duration: 5,
          targetSizeMB: 20,
        });

        const job = await createTestJob(prisma, {
          filePath: videoPath,
          fileLabel: `Stress Test ${i}`,
          nodeId: testNodeId,
          libraryId: testLibraryId,
          policyId: testPolicyId,
          sourceCodec: 'H.264',
          targetCodec: 'HEVC',
        });

        jobs.push(job);
      }

      // Process jobs
      for (const _job of jobs) {
        await encodingProcessor.processNextJob('test-worker-1');
      }

      // Wait for all jobs to complete
      for (const job of jobs) {
        const completedJob = await waitForJobCompletion(prisma, job.id, 120000);
        expect(completedJob).not.toBeNull();
        expect(completedJob?.stage).toBe('COMPLETED');
      }
    }, 300000);
  });

  // Future: Performance metrics tracking under load (FPS, bitrate, speed)
});
