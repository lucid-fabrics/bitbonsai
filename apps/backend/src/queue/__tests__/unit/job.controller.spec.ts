import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { type Job } from '@prisma/client';
import { JwtAuthGuard } from '../../../auth/guards/jwt-auth.guard';
import { NodeConfigService } from '../../../core/services/node-config.service';
import { JobController } from '../../controllers/job.controller';
import { type CancelJobDto } from '../../dto/cancel-job.dto';
import { type CompleteJobDto } from '../../dto/complete-job.dto';
import { type CreateJobDto } from '../../dto/create-job.dto';
import { type DelegateJobDto } from '../../dto/delegate-job.dto';
import { type FailJobDto } from '../../dto/fail-job.dto';
import { type ResolveDecisionDto } from '../../dto/resolve-decision.dto';
import { type UpdateJobDto } from '../../dto/update-job.dto';
import { type UpdatePriorityDto } from '../../dto/update-priority.dto';
import { QueueService } from '../../queue.service';
import { JobHistoryService } from '../../services/job-history.service';

const makeJob = (overrides: Partial<Job> = {}): Job =>
  ({
    id: 'job-1',
    nodeId: 'node-1',
    stage: 'QUEUED',
    progress: 0,
    isBlacklisted: false,
    ...overrides,
  }) as Job;

describe('JobController', () => {
  let controller: JobController;

  const mockQueueService = {
    create: jest.fn(),
    findOne: jest.fn(),
    update: jest.fn(),
    updateProgress: jest.fn(),
    updateJobPriority: jest.fn(),
    remove: jest.fn(),
    completeJob: jest.fn(),
    failJob: jest.fn(),
    cancelJob: jest.fn(),
    unblacklistJob: jest.fn(),
    pauseJob: jest.fn(),
    resumeJob: jest.fn(),
    retryJob: jest.fn(),
    recheckHealth: jest.fn(),
    forceStartJob: jest.fn(),
    recheckFailedJob: jest.fn(),
    resolveDecision: jest.fn(),
    detectAndRequeueIfUncompressed: jest.fn(),
    delegateJob: jest.fn(),
    requestKeepOriginal: jest.fn(),
    deleteOriginalBackup: jest.fn(),
    restoreOriginal: jest.fn(),
  };

  const mockJobHistoryService = {
    getJobHistory: jest.fn(),
  };

  const mockNodeConfig = {
    getNodeId: jest.fn(),
    isMainNode: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [JobController],
      providers: [
        { provide: QueueService, useValue: mockQueueService },
        { provide: JobHistoryService, useValue: mockJobHistoryService },
        { provide: NodeConfigService, useValue: mockNodeConfig },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<JobController>(JobController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  // ---------------------------------------------------------------------------
  // create
  // ---------------------------------------------------------------------------
  describe('create', () => {
    it('should create a job and return it', async () => {
      const dto = { filePath: '/media/movie.mkv' } as CreateJobDto;
      const job = makeJob();
      mockQueueService.create.mockResolvedValue(job);

      const result = await controller.create(dto);

      expect(mockQueueService.create).toHaveBeenCalledWith(dto);
      expect(result).toEqual(job);
    });

    it('should propagate service errors', async () => {
      mockQueueService.create.mockRejectedValue(new NotFoundException('Node not found'));
      await expect(controller.create({} as CreateJobDto)).rejects.toThrow(NotFoundException);
    });
  });

  // ---------------------------------------------------------------------------
  // findOne
  // ---------------------------------------------------------------------------
  describe('findOne', () => {
    it('should return a job by id', async () => {
      const job = makeJob();
      mockQueueService.findOne.mockResolvedValue(job);

      const result = await controller.findOne('job-1');

      expect(mockQueueService.findOne).toHaveBeenCalledWith('job-1');
      expect(result).toEqual(job);
    });

    it('should propagate NotFoundException for unknown id', async () => {
      mockQueueService.findOne.mockRejectedValue(new NotFoundException('Job not found'));
      await expect(controller.findOne('missing')).rejects.toThrow(NotFoundException);
    });
  });

  // ---------------------------------------------------------------------------
  // getJobHistory
  // ---------------------------------------------------------------------------
  describe('getJobHistory', () => {
    it('should return history timeline after verifying job exists', async () => {
      const job = makeJob();
      const history = [{ id: 'h1', eventType: 'FAILED' }];
      mockQueueService.findOne.mockResolvedValue(job);
      mockJobHistoryService.getJobHistory.mockResolvedValue(history);

      const result = await controller.getJobHistory('job-1');

      expect(mockQueueService.findOne).toHaveBeenCalledWith('job-1');
      expect(mockJobHistoryService.getJobHistory).toHaveBeenCalledWith('job-1');
      expect(result).toEqual(history);
    });

    it('should throw if job does not exist', async () => {
      mockQueueService.findOne.mockRejectedValue(new NotFoundException('Job not found'));
      await expect(controller.getJobHistory('missing')).rejects.toThrow(NotFoundException);
      expect(mockJobHistoryService.getJobHistory).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // update
  // ---------------------------------------------------------------------------
  describe('update', () => {
    it('should allow main node to update any job', async () => {
      const job = makeJob({ nodeId: 'other-node' });
      const updated = makeJob({ progress: 50 });
      mockNodeConfig.getNodeId.mockReturnValue('node-main');
      mockNodeConfig.isMainNode.mockReturnValue(true);
      mockQueueService.findOne.mockResolvedValue(job);
      mockQueueService.update.mockResolvedValue(updated);

      const result = await controller.update('job-1', { progress: 50 } as UpdateJobDto);

      expect(result).toEqual(updated);
    });

    it('should allow owner node to update its own job', async () => {
      const job = makeJob({ nodeId: 'node-1' });
      const updated = makeJob({ progress: 30 });
      mockNodeConfig.getNodeId.mockReturnValue('node-1');
      mockNodeConfig.isMainNode.mockReturnValue(false);
      mockQueueService.findOne.mockResolvedValue(job);
      mockQueueService.update.mockResolvedValue(updated);

      const result = await controller.update('job-1', { progress: 30 } as UpdateJobDto);

      expect(result).toEqual(updated);
    });

    it('should allow update when job has no nodeId assigned', async () => {
      const job = makeJob({ nodeId: null as unknown as string });
      const updated = makeJob({ stage: 'ENCODING' });
      mockNodeConfig.getNodeId.mockReturnValue('node-1');
      mockNodeConfig.isMainNode.mockReturnValue(false);
      mockQueueService.findOne.mockResolvedValue(job);
      mockQueueService.update.mockResolvedValue(updated);

      const result = await controller.update('job-1', {} as UpdateJobDto);

      expect(result).toEqual(updated);
    });

    it('should throw ForbiddenException when non-owner node tries to update', async () => {
      const job = makeJob({ nodeId: 'node-other' });
      mockNodeConfig.getNodeId.mockReturnValue('node-1');
      mockNodeConfig.isMainNode.mockReturnValue(false);
      mockQueueService.findOne.mockResolvedValue(job);

      await expect(controller.update('job-1', {} as UpdateJobDto)).rejects.toThrow(
        ForbiddenException
      );
      expect(mockQueueService.update).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // updateJobProgress
  // ---------------------------------------------------------------------------
  describe('updateJobProgress', () => {
    it('should update progress for a linked node', async () => {
      const updated = makeJob({ progress: 75 });
      mockQueueService.updateProgress.mockResolvedValue(updated);

      const result = await controller.updateJobProgress('job-1', {
        progress: 75,
        etaSeconds: 120,
      });

      expect(mockQueueService.updateProgress).toHaveBeenCalledWith('job-1', {
        progress: 75,
        etaSeconds: 120,
      });
      expect(result).toEqual(updated);
    });
  });

  // ---------------------------------------------------------------------------
  // updateJobStage
  // ---------------------------------------------------------------------------
  describe('updateJobStage', () => {
    it('should update stage via updateProgress', async () => {
      const updated = makeJob({ stage: 'VERIFYING' });
      const dto = { stage: 'VERIFYING' } as unknown as UpdateJobDto;
      mockQueueService.updateProgress.mockResolvedValue(updated);

      const result = await controller.updateJobStage('job-1', dto);

      expect(mockQueueService.updateProgress).toHaveBeenCalledWith('job-1', dto);
      expect(result).toEqual(updated);
    });
  });

  // ---------------------------------------------------------------------------
  // updatePriority
  // ---------------------------------------------------------------------------
  describe('updatePriority', () => {
    it('should update job priority', async () => {
      const updated = makeJob();
      mockQueueService.updateJobPriority.mockResolvedValue(updated);

      const result = await controller.updatePriority('job-1', { priority: 2 } as UpdatePriorityDto);

      expect(mockQueueService.updateJobPriority).toHaveBeenCalledWith('job-1', 2);
      expect(result).toEqual(updated);
    });

    it('should propagate errors (e.g. max top priority exceeded)', async () => {
      mockQueueService.updateJobPriority.mockRejectedValue(new Error('max 3 top priority jobs'));
      await expect(
        controller.updatePriority('job-1', { priority: 2 } as UpdatePriorityDto)
      ).rejects.toThrow('max 3 top priority jobs');
    });
  });

  // ---------------------------------------------------------------------------
  // remove
  // ---------------------------------------------------------------------------
  describe('remove', () => {
    it('should delete a job', async () => {
      mockQueueService.remove.mockResolvedValue(undefined);

      await controller.remove('job-1');

      expect(mockQueueService.remove).toHaveBeenCalledWith('job-1');
    });

    it('should propagate NotFoundException', async () => {
      mockQueueService.remove.mockRejectedValue(new NotFoundException('Job not found'));
      await expect(controller.remove('missing')).rejects.toThrow(NotFoundException);
    });
  });

  // ---------------------------------------------------------------------------
  // complete
  // ---------------------------------------------------------------------------
  describe('complete', () => {
    it('should mark job as completed', async () => {
      const dto: CompleteJobDto = {
        afterSizeBytes: '4294967296',
        savedBytes: '1073741824',
        savedPercent: 25,
      };
      const completed = makeJob({ stage: 'COMPLETED' });
      mockQueueService.completeJob.mockResolvedValue(completed);

      const result = await controller.complete('job-1', dto);

      expect(mockQueueService.completeJob).toHaveBeenCalledWith('job-1', dto);
      expect(result).toEqual(completed);
    });
  });

  // ---------------------------------------------------------------------------
  // fail
  // ---------------------------------------------------------------------------
  describe('fail', () => {
    it('should mark job as failed with error message', async () => {
      const dto: FailJobDto = { error: 'FFmpeg exit code 1' };
      const failed = makeJob({ stage: 'FAILED' });
      mockQueueService.failJob.mockResolvedValue(failed);

      const result = await controller.fail('job-1', dto);

      expect(mockQueueService.failJob).toHaveBeenCalledWith('job-1', 'FFmpeg exit code 1');
      expect(result).toEqual(failed);
    });
  });

  // ---------------------------------------------------------------------------
  // cancel
  // ---------------------------------------------------------------------------
  describe('cancel', () => {
    it('should cancel a job without blacklisting by default', async () => {
      const dto: CancelJobDto = { blacklist: false };
      const cancelled = makeJob({ stage: 'CANCELLED' });
      mockQueueService.cancelJob.mockResolvedValue(cancelled);

      const result = await controller.cancel('job-1', dto);

      expect(mockQueueService.cancelJob).toHaveBeenCalledWith('job-1', false);
      expect(result).toEqual(cancelled);
    });

    it('should cancel and blacklist when blacklist=true', async () => {
      const dto: CancelJobDto = { blacklist: true };
      const cancelled = makeJob({ stage: 'CANCELLED', isBlacklisted: true });
      mockQueueService.cancelJob.mockResolvedValue(cancelled);

      const result = await controller.cancel('job-1', dto);

      expect(mockQueueService.cancelJob).toHaveBeenCalledWith('job-1', true);
      expect(result).toEqual(cancelled);
    });

    it('should default blacklist to false when undefined', async () => {
      const dto: CancelJobDto = {};
      mockQueueService.cancelJob.mockResolvedValue(makeJob({ stage: 'CANCELLED' }));

      await controller.cancel('job-1', dto);

      expect(mockQueueService.cancelJob).toHaveBeenCalledWith('job-1', false);
    });
  });

  // ---------------------------------------------------------------------------
  // unblacklist
  // ---------------------------------------------------------------------------
  describe('unblacklist', () => {
    it('should remove blacklist flag from a cancelled job', async () => {
      const unblacklisted = makeJob({ isBlacklisted: false });
      mockQueueService.unblacklistJob.mockResolvedValue(unblacklisted);

      const result = await controller.unblacklist('job-1');

      expect(mockQueueService.unblacklistJob).toHaveBeenCalledWith('job-1');
      expect(result).toEqual(unblacklisted);
    });
  });

  // ---------------------------------------------------------------------------
  // pause
  // ---------------------------------------------------------------------------
  describe('pause', () => {
    it('should pause an encoding job', async () => {
      const paused = makeJob({ stage: 'PAUSED' });
      mockQueueService.pauseJob.mockResolvedValue(paused);

      const result = await controller.pause('job-1');

      expect(mockQueueService.pauseJob).toHaveBeenCalledWith('job-1');
      expect(result).toEqual(paused);
    });
  });

  // ---------------------------------------------------------------------------
  // resume
  // ---------------------------------------------------------------------------
  describe('resume', () => {
    it('should resume a paused job', async () => {
      const resumed = makeJob({ stage: 'ENCODING' });
      mockQueueService.resumeJob.mockResolvedValue(resumed);

      const result = await controller.resume('job-1');

      expect(mockQueueService.resumeJob).toHaveBeenCalledWith('job-1');
      expect(result).toEqual(resumed);
    });
  });

  // ---------------------------------------------------------------------------
  // retry
  // ---------------------------------------------------------------------------
  describe('retry', () => {
    it('should reset a failed job back to QUEUED', async () => {
      const requeued = makeJob({ stage: 'QUEUED' });
      mockQueueService.retryJob.mockResolvedValue(requeued);

      const result = await controller.retry('job-1');

      expect(mockQueueService.retryJob).toHaveBeenCalledWith('job-1');
      expect(result).toEqual(requeued);
    });
  });

  // ---------------------------------------------------------------------------
  // recheckHealth
  // ---------------------------------------------------------------------------
  describe('recheckHealth', () => {
    it('should reset health check data and return job in DETECTED stage', async () => {
      const rechecked = makeJob({ stage: 'DETECTED' });
      mockQueueService.recheckHealth.mockResolvedValue(rechecked);

      const result = await controller.recheckHealth('job-1');

      expect(mockQueueService.recheckHealth).toHaveBeenCalledWith('job-1');
      expect(result).toEqual(rechecked);
    });
  });

  // ---------------------------------------------------------------------------
  // forceStart
  // ---------------------------------------------------------------------------
  describe('forceStart', () => {
    it('should force-start a queued job', async () => {
      const started = makeJob({ stage: 'DETECTED' });
      mockQueueService.forceStartJob.mockResolvedValue(started);

      const result = await controller.forceStart('job-1');

      expect(mockQueueService.forceStartJob).toHaveBeenCalledWith('job-1');
      expect(result).toEqual(started);
    });
  });

  // ---------------------------------------------------------------------------
  // recheckJob
  // ---------------------------------------------------------------------------
  describe('recheckJob', () => {
    it('should re-validate a failed job', async () => {
      const completed = makeJob({ stage: 'COMPLETED' });
      mockQueueService.recheckFailedJob.mockResolvedValue(completed);

      const result = await controller.recheckJob('job-1');

      expect(mockQueueService.recheckFailedJob).toHaveBeenCalledWith('job-1');
      expect(result).toEqual(completed);
    });
  });

  // ---------------------------------------------------------------------------
  // resolveDecision
  // ---------------------------------------------------------------------------
  describe('resolveDecision', () => {
    it('should resolve a user decision and move job to QUEUED', async () => {
      const dto: ResolveDecisionDto = {
        decisionData: { audio_codec_incompatible: 'remux_to_mkv' },
      };
      const queued = makeJob({ stage: 'QUEUED' });
      mockQueueService.resolveDecision.mockResolvedValue(queued);

      const result = await controller.resolveDecision('job-1', dto);

      expect(mockQueueService.resolveDecision).toHaveBeenCalledWith('job-1', dto.decisionData);
      expect(result).toEqual(queued);
    });
  });

  // ---------------------------------------------------------------------------
  // detectAndRequeue
  // ---------------------------------------------------------------------------
  describe('detectAndRequeue', () => {
    it('should requeue a completed job with no compression', async () => {
      const requeued = makeJob({ stage: 'QUEUED' });
      mockQueueService.detectAndRequeueIfUncompressed.mockResolvedValue(requeued);

      const result = await controller.detectAndRequeue('job-1');

      expect(mockQueueService.detectAndRequeueIfUncompressed).toHaveBeenCalledWith('job-1');
      expect(result).toEqual(requeued);
    });
  });

  // ---------------------------------------------------------------------------
  // delegateJob (requires JwtAuthGuard)
  // ---------------------------------------------------------------------------
  describe('delegateJob', () => {
    it('should delegate job to a specific node', async () => {
      const dto: DelegateJobDto = { targetNodeId: 'node-2' };
      const delegated = makeJob({ nodeId: 'node-2' });
      mockQueueService.delegateJob.mockResolvedValue(delegated);

      const result = await controller.delegateJob('job-1', dto);

      expect(mockQueueService.delegateJob).toHaveBeenCalledWith('job-1', 'node-2');
      expect(result).toEqual(delegated);
    });

    it('should propagate NotFoundException when target node not found', async () => {
      mockQueueService.delegateJob.mockRejectedValue(new NotFoundException('Node not found'));
      await expect(
        controller.delegateJob('job-1', { targetNodeId: 'bad-node' } as DelegateJobDto)
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ---------------------------------------------------------------------------
  // keepOriginal
  // ---------------------------------------------------------------------------
  describe('keepOriginal', () => {
    it('should mark job to keep original file', async () => {
      const job = makeJob();
      mockQueueService.requestKeepOriginal.mockResolvedValue(job);

      const result = await controller.keepOriginal('job-1');

      expect(mockQueueService.requestKeepOriginal).toHaveBeenCalledWith('job-1');
      expect(result).toEqual(job);
    });
  });

  // ---------------------------------------------------------------------------
  // deleteOriginal
  // ---------------------------------------------------------------------------
  describe('deleteOriginal', () => {
    it('should delete original backup and return freed space as string', async () => {
      mockQueueService.deleteOriginalBackup.mockResolvedValue({ freedSpace: BigInt(524288000) });

      const result = await controller.deleteOriginal('job-1');

      expect(mockQueueService.deleteOriginalBackup).toHaveBeenCalledWith('job-1');
      expect(result).toEqual({ freedSpace: '524288000' });
    });
  });

  // ---------------------------------------------------------------------------
  // restoreOriginal
  // ---------------------------------------------------------------------------
  describe('restoreOriginal', () => {
    it('should restore original file', async () => {
      const job = makeJob();
      mockQueueService.restoreOriginal.mockResolvedValue(job);

      const result = await controller.restoreOriginal('job-1');

      expect(mockQueueService.restoreOriginal).toHaveBeenCalledWith('job-1');
      expect(result).toEqual(job);
    });
  });
});
