import * as fs from 'node:fs';
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
 * Level 7: TV Series Processing Tests
 *
 * Tests batch processing of TV series episodes:
 * - Multiple episodes processed sequentially/concurrently
 * - Season-wide encoding
 * - Episode naming conventions
 * - Progress tracking across episodes
 *
 * Complexity: Medium-High
 * Files: 5-10 episodes, 30-50MB each (reduced from README for speed)
 * Duration: ~3-5 minutes
 */
describe('Level 7: TV Series Processing', () => {
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

  describe('Episode Processing', () => {
    it('should process multiple TV episodes sequentially', async () => {
      // Generate 3 test episodes
      const episodes = [
        { num: 1, filename: 'Breaking.Bad.S01E01.720p.mkv' },
        { num: 2, filename: 'Breaking.Bad.S01E02.720p.mkv' },
        { num: 3, filename: 'Breaking.Bad.S01E03.720p.mkv' },
      ];

      const jobPromises: any[] = [];

      for (const episode of episodes) {
        const videoPath = await generateVideo({
          filename: episode.filename,
          codec: 'h264',
          resolution: '720p',
          container: 'mkv',
          duration: 5,
          targetSizeMB: 15,
        });

        expect(fs.existsSync(videoPath)).toBe(true);

        // Create job for episode
        const job = await createTestJob(prisma, {
          filePath: videoPath,
          fileLabel: `Breaking Bad S01E${episode.num.toString().padStart(2, '0')}`,
          nodeId: testNodeId,
          libraryId: testLibraryId,
          policyId: testPolicyId,
          sourceCodec: 'H.264',
          targetCodec: 'HEVC',
        });

        jobPromises.push(job);
      }

      // Process all episodes sequentially
      for (const job of jobPromises) {
        await encodingProcessor.processNextJob('test-worker-1');
        const completedJob = await waitForJobCompletion(prisma, job.id, 60000);

        expect(completedJob).not.toBeNull();
        expect(completedJob?.stage).toBe('COMPLETED');
      }

      // Verify all jobs completed
      const allJobs = await prisma.job.findMany({
        where: { libraryId: testLibraryId },
      });

      expect(allJobs).toHaveLength(3);
      expect(allJobs.every((j) => j.stage === 'COMPLETED')).toBe(true);
    }, 180000);
  });

  // Future: Season-wide encoding (requires 10+ video fixtures)
  // Future: Episode naming convention preservation
  // Future: Multi-episode progress tracking
});
