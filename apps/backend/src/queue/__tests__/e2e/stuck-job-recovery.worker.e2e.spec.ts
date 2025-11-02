import { Test, TestingModule } from '@nestjs/testing';
import { JobStage } from '@prisma/client';
import { FfmpegService } from '../../../encoding/ffmpeg.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { StuckJobRecoveryWorker } from '../../stuck-job-recovery.worker';

/**
 * STUCK JOB RECOVERY WORKER - E2E TESTS
 *
 * Tests the critical CAPA fix for frozen FFmpeg process recovery.
 * These tests ensure that:
 * 1. Frozen FFmpeg processes are detected and killed
 * 2. Jobs preserve their resume state when recovered
 * 3. Jobs are reset to QUEUED for retry
 * 4. Progress, temp files, and resume data are NOT cleared
 */
describe('StuckJobRecoveryWorker (e2e)', () => {
  let module: TestingModule;
  let worker: StuckJobRecoveryWorker;
  let prismaService: PrismaService;
  let ffmpegService: FfmpegService;

  beforeEach(async () => {
    module = await Test.createTestingModule({
      providers: [
        StuckJobRecoveryWorker,
        {
          provide: PrismaService,
          useValue: {
            job: {
              findMany: jest.fn(),
              update: jest.fn(),
            },
          },
        },
        {
          provide: FfmpegService,
          useValue: {
            hasActiveProcess: jest.fn(),
            killProcess: jest.fn(),
          },
        },
      ],
    }).compile();

    worker = module.get<StuckJobRecoveryWorker>(StuckJobRecoveryWorker);
    prismaService = module.get<PrismaService>(PrismaService);
    ffmpegService = module.get<FfmpegService>(FfmpegService);
  });

  afterEach(async () => {
    await module.close();
  });

  describe('Frozen FFmpeg Process Recovery', () => {
    it('should detect and kill frozen FFmpeg processes', async () => {
      // Arrange: Create a job that's been stuck in ENCODING for >10min
      const stuckJob = {
        id: 'test-job-1',
        fileLabel: 'Test Video.mkv',
        stage: JobStage.ENCODING,
        progress: 25.5,
        tempFilePath: '/tmp/test-video.tmp.mp4',
        resumeTimestamp: '00:05:30.00',
        updatedAt: new Date(Date.now() - 15 * 60 * 1000), // 15 min ago
        lastProgressUpdate: new Date(Date.now() - 15 * 60 * 1000),
      };

      jest.spyOn(prismaService.job, 'findMany').mockResolvedValue([stuckJob]);
      jest.spyOn(ffmpegService, 'hasActiveProcess').mockReturnValue(true);
      jest.spyOn(ffmpegService, 'killProcess').mockResolvedValue(true);
      jest.spyOn(prismaService.job, 'update').mockResolvedValue(stuckJob as any);

      // Act: Run recovery
      await (worker as any).recoverStuckJobs();

      // Assert: FFmpeg process was killed
      expect(ffmpegService.killProcess).toHaveBeenCalledWith('test-job-1');
    });

    it('should preserve resume state when recovering frozen jobs', async () => {
      // Arrange: Job frozen at 30.56% progress
      const frozenJob = {
        id: 'test-job-2',
        fileLabel: '3 Body Problem S01E03.mkv',
        stage: JobStage.ENCODING,
        progress: 30.56,
        tempFilePath: '/tmp/3-body-problem.tmp.mp4',
        resumeTimestamp: '00:12:45.50',
        startedAt: new Date(Date.now() - 60 * 60 * 1000), // Started 1 hour ago
        updatedAt: new Date(Date.now() - 20 * 60 * 1000), // Stuck for 20 min
        lastProgressUpdate: new Date(Date.now() - 20 * 60 * 1000),
      };

      jest.spyOn(prismaService.job, 'findMany').mockResolvedValue([frozenJob]);
      jest.spyOn(ffmpegService, 'hasActiveProcess').mockReturnValue(true);
      jest.spyOn(ffmpegService, 'killProcess').mockResolvedValue(true);
      jest.spyOn(prismaService.job, 'update').mockResolvedValue(frozenJob as any);

      // Act: Run recovery
      await (worker as any).recoverStuckJobs();

      // Assert: Job updated to QUEUED BUT resume state preserved
      expect(prismaService.job.update).toHaveBeenCalledWith({
        where: { id: 'test-job-2' },
        data: expect.objectContaining({
          stage: JobStage.QUEUED,
          error: expect.stringContaining('will resume from 30.56%'),
        }),
      });

      // Critical: Ensure these fields were NOT reset
      const updateCall = (prismaService.job.update as jest.Mock).mock.calls[0][0];
      expect(updateCall.data).not.toHaveProperty('progress');
      expect(updateCall.data).not.toHaveProperty('startedAt');
      expect(updateCall.data).not.toHaveProperty('tempFilePath');
      expect(updateCall.data).not.toHaveProperty('resumeTimestamp');
    });

    it('should skip recovery if FFmpeg process was already killed', async () => {
      // Arrange: Job stuck but no active FFmpeg process
      const stuckJob = {
        id: 'test-job-3',
        fileLabel: 'Test Video.mkv',
        stage: JobStage.ENCODING,
        progress: 10.0,
        updatedAt: new Date(Date.now() - 15 * 60 * 1000),
        lastProgressUpdate: new Date(Date.now() - 15 * 60 * 1000),
      };

      jest.spyOn(prismaService.job, 'findMany').mockResolvedValue([stuckJob]);
      jest.spyOn(ffmpegService, 'hasActiveProcess').mockReturnValue(false);
      jest.spyOn(ffmpegService, 'killProcess').mockResolvedValue(false);
      jest.spyOn(prismaService.job, 'update').mockResolvedValue(stuckJob as any);

      // Act: Run recovery
      await (worker as any).recoverStuckJobs();

      // Assert: No attempt to kill process, job still reset
      expect(ffmpegService.killProcess).not.toHaveBeenCalled();
      expect(prismaService.job.update).toHaveBeenCalledWith({
        where: { id: 'test-job-3' },
        data: expect.objectContaining({
          stage: JobStage.QUEUED,
        }),
      });
    });

    it('should NOT reset job if FFmpeg process kill fails', async () => {
      // Arrange: Job with frozen FFmpeg that can't be killed
      const stubbornJob = {
        id: 'test-job-4',
        fileLabel: 'Stubborn Video.mkv',
        stage: JobStage.ENCODING,
        progress: 15.0,
        updatedAt: new Date(Date.now() - 15 * 60 * 1000),
        lastProgressUpdate: new Date(Date.now() - 15 * 60 * 1000),
      };

      jest.spyOn(prismaService.job, 'findMany').mockResolvedValue([stubbornJob]);
      jest.spyOn(ffmpegService, 'hasActiveProcess').mockReturnValue(true);
      jest.spyOn(ffmpegService, 'killProcess').mockResolvedValue(false); // Kill fails
      jest.spyOn(prismaService.job, 'update').mockResolvedValue(stubbornJob as any);

      // Act: Run recovery
      await (worker as any).recoverStuckJobs();

      // Assert: Job NOT reset if kill failed
      expect(ffmpegService.killProcess).toHaveBeenCalledWith('test-job-4');
      expect(prismaService.job.update).not.toHaveBeenCalled();
    });
  });

  describe('Health Check Recovery', () => {
    it('should reset jobs stuck in HEALTH_CHECK', async () => {
      // Arrange: Job stuck in health check for >5 min
      const stuckHealthCheck = {
        id: 'test-job-5',
        fileLabel: 'Health Check Stuck.mkv',
        stage: JobStage.HEALTH_CHECK,
        updatedAt: new Date(Date.now() - 10 * 60 * 1000), // 10 min ago
        healthCheckRetries: 2,
      };

      jest.spyOn(prismaService.job, 'findMany').mockResolvedValue([stuckHealthCheck]);
      jest.spyOn(prismaService.job, 'update').mockResolvedValue(stuckHealthCheck as any);

      // Act: Run recovery
      await (worker as any).recoverStuckJobs();

      // Assert: Job reset to DETECTED with retry count incremented
      expect(prismaService.job.update).toHaveBeenCalledWith({
        where: { id: 'test-job-5' },
        data: {
          stage: JobStage.DETECTED,
          healthCheckRetries: { increment: 1 },
        },
      });
    });
  });

  describe('Verifying Recovery', () => {
    it('should reset jobs stuck in VERIFYING', async () => {
      // Arrange: Job stuck in verification for >30 min
      const stuckVerifying = {
        id: 'test-job-6',
        fileLabel: 'Verifying Stuck.mkv',
        stage: JobStage.VERIFYING,
        updatedAt: new Date(Date.now() - 45 * 60 * 1000), // 45 min ago
      };

      jest.spyOn(prismaService.job, 'findMany').mockResolvedValue([stuckVerifying]);
      jest.spyOn(prismaService.job, 'update').mockResolvedValue(stuckVerifying as any);

      // Act: Run recovery
      await (worker as any).recoverStuckJobs();

      // Assert: Job reset to QUEUED with error message
      expect(prismaService.job.update).toHaveBeenCalledWith({
        where: { id: 'test-job-6' },
        data: {
          stage: JobStage.QUEUED,
          progress: 0,
          startedAt: null,
          error: expect.stringContaining('Verification timed out'),
        },
      });
    });
  });

  describe('Progress Detection', () => {
    it('should use lastProgressUpdate instead of updatedAt for stuck detection', async () => {
      // Arrange: Job with recent updatedAt but old lastProgressUpdate
      const recentlyUpdatedButStuck = {
        id: 'test-job-7',
        fileLabel: 'Recently Updated But Stuck.mkv',
        stage: JobStage.ENCODING,
        progress: 5.0,
        updatedAt: new Date(Date.now() - 2 * 60 * 1000), // Updated 2 min ago
        lastProgressUpdate: new Date(Date.now() - 15 * 60 * 1000), // No progress for 15 min
      };

      jest.spyOn(prismaService.job, 'findMany').mockResolvedValue([recentlyUpdatedButStuck]);
      jest.spyOn(ffmpegService, 'hasActiveProcess').mockReturnValue(true);
      jest.spyOn(ffmpegService, 'killProcess').mockResolvedValue(true);
      jest.spyOn(prismaService.job, 'update').mockResolvedValue(recentlyUpdatedButStuck as any);

      // Act: Run recovery
      await (worker as any).recoverStuckJobs();

      // Assert: Job was recovered based on lastProgressUpdate, not updatedAt
      expect(ffmpegService.killProcess).toHaveBeenCalledWith('test-job-7');
    });
  });

  describe('Multiple Stuck Jobs', () => {
    it('should recover all stuck jobs in a single run', async () => {
      // Arrange: Multiple jobs stuck at different stages
      const stuckJobs = [
        {
          id: 'job-1',
          fileLabel: 'Video 1.mkv',
          stage: JobStage.ENCODING,
          progress: 20.0,
          updatedAt: new Date(Date.now() - 15 * 60 * 1000),
          lastProgressUpdate: new Date(Date.now() - 15 * 60 * 1000),
        },
        {
          id: 'job-2',
          fileLabel: 'Video 2.mkv',
          stage: JobStage.ENCODING,
          progress: 40.0,
          updatedAt: new Date(Date.now() - 20 * 60 * 1000),
          lastProgressUpdate: new Date(Date.now() - 20 * 60 * 1000),
        },
        {
          id: 'job-3',
          fileLabel: 'Video 3.mkv',
          stage: JobStage.ENCODING,
          progress: 60.0,
          updatedAt: new Date(Date.now() - 25 * 60 * 1000),
          lastProgressUpdate: new Date(Date.now() - 25 * 60 * 1000),
        },
      ];

      jest.spyOn(prismaService.job, 'findMany').mockResolvedValue(stuckJobs);
      jest.spyOn(ffmpegService, 'hasActiveProcess').mockReturnValue(true);
      jest.spyOn(ffmpegService, 'killProcess').mockResolvedValue(true);
      jest.spyOn(prismaService.job, 'update').mockResolvedValue({} as any);

      // Act: Run recovery
      await (worker as any).recoverStuckJobs();

      // Assert: All jobs recovered
      expect(ffmpegService.killProcess).toHaveBeenCalledTimes(3);
      expect(prismaService.job.update).toHaveBeenCalledTimes(3);
    });

    it('should handle mixed scenarios - some with active processes, some without', async () => {
      // Arrange: Jobs with different FFmpeg process states
      const mixedJobs = [
        {
          id: 'job-with-process',
          fileLabel: 'Frozen Process.mkv',
          stage: JobStage.ENCODING,
          progress: 25.0,
          updatedAt: new Date(Date.now() - 15 * 60 * 1000),
          lastProgressUpdate: new Date(Date.now() - 15 * 60 * 1000),
        },
        {
          id: 'job-without-process',
          fileLabel: 'Already Killed.mkv',
          stage: JobStage.ENCODING,
          progress: 35.0,
          updatedAt: new Date(Date.now() - 20 * 60 * 1000),
          lastProgressUpdate: new Date(Date.now() - 20 * 60 * 1000),
        },
      ];

      jest.spyOn(prismaService.job, 'findMany').mockResolvedValue(mixedJobs);
      jest
        .spyOn(ffmpegService, 'hasActiveProcess')
        .mockImplementation((jobId) => jobId === 'job-with-process');
      jest.spyOn(ffmpegService, 'killProcess').mockResolvedValue(true);
      jest.spyOn(prismaService.job, 'update').mockResolvedValue({} as any);

      // Act: Run recovery
      await (worker as any).recoverStuckJobs();

      // Assert: Only job with active process gets killed
      expect(ffmpegService.killProcess).toHaveBeenCalledTimes(1);
      expect(ffmpegService.killProcess).toHaveBeenCalledWith('job-with-process');

      // Both jobs get updated
      expect(prismaService.job.update).toHaveBeenCalledTimes(2);
    });
  });

  describe('Edge Cases - Progress Levels', () => {
    it('should handle job frozen at 0% progress', async () => {
      // Arrange: Job that froze immediately after starting
      const zeroProgressJob = {
        id: 'test-job-8',
        fileLabel: 'Instant Freeze.mkv',
        stage: JobStage.ENCODING,
        progress: 0.0,
        tempFilePath: '/tmp/instant-freeze.tmp.mp4',
        resumeTimestamp: '00:00:00.00',
        updatedAt: new Date(Date.now() - 15 * 60 * 1000),
        lastProgressUpdate: new Date(Date.now() - 15 * 60 * 1000),
      };

      jest.spyOn(prismaService.job, 'findMany').mockResolvedValue([zeroProgressJob]);
      jest.spyOn(ffmpegService, 'hasActiveProcess').mockReturnValue(true);
      jest.spyOn(ffmpegService, 'killProcess').mockResolvedValue(true);
      jest.spyOn(prismaService.job, 'update').mockResolvedValue(zeroProgressJob as any);

      // Act: Run recovery
      await (worker as any).recoverStuckJobs();

      // Assert: Should still preserve resume state even at 0%
      expect(prismaService.job.update).toHaveBeenCalledWith({
        where: { id: 'test-job-8' },
        data: expect.objectContaining({
          stage: JobStage.QUEUED,
          error: expect.stringContaining('will resume from 0%'),
        }),
      });

      const updateCall = (prismaService.job.update as jest.Mock).mock.calls[0][0];
      expect(updateCall.data).not.toHaveProperty('progress');
      expect(updateCall.data).not.toHaveProperty('tempFilePath');
    });

    it('should handle job frozen near completion (99%)', async () => {
      // Arrange: Job that froze near the end
      const nearCompleteJob = {
        id: 'test-job-9',
        fileLabel: 'Almost Done.mkv',
        stage: JobStage.ENCODING,
        progress: 99.23,
        tempFilePath: '/tmp/almost-done.tmp.mp4',
        resumeTimestamp: '01:45:30.50',
        updatedAt: new Date(Date.now() - 15 * 60 * 1000),
        lastProgressUpdate: new Date(Date.now() - 15 * 60 * 1000),
      };

      jest.spyOn(prismaService.job, 'findMany').mockResolvedValue([nearCompleteJob]);
      jest.spyOn(ffmpegService, 'hasActiveProcess').mockReturnValue(true);
      jest.spyOn(ffmpegService, 'killProcess').mockResolvedValue(true);
      jest.spyOn(prismaService.job, 'update').mockResolvedValue(nearCompleteJob as any);

      // Act: Run recovery
      await (worker as any).recoverStuckJobs();

      // Assert: Should preserve resume state to finish the last 0.77%
      expect(prismaService.job.update).toHaveBeenCalledWith({
        where: { id: 'test-job-9' },
        data: expect.objectContaining({
          stage: JobStage.QUEUED,
          error: expect.stringContaining('will resume from 99.23%'),
        }),
      });

      const updateCall = (prismaService.job.update as jest.Mock).mock.calls[0][0];
      expect(updateCall.data).not.toHaveProperty('progress');
      expect(updateCall.data).not.toHaveProperty('tempFilePath');
    });
  });

  describe('Edge Cases - Null Fields', () => {
    it('should handle job with null lastProgressUpdate (fallback to updatedAt)', async () => {
      // Arrange: Job with null lastProgressUpdate (rare but possible)
      const nullProgressUpdateJob = {
        id: 'test-job-10',
        fileLabel: 'Null Progress Update.mkv',
        stage: JobStage.ENCODING,
        progress: 10.0,
        updatedAt: new Date(Date.now() - 15 * 60 * 1000),
        lastProgressUpdate: null,
      };

      jest.spyOn(prismaService.job, 'findMany').mockResolvedValue([nullProgressUpdateJob]);
      jest.spyOn(ffmpegService, 'hasActiveProcess').mockReturnValue(false);
      jest.spyOn(prismaService.job, 'update').mockResolvedValue(nullProgressUpdateJob as any);

      // Act: Run recovery
      await (worker as any).recoverStuckJobs();

      // Assert: Job should still be recovered using updatedAt
      expect(prismaService.job.update).toHaveBeenCalledWith({
        where: { id: 'test-job-10' },
        data: expect.objectContaining({
          stage: JobStage.QUEUED,
        }),
      });
    });

    it('should handle job with missing resume data fields', async () => {
      // Arrange: Job frozen but missing tempFilePath/resumeTimestamp (edge case)
      const missingResumeDataJob = {
        id: 'test-job-11',
        fileLabel: 'Missing Resume Data.mkv',
        stage: JobStage.ENCODING,
        progress: 15.0,
        tempFilePath: null,
        resumeTimestamp: null,
        updatedAt: new Date(Date.now() - 15 * 60 * 1000),
        lastProgressUpdate: new Date(Date.now() - 15 * 60 * 1000),
      };

      jest.spyOn(prismaService.job, 'findMany').mockResolvedValue([missingResumeDataJob]);
      jest.spyOn(ffmpegService, 'hasActiveProcess').mockReturnValue(true);
      jest.spyOn(ffmpegService, 'killProcess').mockResolvedValue(true);
      jest.spyOn(prismaService.job, 'update').mockResolvedValue(missingResumeDataJob as any);

      // Act: Run recovery
      await (worker as any).recoverStuckJobs();

      // Assert: Should still attempt recovery (even though resume won't work)
      expect(ffmpegService.killProcess).toHaveBeenCalledWith('test-job-11');
      expect(prismaService.job.update).toHaveBeenCalledWith({
        where: { id: 'test-job-11' },
        data: expect.objectContaining({
          stage: JobStage.QUEUED,
          error: expect.stringContaining('will resume from 15%'),
        }),
      });
    });
  });

  describe('Edge Cases - Previously Auto-Healed Jobs', () => {
    it('should handle jobs that were previously auto-healed', async () => {
      // Arrange: Job that was auto-healed before but froze again
      const previouslyHealedJob = {
        id: 'test-job-12',
        fileLabel: 'Previously Healed.mkv',
        stage: JobStage.ENCODING,
        progress: 45.0,
        tempFilePath: '/tmp/previously-healed.tmp.mp4',
        resumeTimestamp: '00:30:15.00',
        autoHealedAt: new Date(Date.now() - 2 * 60 * 60 * 1000), // Healed 2 hours ago
        autoHealedProgress: 30.0, // Was healed at 30%, now at 45%
        updatedAt: new Date(Date.now() - 15 * 60 * 1000),
        lastProgressUpdate: new Date(Date.now() - 15 * 60 * 1000),
      };

      jest.spyOn(prismaService.job, 'findMany').mockResolvedValue([previouslyHealedJob]);
      jest.spyOn(ffmpegService, 'hasActiveProcess').mockReturnValue(true);
      jest.spyOn(ffmpegService, 'killProcess').mockResolvedValue(true);
      jest.spyOn(prismaService.job, 'update').mockResolvedValue(previouslyHealedJob as any);

      // Act: Run recovery
      await (worker as any).recoverStuckJobs();

      // Assert: Should recover again (autoHealedAt doesn't prevent re-recovery)
      expect(ffmpegService.killProcess).toHaveBeenCalledWith('test-job-12');
      expect(prismaService.job.update).toHaveBeenCalledWith({
        where: { id: 'test-job-12' },
        data: expect.objectContaining({
          stage: JobStage.QUEUED,
          error: expect.stringContaining('will resume from 45%'),
        }),
      });
    });
  });

  describe('Stage-Specific Timeout Verification', () => {
    it('should use correct timeout thresholds for each stage', async () => {
      // This test verifies the timeout configuration is correct
      // HEALTH_CHECK: 5 min, ENCODING: 10 min, VERIFYING: 30 min

      // Arrange: Jobs stuck for exactly the timeout threshold
      const healthCheckJob = {
        id: 'health-check-job',
        fileLabel: 'Health Check 5min.mkv',
        stage: JobStage.HEALTH_CHECK,
        updatedAt: new Date(Date.now() - 5 * 60 * 1000), // Exactly 5 min
      };

      const encodingJob = {
        id: 'encoding-job',
        fileLabel: 'Encoding 10min.mkv',
        stage: JobStage.ENCODING,
        progress: 10.0,
        lastProgressUpdate: new Date(Date.now() - 10 * 60 * 1000), // Exactly 10 min
      };

      const verifyingJob = {
        id: 'verifying-job',
        fileLabel: 'Verifying 30min.mkv',
        stage: JobStage.VERIFYING,
        updatedAt: new Date(Date.now() - 30 * 60 * 1000), // Exactly 30 min
      };

      // Test HEALTH_CHECK timeout
      jest.spyOn(prismaService.job, 'findMany').mockResolvedValueOnce([healthCheckJob]);
      jest.spyOn(prismaService.job, 'update').mockResolvedValue({} as any);

      await (worker as any).recoverStuckJobs();

      expect(prismaService.job.update).toHaveBeenCalledWith({
        where: { id: 'health-check-job' },
        data: {
          stage: JobStage.DETECTED,
          healthCheckRetries: { increment: 1 },
        },
      });

      // Test ENCODING timeout
      jest.clearAllMocks();
      jest.spyOn(prismaService.job, 'findMany').mockResolvedValueOnce([encodingJob]);
      jest.spyOn(ffmpegService, 'hasActiveProcess').mockReturnValue(false);
      jest.spyOn(prismaService.job, 'update').mockResolvedValue({} as any);

      await (worker as any).recoverStuckJobs();

      expect(prismaService.job.update).toHaveBeenCalledWith({
        where: { id: 'encoding-job' },
        data: expect.objectContaining({
          stage: JobStage.QUEUED,
        }),
      });

      // Test VERIFYING timeout
      jest.clearAllMocks();
      jest.spyOn(prismaService.job, 'findMany').mockResolvedValueOnce([verifyingJob]);
      jest.spyOn(prismaService.job, 'update').mockResolvedValue({} as any);

      await (worker as any).recoverStuckJobs();

      expect(prismaService.job.update).toHaveBeenCalledWith({
        where: { id: 'verifying-job' },
        data: {
          stage: JobStage.QUEUED,
          progress: 0,
          startedAt: null,
          error: expect.stringContaining('Verification timed out'),
        },
      });
    });
  });
});
