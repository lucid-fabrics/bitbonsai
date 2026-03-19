import { HttpService } from '@nestjs/axios';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { JobStage } from '@prisma/client';
import { of } from 'rxjs';

// Mock fs so existsSync calls don't hit the real filesystem
jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  existsSync: jest.fn().mockReturnValue(true),
  createReadStream: jest.fn().mockReturnValue({
    on: jest.fn().mockReturnThis(),
    pipe: jest.fn(),
  }),
}));

import { JwtAuthGuard } from '../../../auth/guards/jwt-auth.guard';
import { NodeConfigService } from '../../../core/services/node-config.service';
import { EncodingPreviewService } from '../../../encoding/encoding-preview.service';
import { FfmpegService } from '../../../encoding/ffmpeg.service';
import { QueueController } from '../../queue.controller';
import { QueueService } from '../../queue.service';
import { FileTransferService } from '../../services/file-transfer.service';
import { JobHistoryService } from '../../services/job-history.service';

describe('QueueController', () => {
  let controller: QueueController;

  const mockQueueService = {
    create: jest.fn(),
    findAll: jest.fn(),
    getJobStats: jest.fn(),
    getNextJob: jest.fn(),
    updateProgress: jest.fn(),
    findOne: jest.fn(),
    getJobHistory: jest.fn(),
    update: jest.fn(),
    completeJob: jest.fn(),
    failJob: jest.fn(),
    cancelJob: jest.fn(),
    unblacklistJob: jest.fn(),
    pauseJob: jest.fn(),
    resumeJob: jest.fn(),
    retryJob: jest.fn(),
    recheckHealth: jest.fn(),
    forceStartJob: jest.fn(),
    updateJobPriority: jest.fn(),
    requestKeepOriginal: jest.fn(),
    deleteOriginalBackup: jest.fn(),
    restoreOriginal: jest.fn(),
    recheckFailedJob: jest.fn(),
    resolveDecision: jest.fn(),
    detectAndRequeueIfUncompressed: jest.fn(),
    cancelAllQueued: jest.fn(),
    retryAllCancelled: jest.fn(),
    retryAllFailed: jest.fn(),
    skipAllCodecMatch: jest.fn(),
    forceEncodeAllCodecMatch: jest.fn(),
    remove: jest.fn(),
    clearJobs: jest.fn(),
    delegateJob: jest.fn(),
    rebalanceJobs: jest.fn(),
    fixStuckTransfers: jest.fn(),
    updateJobPreview: jest.fn(),
  };

  const mockJobHistoryService = {
    getJobHistory: jest.fn(),
  };

  const mockFileTransferService = {
    getTransferProgress: jest.fn(),
    cancelTransfer: jest.fn(),
  };

  const mockNodeConfig = {
    getMainApiUrl: jest.fn(),
    getNodeId: jest.fn(),
    isMainNode: jest.fn(),
  };

  const mockHttpService = {
    get: jest.fn(),
  };

  const mockPreviewService = {
    captureManualPreview: jest.fn(),
  };

  const mockFfmpegService = {};

  beforeEach(async () => {
    jest.clearAllMocks();

    // Default: act as MAIN node (no proxy)
    mockNodeConfig.getMainApiUrl.mockReturnValue(null);
    mockNodeConfig.isMainNode.mockReturnValue(true);
    mockNodeConfig.getNodeId.mockReturnValue('main-node');

    const module: TestingModule = await Test.createTestingModule({
      controllers: [QueueController],
      providers: [
        { provide: QueueService, useValue: mockQueueService },
        { provide: JobHistoryService, useValue: mockJobHistoryService },
        { provide: FileTransferService, useValue: mockFileTransferService },
        { provide: NodeConfigService, useValue: mockNodeConfig },
        { provide: HttpService, useValue: mockHttpService },
        { provide: EncodingPreviewService, useValue: mockPreviewService },
        { provide: FfmpegService, useValue: mockFfmpegService },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<QueueController>(QueueController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('create', () => {
    it('should create a job and return it', async () => {
      const dto = { filePath: '/mnt/a.mkv', nodeId: 'node1', libraryId: 'lib1', policyId: 'pol1' };
      const created = { id: 'job1', stage: JobStage.QUEUED, ...dto };
      mockQueueService.create.mockResolvedValue(created);

      const result = await controller.create(dto as any);

      expect(mockQueueService.create).toHaveBeenCalledWith(dto);
      expect(result).toEqual(created);
    });

    it('should propagate service errors', async () => {
      mockQueueService.create.mockRejectedValue(new Error('node not found'));
      await expect(controller.create({} as any)).rejects.toThrow('node not found');
    });
  });

  describe('findAll', () => {
    it('should return paginated jobs from service on MAIN node', async () => {
      const paginatedResult = { jobs: [], total: 0, page: 1, limit: 20, totalPages: 0 };
      mockQueueService.findAll.mockResolvedValue(paginatedResult);

      const result = await controller.findAll(JobStage.QUEUED, 'node1', 'movie', 'lib1', 1, 20);

      expect(mockQueueService.findAll).toHaveBeenCalledWith(
        JobStage.QUEUED,
        'node1',
        'movie',
        'lib1',
        1,
        20
      );
      expect(result).toEqual(paginatedResult);
    });

    it('should proxy to MAIN node when running as LINKED node', async () => {
      mockNodeConfig.getMainApiUrl.mockReturnValue('http://main:3000');
      const paginatedResult = { jobs: [], total: 5, page: 1, limit: 20, totalPages: 1 };
      mockHttpService.get.mockReturnValue(of({ data: paginatedResult }));

      const result = await controller.findAll(
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined
      );

      expect(mockHttpService.get).toHaveBeenCalled();
      expect(result).toEqual(paginatedResult);
    });

    it('should throw when LINKED node proxy fails', async () => {
      mockNodeConfig.getMainApiUrl.mockReturnValue('http://main:3000');
      mockHttpService.get.mockReturnValue({
        pipe: jest.fn().mockReturnThis(),
        subscribe: jest.fn((_, errCb) => errCb(new Error('connection refused'))),
      });
      // Simulate firstValueFrom throwing
      mockHttpService.get.mockImplementation(() => {
        throw new Error('connection refused');
      });

      await expect(controller.findAll()).rejects.toThrow();
    });

    it('should propagate service errors on MAIN node', async () => {
      mockQueueService.findAll.mockRejectedValue(new Error('db error'));
      await expect(controller.findAll()).rejects.toThrow('db error');
    });
  });

  describe('getStats', () => {
    it('should return job statistics', async () => {
      const stats = { completed: 100, failed: 5, encoding: 2, queued: 15 };
      mockQueueService.getJobStats.mockResolvedValue(stats);

      const result = await controller.getStats('node1');

      expect(mockQueueService.getJobStats).toHaveBeenCalledWith('node1');
      expect(result).toEqual(stats);
    });

    it('should return global stats when no nodeId provided', async () => {
      const stats = { completed: 200, failed: 10 };
      mockQueueService.getJobStats.mockResolvedValue(stats);

      await controller.getStats(undefined);

      expect(mockQueueService.getJobStats).toHaveBeenCalledWith(undefined);
    });

    it('should propagate service errors', async () => {
      mockQueueService.getJobStats.mockRejectedValue(new Error('stats error'));
      await expect(controller.getStats()).rejects.toThrow('stats error');
    });
  });

  describe('getNextJob', () => {
    it('should return the next available job for a node', async () => {
      const job = { id: 'job1', stage: JobStage.ENCODING, nodeId: 'node1' };
      mockQueueService.getNextJob.mockResolvedValue(job);

      const result = await controller.getNextJob('node1');

      expect(mockQueueService.getNextJob).toHaveBeenCalledWith('node1');
      expect(result).toEqual(job);
    });

    it('should return null when no jobs are available', async () => {
      mockQueueService.getNextJob.mockResolvedValue(null);

      const result = await controller.getNextJob('node1');

      expect(result).toBeNull();
    });

    it('should propagate service errors', async () => {
      mockQueueService.getNextJob.mockRejectedValue(new Error('node not found'));
      await expect(controller.getNextJob('missing')).rejects.toThrow('node not found');
    });
  });

  describe('getNextJobByQuery', () => {
    it('should return next job using query param', async () => {
      const job = { id: 'job2', stage: JobStage.ENCODING };
      mockQueueService.getNextJob.mockResolvedValue(job);

      const result = await controller.getNextJobByQuery('node1');

      expect(mockQueueService.getNextJob).toHaveBeenCalledWith('node1');
      expect(result).toEqual(job);
    });
  });

  describe('updateJobProgress', () => {
    it('should update progress and return updated job', async () => {
      const body = { progress: 45.5, etaSeconds: 3600 };
      const updated = { id: 'job1', progress: 45.5 };
      mockQueueService.updateProgress.mockResolvedValue(updated);

      const result = await controller.updateJobProgress('job1', body);

      expect(mockQueueService.updateProgress).toHaveBeenCalledWith('job1', body);
      expect(result).toEqual(updated);
    });

    it('should propagate service errors', async () => {
      mockQueueService.updateProgress.mockRejectedValue(new Error('job not found'));
      await expect(
        controller.updateJobProgress('missing', { progress: 0, etaSeconds: 0 })
      ).rejects.toThrow('job not found');
    });
  });

  describe('updateJobStage', () => {
    it('should update job stage and return updated job', async () => {
      const body = { stage: JobStage.VERIFYING };
      const updated = { id: 'job1', stage: JobStage.VERIFYING };
      mockQueueService.updateProgress.mockResolvedValue(updated);

      const result = await controller.updateJobStage('job1', body as any);

      expect(mockQueueService.updateProgress).toHaveBeenCalledWith('job1', body);
      expect(result).toEqual(updated);
    });
  });

  describe('findOne', () => {
    it('should return a job by id', async () => {
      const job = { id: 'job1', stage: JobStage.QUEUED };
      mockQueueService.findOne.mockResolvedValue(job);

      const result = await controller.findOne('job1');

      expect(mockQueueService.findOne).toHaveBeenCalledWith('job1');
      expect(result).toEqual(job);
    });

    it('should propagate not found errors', async () => {
      mockQueueService.findOne.mockRejectedValue(new Error('not found'));
      await expect(controller.findOne('missing')).rejects.toThrow('not found');
    });
  });

  describe('getJobHistory', () => {
    it('should return job history timeline', async () => {
      const job = { id: 'job1' };
      const history = [{ eventType: 'FAILED', progress: 45, systemMessage: 'Attempt #1 failed' }];
      mockQueueService.findOne.mockResolvedValue(job);
      mockJobHistoryService.getJobHistory.mockResolvedValue(history);

      const result = await controller.getJobHistory('job1');

      expect(mockQueueService.findOne).toHaveBeenCalledWith('job1');
      expect(mockJobHistoryService.getJobHistory).toHaveBeenCalledWith('job1');
      expect(result).toEqual(history);
    });

    it('should propagate job not found errors', async () => {
      mockQueueService.findOne.mockRejectedValue(new Error('not found'));
      await expect(controller.getJobHistory('missing')).rejects.toThrow('not found');
    });
  });

  describe('update', () => {
    it('should update job when current node is MAIN', async () => {
      const job = { id: 'job1', nodeId: 'some-node' };
      const updateDto = { progress: 60 };
      const updated = { id: 'job1', progress: 60 };
      mockQueueService.findOne.mockResolvedValue(job);
      mockQueueService.update.mockResolvedValue(updated);

      const result = await controller.update('job1', updateDto as any);

      expect(result).toEqual(updated);
    });

    it('should update job when node owns the job', async () => {
      mockNodeConfig.isMainNode.mockReturnValue(false);
      mockNodeConfig.getNodeId.mockReturnValue('worker1');
      const job = { id: 'job1', nodeId: 'worker1' };
      mockQueueService.findOne.mockResolvedValue(job);
      mockQueueService.update.mockResolvedValue(job);

      const result = await controller.update('job1', {} as any);

      expect(result).toEqual(job);
    });

    it('should throw ForbiddenException when LINKED node tries to update another node job', async () => {
      mockNodeConfig.isMainNode.mockReturnValue(false);
      mockNodeConfig.getNodeId.mockReturnValue('worker2');
      const job = { id: 'job1', nodeId: 'worker1' };
      mockQueueService.findOne.mockResolvedValue(job);

      await expect(controller.update('job1', {} as any)).rejects.toThrow(ForbiddenException);
    });

    it('should propagate job not found errors', async () => {
      mockQueueService.findOne.mockRejectedValue(new Error('not found'));
      await expect(controller.update('missing', {} as any)).rejects.toThrow('not found');
    });
  });

  describe('complete', () => {
    it('should complete a job with final metrics', async () => {
      const dto = { outputSizeBytes: 500000, savedBytes: 250000 };
      const completed = { id: 'job1', stage: JobStage.COMPLETED };
      mockQueueService.completeJob.mockResolvedValue(completed);

      const result = await controller.complete('job1', dto as any);

      expect(mockQueueService.completeJob).toHaveBeenCalledWith('job1', dto);
      expect(result).toEqual(completed);
    });

    it('should propagate service errors', async () => {
      mockQueueService.completeJob.mockRejectedValue(new Error('invalid state'));
      await expect(controller.complete('job1', {} as any)).rejects.toThrow('invalid state');
    });
  });

  describe('fail', () => {
    it('should mark a job as failed', async () => {
      const dto = { error: 'FFmpeg exit code 1' };
      const failed = { id: 'job1', stage: JobStage.FAILED };
      mockQueueService.failJob.mockResolvedValue(failed);

      const result = await controller.fail('job1', dto as any);

      expect(mockQueueService.failJob).toHaveBeenCalledWith('job1', dto.error);
      expect(result).toEqual(failed);
    });

    it('should propagate service errors', async () => {
      mockQueueService.failJob.mockRejectedValue(new Error('job not found'));
      await expect(controller.fail('missing', { error: 'err' } as any)).rejects.toThrow(
        'job not found'
      );
    });
  });

  describe('cancel', () => {
    it('should cancel a job without blacklist by default', async () => {
      const dto = { blacklist: false };
      const cancelled = { id: 'job1', stage: JobStage.CANCELLED };
      mockQueueService.cancelJob.mockResolvedValue(cancelled);

      const result = await controller.cancel('job1', dto as any);

      expect(mockQueueService.cancelJob).toHaveBeenCalledWith('job1', false);
      expect(result).toEqual(cancelled);
    });

    it('should cancel and blacklist when requested', async () => {
      const dto = { blacklist: true };
      const cancelled = { id: 'job1', stage: JobStage.CANCELLED, isBlacklisted: true };
      mockQueueService.cancelJob.mockResolvedValue(cancelled);

      await controller.cancel('job1', dto as any);

      expect(mockQueueService.cancelJob).toHaveBeenCalledWith('job1', true);
    });

    it('should propagate service errors', async () => {
      mockQueueService.cancelJob.mockRejectedValue(new Error('already completed'));
      await expect(controller.cancel('job1', {} as any)).rejects.toThrow('already completed');
    });
  });

  describe('unblacklist', () => {
    it('should unblacklist a job', async () => {
      const job = { id: 'job1', isBlacklisted: false };
      mockQueueService.unblacklistJob.mockResolvedValue(job);

      const result = await controller.unblacklist('job1');

      expect(mockQueueService.unblacklistJob).toHaveBeenCalledWith('job1');
      expect(result).toEqual(job);
    });

    it('should propagate errors for non-blacklisted jobs', async () => {
      mockQueueService.unblacklistJob.mockRejectedValue(new Error('not blacklisted'));
      await expect(controller.unblacklist('job1')).rejects.toThrow('not blacklisted');
    });
  });

  describe('pause', () => {
    it('should pause an encoding job', async () => {
      const paused = { id: 'job1', stage: JobStage.PAUSED };
      mockQueueService.pauseJob.mockResolvedValue(paused);

      const result = await controller.pause('job1');

      expect(mockQueueService.pauseJob).toHaveBeenCalledWith('job1');
      expect(result).toEqual(paused);
    });

    it('should propagate errors for non-encoding jobs', async () => {
      mockQueueService.pauseJob.mockRejectedValue(new Error('not encoding'));
      await expect(controller.pause('job1')).rejects.toThrow('not encoding');
    });
  });

  describe('resume', () => {
    it('should resume a paused job', async () => {
      const resumed = { id: 'job1', stage: JobStage.ENCODING };
      mockQueueService.resumeJob.mockResolvedValue(resumed);

      const result = await controller.resume('job1');

      expect(mockQueueService.resumeJob).toHaveBeenCalledWith('job1');
      expect(result).toEqual(resumed);
    });

    it('should propagate errors for non-paused jobs', async () => {
      mockQueueService.resumeJob.mockRejectedValue(new Error('not paused'));
      await expect(controller.resume('job1')).rejects.toThrow('not paused');
    });
  });

  describe('retry', () => {
    it('should retry a failed or cancelled job', async () => {
      const queued = { id: 'job1', stage: JobStage.QUEUED };
      mockQueueService.retryJob.mockResolvedValue(queued);

      const result = await controller.retry('job1');

      expect(mockQueueService.retryJob).toHaveBeenCalledWith('job1');
      expect(result).toEqual(queued);
    });

    it('should propagate errors for jobs in invalid stage', async () => {
      mockQueueService.retryJob.mockRejectedValue(new Error('cannot retry'));
      await expect(controller.retry('job1')).rejects.toThrow('cannot retry');
    });
  });

  describe('recheckHealth', () => {
    it('should recheck health and reset job to DETECTED', async () => {
      const rechecked = { id: 'job1', stage: JobStage.DETECTED };
      mockQueueService.recheckHealth.mockResolvedValue(rechecked);

      const result = await controller.recheckHealth('job1');

      expect(mockQueueService.recheckHealth).toHaveBeenCalledWith('job1');
      expect(result).toEqual(rechecked);
    });

    it('should propagate service errors', async () => {
      mockQueueService.recheckHealth.mockRejectedValue(new Error('not found'));
      await expect(controller.recheckHealth('missing')).rejects.toThrow('not found');
    });
  });

  describe('forceStart', () => {
    it('should force start a queued job', async () => {
      const started = { id: 'job1', stage: JobStage.DETECTED };
      mockQueueService.forceStartJob.mockResolvedValue(started);

      const result = await controller.forceStart('job1');

      expect(mockQueueService.forceStartJob).toHaveBeenCalledWith('job1');
      expect(result).toEqual(started);
    });

    it('should propagate errors for jobs in wrong stage', async () => {
      mockQueueService.forceStartJob.mockRejectedValue(new Error('wrong stage'));
      await expect(controller.forceStart('job1')).rejects.toThrow('wrong stage');
    });
  });

  describe('updatePriority', () => {
    it('should update job priority', async () => {
      const dto = { priority: 1 };
      const updated = { id: 'job1', priority: 1 };
      mockQueueService.updateJobPriority.mockResolvedValue(updated);

      const result = await controller.updatePriority('job1', dto as any);

      expect(mockQueueService.updateJobPriority).toHaveBeenCalledWith('job1', 1);
      expect(result).toEqual(updated);
    });

    it('should propagate errors for invalid priority', async () => {
      mockQueueService.updateJobPriority.mockRejectedValue(new Error('max top priority exceeded'));
      await expect(controller.updatePriority('job1', { priority: 2 } as any)).rejects.toThrow(
        'max top priority exceeded'
      );
    });
  });

  describe('keepOriginal', () => {
    it('should mark job to keep original file', async () => {
      const updated = { id: 'job1', keepOriginalRequested: true };
      mockQueueService.requestKeepOriginal.mockResolvedValue(updated);

      const result = await controller.keepOriginal('job1');

      expect(mockQueueService.requestKeepOriginal).toHaveBeenCalledWith('job1');
      expect(result).toEqual(updated);
    });

    it('should propagate errors for non-encoding jobs', async () => {
      mockQueueService.requestKeepOriginal.mockRejectedValue(new Error('not encoding'));
      await expect(controller.keepOriginal('job1')).rejects.toThrow('not encoding');
    });
  });

  describe('deleteOriginal', () => {
    it('should delete original backup and return freed space', async () => {
      const deleteResult = { freedSpace: BigInt(524288000) };
      mockQueueService.deleteOriginalBackup.mockResolvedValue(deleteResult);

      const result = await controller.deleteOriginal('job1');

      expect(mockQueueService.deleteOriginalBackup).toHaveBeenCalledWith('job1');
      expect(result).toEqual({ freedSpace: '524288000' });
    });

    it('should propagate errors when no backup exists', async () => {
      mockQueueService.deleteOriginalBackup.mockRejectedValue(new Error('no backup exists'));
      await expect(controller.deleteOriginal('job1')).rejects.toThrow('no backup exists');
    });
  });

  describe('restoreOriginal', () => {
    it('should restore original file', async () => {
      const restored = { id: 'job1', stage: JobStage.COMPLETED };
      mockQueueService.restoreOriginal.mockResolvedValue(restored);

      const result = await controller.restoreOriginal('job1');

      expect(mockQueueService.restoreOriginal).toHaveBeenCalledWith('job1');
      expect(result).toEqual(restored);
    });

    it('should propagate errors when no backup exists', async () => {
      mockQueueService.restoreOriginal.mockRejectedValue(new Error('no backup to restore'));
      await expect(controller.restoreOriginal('job1')).rejects.toThrow('no backup to restore');
    });
  });

  describe('recheckJob', () => {
    it('should recheck a failed job', async () => {
      const completed = { id: 'job1', stage: JobStage.COMPLETED };
      mockQueueService.recheckFailedJob.mockResolvedValue(completed);

      const result = await controller.recheckJob('job1');

      expect(mockQueueService.recheckFailedJob).toHaveBeenCalledWith('job1');
      expect(result).toEqual(completed);
    });

    it('should propagate errors for non-failed jobs', async () => {
      mockQueueService.recheckFailedJob.mockRejectedValue(new Error('not failed'));
      await expect(controller.recheckJob('job1')).rejects.toThrow('not failed');
    });
  });

  describe('resolveDecision', () => {
    it('should resolve a user decision and move job to QUEUED', async () => {
      const dto = { decisionData: { audio_codec_incompatible: 'remux_to_mkv' } };
      const queued = { id: 'job1', stage: JobStage.QUEUED };
      mockQueueService.resolveDecision.mockResolvedValue(queued);

      const result = await controller.resolveDecision('job1', dto as any);

      expect(mockQueueService.resolveDecision).toHaveBeenCalledWith('job1', dto.decisionData);
      expect(result).toEqual(queued);
    });

    it('should propagate errors for jobs not in NEEDS_DECISION stage', async () => {
      mockQueueService.resolveDecision.mockRejectedValue(new Error('not needs decision'));
      await expect(controller.resolveDecision('job1', { decisionData: {} } as any)).rejects.toThrow(
        'not needs decision'
      );
    });
  });

  describe('detectAndRequeue', () => {
    it('should requeue a completed job with no compression', async () => {
      const queued = { id: 'job1', stage: JobStage.QUEUED };
      mockQueueService.detectAndRequeueIfUncompressed.mockResolvedValue(queued);

      const result = await controller.detectAndRequeue('job1');

      expect(mockQueueService.detectAndRequeueIfUncompressed).toHaveBeenCalledWith('job1');
      expect(result).toEqual(queued);
    });

    it('should propagate errors for jobs that were compressed', async () => {
      mockQueueService.detectAndRequeueIfUncompressed.mockRejectedValue(
        new Error('compression was successful')
      );
      await expect(controller.detectAndRequeue('job1')).rejects.toThrow(
        'compression was successful'
      );
    });
  });

  describe('cancelAll', () => {
    it('should cancel all queued jobs', async () => {
      const result = { cancelledCount: 15 };
      mockQueueService.cancelAllQueued.mockResolvedValue(result);

      const res = await controller.cancelAll();

      expect(mockQueueService.cancelAllQueued).toHaveBeenCalledTimes(1);
      expect(res).toEqual(result);
    });

    it('should propagate service errors', async () => {
      mockQueueService.cancelAllQueued.mockRejectedValue(new Error('db error'));
      await expect(controller.cancelAll()).rejects.toThrow('db error');
    });
  });

  describe('retryAllCancelled', () => {
    it('should retry all cancelled jobs', async () => {
      const result = { retriedCount: 10, totalSizeBytes: '1000000', jobs: [] };
      mockQueueService.retryAllCancelled.mockResolvedValue(result);

      const res = await controller.retryAllCancelled();

      expect(mockQueueService.retryAllCancelled).toHaveBeenCalledTimes(1);
      expect(res).toEqual(result);
    });

    it('should propagate service errors', async () => {
      mockQueueService.retryAllCancelled.mockRejectedValue(new Error('db error'));
      await expect(controller.retryAllCancelled()).rejects.toThrow('db error');
    });
  });

  describe('retryAllFailed', () => {
    it('should retry all failed jobs without filter', async () => {
      const result = { retriedCount: 5, jobs: [] };
      mockQueueService.retryAllFailed.mockResolvedValue(result);

      const res = await controller.retryAllFailed(undefined);

      expect(mockQueueService.retryAllFailed).toHaveBeenCalledWith(undefined);
      expect(res).toEqual(result);
    });

    it('should retry failed jobs filtered by error category', async () => {
      const result = { retriedCount: 2, jobs: [] };
      mockQueueService.retryAllFailed.mockResolvedValue(result);

      await controller.retryAllFailed('FFmpeg Error Code 255');

      expect(mockQueueService.retryAllFailed).toHaveBeenCalledWith('FFmpeg Error Code 255');
    });

    it('should propagate service errors', async () => {
      mockQueueService.retryAllFailed.mockRejectedValue(new Error('db error'));
      await expect(controller.retryAllFailed()).rejects.toThrow('db error');
    });
  });

  describe('skipAllCodecMatch', () => {
    it('should skip all codec-matched jobs', async () => {
      const result = { skippedCount: 3, jobs: [] };
      mockQueueService.skipAllCodecMatch.mockResolvedValue(result);

      const res = await controller.skipAllCodecMatch();

      expect(mockQueueService.skipAllCodecMatch).toHaveBeenCalledTimes(1);
      expect(res).toEqual(result);
    });

    it('should propagate service errors', async () => {
      mockQueueService.skipAllCodecMatch.mockRejectedValue(new Error('skip error'));
      await expect(controller.skipAllCodecMatch()).rejects.toThrow('skip error');
    });
  });

  describe('forceEncodeAllCodecMatch', () => {
    it('should force encode all codec-matched jobs', async () => {
      const result = { queuedCount: 4, jobs: [] };
      mockQueueService.forceEncodeAllCodecMatch.mockResolvedValue(result);

      const res = await controller.forceEncodeAllCodecMatch();

      expect(mockQueueService.forceEncodeAllCodecMatch).toHaveBeenCalledTimes(1);
      expect(res).toEqual(result);
    });

    it('should propagate service errors', async () => {
      mockQueueService.forceEncodeAllCodecMatch.mockRejectedValue(new Error('encode error'));
      await expect(controller.forceEncodeAllCodecMatch()).rejects.toThrow('encode error');
    });
  });

  describe('remove', () => {
    it('should remove a job', async () => {
      mockQueueService.remove.mockResolvedValue(undefined);

      await controller.remove('job1');

      expect(mockQueueService.remove).toHaveBeenCalledWith('job1');
    });

    it('should propagate errors for unknown job', async () => {
      mockQueueService.remove.mockRejectedValue(new Error('not found'));
      await expect(controller.remove('missing')).rejects.toThrow('not found');
    });
  });

  describe('clearJobs', () => {
    it('should clear all jobs when no stages specified', async () => {
      mockQueueService.clearJobs.mockResolvedValue(42);

      const result = await controller.clearJobs(undefined);

      expect(mockQueueService.clearJobs).toHaveBeenCalledWith(undefined);
      expect(result).toEqual({ deleted: 42 });
    });

    it('should clear jobs for specified stages', async () => {
      mockQueueService.clearJobs.mockResolvedValue(10);

      const result = await controller.clearJobs('COMPLETED,FAILED');

      expect(mockQueueService.clearJobs).toHaveBeenCalledWith(['COMPLETED', 'FAILED']);
      expect(result).toEqual({ deleted: 10 });
    });

    it('should propagate service errors', async () => {
      mockQueueService.clearJobs.mockRejectedValue(new Error('db error'));
      await expect(controller.clearJobs(undefined)).rejects.toThrow('db error');
    });
  });

  describe('delegateJob', () => {
    it('should delegate a job to target node', async () => {
      const dto = { targetNodeId: 'node2' };
      const delegated = { id: 'job1', nodeId: 'node2' };
      mockQueueService.delegateJob.mockResolvedValue(delegated);

      const result = await controller.delegateJob('job1', dto as any);

      expect(mockQueueService.delegateJob).toHaveBeenCalledWith('job1', 'node2');
      expect(result).toEqual(delegated);
    });

    it('should propagate errors for invalid target node', async () => {
      mockQueueService.delegateJob.mockRejectedValue(new Error('node offline'));
      await expect(controller.delegateJob('job1', { targetNodeId: 'bad' } as any)).rejects.toThrow(
        'node offline'
      );
    });
  });

  describe('getActiveTransfers', () => {
    it('should return jobs in TRANSFERRING stage', async () => {
      const transfers = { jobs: [{ id: 'job1', stage: 'TRANSFERRING' }], total: 1 };
      mockQueueService.findAll.mockResolvedValue(transfers);

      const result = await controller.getActiveTransfers();

      expect(mockQueueService.findAll).toHaveBeenCalledWith('TRANSFERRING');
      expect(result).toEqual(transfers);
    });

    it('should propagate service errors', async () => {
      mockQueueService.findAll.mockRejectedValue(new Error('db error'));
      await expect(controller.getActiveTransfers()).rejects.toThrow('db error');
    });
  });

  describe('getTransferProgress', () => {
    it('should return transfer progress for a job', async () => {
      const progress = { progress: 60, speedMBps: 100, eta: 30 };
      mockFileTransferService.getTransferProgress.mockResolvedValue(progress);

      const result = await controller.getTransferProgress('job1');

      expect(mockFileTransferService.getTransferProgress).toHaveBeenCalledWith('job1');
      expect(result).toEqual(progress);
    });

    it('should propagate errors for unknown job', async () => {
      mockFileTransferService.getTransferProgress.mockRejectedValue(new Error('not found'));
      await expect(controller.getTransferProgress('missing')).rejects.toThrow('not found');
    });
  });

  describe('cancelTransfer', () => {
    it('should cancel an active file transfer', async () => {
      mockFileTransferService.cancelTransfer.mockResolvedValue(undefined);

      await controller.cancelTransfer('job1');

      expect(mockFileTransferService.cancelTransfer).toHaveBeenCalledWith('job1');
    });

    it('should propagate errors for jobs without active transfer', async () => {
      mockFileTransferService.cancelTransfer.mockRejectedValue(new Error('no active transfer'));
      await expect(controller.cancelTransfer('job1')).rejects.toThrow('no active transfer');
    });
  });

  describe('rebalanceJobs', () => {
    it('should rebalance jobs and return count', async () => {
      mockQueueService.rebalanceJobs.mockResolvedValue(7);

      const result = await controller.rebalanceJobs();

      expect(mockQueueService.rebalanceJobs).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ jobsRebalanced: 7, message: 'Redistributed 7 job(s) across nodes' });
    });

    it('should return "no rebalancing needed" when jobs are well distributed', async () => {
      mockQueueService.rebalanceJobs.mockResolvedValue(0);

      const result = await controller.rebalanceJobs();

      expect(result).toEqual({
        jobsRebalanced: 0,
        message: 'No rebalancing needed - jobs are already well distributed',
      });
    });

    it('should propagate service errors', async () => {
      mockQueueService.rebalanceJobs.mockRejectedValue(new Error('rebalance error'));
      await expect(controller.rebalanceJobs()).rejects.toThrow('rebalance error');
    });
  });

  describe('fixStuckTransfers', () => {
    it('should fix stuck transfers and return count', async () => {
      mockQueueService.fixStuckTransfers.mockResolvedValue(3);

      const result = await controller.fixStuckTransfers();

      expect(mockQueueService.fixStuckTransfers).toHaveBeenCalledTimes(1);
      expect(result).toEqual({
        fixed: 3,
        message: 'Reset 3 stuck transfer(s) back to QUEUED',
      });
    });

    it('should return "no stuck transfers" message when none found', async () => {
      mockQueueService.fixStuckTransfers.mockResolvedValue(0);

      const result = await controller.fixStuckTransfers();

      expect(result).toEqual({ fixed: 0, message: 'No stuck transfers found' });
    });

    it('should propagate service errors', async () => {
      mockQueueService.fixStuckTransfers.mockRejectedValue(new Error('fix error'));
      await expect(controller.fixStuckTransfers()).rejects.toThrow('fix error');
    });
  });

  describe('capturePreview', () => {
    it('should capture a manual preview for an encoding job', async () => {
      const encodingJob = {
        id: 'job1',
        stage: JobStage.ENCODING,
        filePath: '/mnt/a.mkv',
        progress: 45,
        previewImagePaths: JSON.stringify(['/previews/job1/1.jpg']),
      };
      const updated = {
        id: 'job1',
        previewImagePaths: JSON.stringify(['/previews/job1/1.jpg', '/previews/job1/manual.jpg']),
      };
      mockQueueService.findOne.mockResolvedValue(encodingJob);
      mockPreviewService.captureManualPreview.mockResolvedValue('/previews/job1/manual.jpg');
      mockQueueService.update.mockResolvedValue(updated);

      const result = await controller.capturePreview('job1');

      expect(mockPreviewService.captureManualPreview).toHaveBeenCalledWith(
        'job1',
        '/mnt/a.mkv',
        45
      );
      expect(result).toEqual(updated);
    });

    it('should throw BadRequestException when job is not in ENCODING stage', async () => {
      const job = { id: 'job1', stage: JobStage.QUEUED, filePath: '/mnt/a.mkv', progress: 0 };
      mockQueueService.findOne.mockResolvedValue(job);

      await expect(controller.capturePreview('job1')).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when source file does not exist', async () => {
      const job = {
        id: 'job1',
        stage: JobStage.ENCODING,
        filePath: null,
        progress: 45,
        previewImagePaths: null,
      };
      mockQueueService.findOne.mockResolvedValue(job);

      await expect(controller.capturePreview('job1')).rejects.toThrow(BadRequestException);
    });
  });
});
