import { HttpService } from '@nestjs/axios';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JobEventType, JobStage } from '@prisma/client';
import { of, throwError } from 'rxjs';
import { JobRepository } from '../../common/repositories/job.repository';
import { NodeConfigService } from '../../core/services/node-config.service';
import { FfmpegService } from '../../encoding/ffmpeg.service';
import { PrismaService } from '../../prisma/prisma.service';
import { FileFailureTrackingService } from './file-failure-tracking.service';
import { FileTransferService } from './file-transfer.service';
import { JobCancellationService } from './job-cancellation.service';
import { JobHistoryService } from './job-history.service';

const JOB_ID = 'job-uuid-1';

function makeJob(overrides: Record<string, unknown> = {}) {
  return {
    id: JOB_ID,
    stage: JobStage.QUEUED,
    filePath: '/media/video.mkv',
    libraryId: 'lib-1',
    contentFingerprint: 'fp-abc',
    remoteTempPath: null,
    progress: 0,
    fps: null,
    etaSeconds: null,
    isBlacklisted: false,
    retryCount: 0,
    corruptedRequeueCount: 0,
    stuckRecoveryCount: 0,
    ...overrides,
  };
}

describe('JobCancellationService', () => {
  let service: JobCancellationService;
  let jobRepository: jest.Mocked<JobRepository>;
  let ffmpegService: jest.Mocked<FfmpegService>;
  let nodeConfig: jest.Mocked<NodeConfigService>;
  let jobHistoryService: jest.Mocked<JobHistoryService>;
  let fileTransferService: jest.Mocked<FileTransferService>;
  let prisma: jest.Mocked<PrismaService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JobCancellationService,
        {
          provide: JobRepository,
          useValue: {
            findById: jest.fn(),
            updateById: jest.fn(),
          },
        },
        {
          provide: FfmpegService,
          useValue: { killProcess: jest.fn() },
        },
        {
          provide: NodeConfigService,
          useValue: {
            getNodeId: jest.fn().mockReturnValue('node-1'),
            getMainApiUrl: jest.fn().mockReturnValue(null), // MAIN node by default
          },
        },
        {
          provide: HttpService,
          useValue: { post: jest.fn() },
        },
        {
          provide: JobHistoryService,
          useValue: { recordEvent: jest.fn().mockResolvedValue(undefined) },
        },
        {
          provide: FileTransferService,
          useValue: {
            cancelTransfer: jest.fn().mockResolvedValue(undefined),
            cleanupRemoteTempFile: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: FileFailureTrackingService,
          useValue: { clearBlacklist: jest.fn().mockResolvedValue(undefined) },
        },
        {
          provide: PrismaService,
          useValue: {
            processedFileRecord: { deleteMany: jest.fn().mockResolvedValue(undefined) },
          },
        },
      ],
    }).compile();

    service = module.get(JobCancellationService);
    jobRepository = module.get(JobRepository);
    ffmpegService = module.get(FfmpegService);
    nodeConfig = module.get(NodeConfigService);
    jobHistoryService = module.get(JobHistoryService);
    fileTransferService = module.get(FileTransferService);
    prisma = module.get(PrismaService);
  });

  describe('cancelJob — QUEUED (no PID)', () => {
    it('sets status CANCELLED directly without killing ffmpeg', async () => {
      const job = makeJob({ stage: JobStage.QUEUED });
      jobRepository.findById.mockResolvedValue(job as any);
      jobRepository.updateById.mockResolvedValue({ ...job, stage: JobStage.CANCELLED } as any);

      await service.cancelJob(JOB_ID);

      expect(ffmpegService.killProcess).not.toHaveBeenCalled();
      expect(jobRepository.updateById).toHaveBeenCalledWith(
        JOB_ID,
        expect.objectContaining({
          stage: JobStage.CANCELLED,
        })
      );
    });

    it('records CANCELLED history event', async () => {
      const job = makeJob({ stage: JobStage.QUEUED });
      jobRepository.findById.mockResolvedValue(job as any);
      jobRepository.updateById.mockResolvedValue({ ...job, stage: JobStage.CANCELLED } as any);

      await service.cancelJob(JOB_ID);

      expect(jobHistoryService.recordEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          jobId: JOB_ID,
          eventType: JobEventType.CANCELLED,
        })
      );
    });
  });

  describe('cancelJob — ENCODING (has PID)', () => {
    it('sends kill signal then sets status CANCELLED', async () => {
      const job = makeJob({ stage: JobStage.ENCODING });
      jobRepository.findById.mockResolvedValue(job as any);
      jobRepository.updateById.mockResolvedValue({ ...job, stage: JobStage.CANCELLED } as any);
      ffmpegService.killProcess.mockResolvedValue(true);

      await service.cancelJob(JOB_ID);

      expect(ffmpegService.killProcess).toHaveBeenCalledWith(JOB_ID);
      expect(jobRepository.updateById).toHaveBeenCalledWith(
        JOB_ID,
        expect.objectContaining({
          stage: JobStage.CANCELLED,
        })
      );
    });

    it('still cancels if ffmpeg process is not found (stale PID)', async () => {
      const job = makeJob({ stage: JobStage.ENCODING });
      jobRepository.findById.mockResolvedValue(job as any);
      jobRepository.updateById.mockResolvedValue({ ...job, stage: JobStage.CANCELLED } as any);
      ffmpegService.killProcess.mockResolvedValue(false); // process not found

      await service.cancelJob(JOB_ID);

      expect(jobRepository.updateById).toHaveBeenCalledWith(
        JOB_ID,
        expect.objectContaining({
          stage: JobStage.CANCELLED,
        })
      );
    });

    it('still cancels if ffmpeg.killProcess throws', async () => {
      const job = makeJob({ stage: JobStage.ENCODING });
      jobRepository.findById.mockResolvedValue(job as any);
      jobRepository.updateById.mockResolvedValue({ ...job, stage: JobStage.CANCELLED } as any);
      ffmpegService.killProcess.mockRejectedValue(new Error('kill failed'));

      await service.cancelJob(JOB_ID);

      expect(jobRepository.updateById).toHaveBeenCalledWith(
        JOB_ID,
        expect.objectContaining({
          stage: JobStage.CANCELLED,
        })
      );
    });
  });

  describe('cancelJob — COMPLETED job', () => {
    it('throws BadRequestException', async () => {
      const job = makeJob({ stage: JobStage.COMPLETED });
      jobRepository.findById.mockResolvedValue(job as any);

      await expect(service.cancelJob(JOB_ID)).rejects.toThrow(BadRequestException);
    });
  });

  describe('cancelJob — job not found', () => {
    it('throws NotFoundException', async () => {
      jobRepository.findById.mockResolvedValue(null);

      await expect(service.cancelJob('nonexistent')).rejects.toThrow(NotFoundException);
    });
  });

  describe('cancelJob — blacklist flag', () => {
    it('sets isBlacklisted when blacklist=true', async () => {
      const job = makeJob({ stage: JobStage.QUEUED });
      jobRepository.findById.mockResolvedValue(job as any);
      jobRepository.updateById.mockResolvedValue({
        ...job,
        stage: JobStage.CANCELLED,
        isBlacklisted: true,
      } as any);

      await service.cancelJob(JOB_ID, true);

      expect(jobRepository.updateById).toHaveBeenCalledWith(
        JOB_ID,
        expect.objectContaining({
          isBlacklisted: true,
        })
      );
    });
  });
});
