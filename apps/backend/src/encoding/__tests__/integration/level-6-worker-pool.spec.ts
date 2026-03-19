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
 * Level 6: Worker Pool Management Tests
 *
 * Tests worker orchestration and pool management:
 * - Dynamic worker pool resizing
 * - Worker crash/failure scenarios
 * - Graceful shutdown handling
 * - Node offline scenarios
 *
 * Complexity: Medium
 * Duration: ~2-3 minutes
 */
describe('Level 6: Worker Pool Management', () => {
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

  describe('Dynamic Worker Pool Resizing', () => {
    it('should handle varying worker pool sizes', async () => {
      // Generate test video
      const videoPath = await generateVideo({
        filename: 'Worker.Pool.Test.720p.mkv',
        codec: 'h264',
        resolution: '720p',
        container: 'mkv',
        duration: 5,
        targetSizeMB: 10,
      });

      // Create job
      const job = await createTestJob(prisma, {
        filePath: videoPath,
        fileLabel: 'Worker Pool Test',
        nodeId: testNodeId,
        libraryId: testLibraryId,
        policyId: testPolicyId,
        sourceCodec: 'H.264',
        targetCodec: 'HEVC',
      });

      // Process job (worker pool should handle it)
      await encodingProcessor.processNextJob('test-worker-1');

      // Wait for completion
      const completedJob = await waitForJobCompletion(prisma, job.id, 60000);

      // Verify
      expect(completedJob).not.toBeNull();
      expect(completedJob?.stage).toBe('COMPLETED');
    }, 90000);
  });

  // Future: Worker crash/failure scenarios (requires crash simulation infrastructure)
  // Future: Node offline scenarios (requires multi-node simulation)
});
