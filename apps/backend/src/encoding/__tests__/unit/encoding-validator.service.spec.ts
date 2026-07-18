import { Test, type TestingModule } from '@nestjs/testing';
import { JobRepository } from '../../../common/repositories/job.repository';
import { LibraryRepository } from '../../../common/repositories/library.repository';
import { PolicyRepository } from '../../../common/repositories/policy.repository';
import { QueueService } from '../../../queue/queue.service';
import { CompletionOutboxService } from '../../../queue/services/completion-outbox.service';
import { FileFailureTrackingService } from '../../../queue/services/file-failure-tracking.service';
import { createMockJob } from '../../../testing/mock-factories';
import { EncodingFileService, type JobResult } from '../../encoding-file.service';
import { EncodingValidatorService } from '../../encoding-validator.service';
import { JobRetryStrategyService } from '../../job-retry-strategy.service';
import { CodecFallbackService } from '../../services/codec-fallback.service';

describe('EncodingValidatorService', () => {
  let service: EncodingValidatorService;
  let codecFallbackService: { clearFallback: jest.Mock };
  let fileFailureTracking: { recordSuccess: jest.Mock };
  let completionOutbox: { writeOutbox: jest.Mock; clearOutbox: jest.Mock };
  let queueService: { completeJob: jest.Mock };
  let encodingFileService: { updateLibraryStats: jest.Mock };

  const result: JobResult = {
    beforeSizeBytes: BigInt(2_000_000_000),
    afterSizeBytes: BigInt(1_000_000_000),
    savedBytes: BigInt(1_000_000_000),
    savedPercent: 50,
  };

  beforeEach(async () => {
    codecFallbackService = { clearFallback: jest.fn().mockResolvedValue(undefined) };
    fileFailureTracking = { recordSuccess: jest.fn().mockResolvedValue(undefined) };
    completionOutbox = {
      writeOutbox: jest.fn().mockResolvedValue(undefined),
      clearOutbox: jest.fn().mockResolvedValue(undefined),
    };
    queueService = { completeJob: jest.fn().mockResolvedValue(undefined) };
    encodingFileService = { updateLibraryStats: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EncodingValidatorService,
        { provide: JobRepository, useValue: {} },
        { provide: PolicyRepository, useValue: {} },
        { provide: LibraryRepository, useValue: {} },
        { provide: QueueService, useValue: queueService },
        { provide: CodecFallbackService, useValue: codecFallbackService },
        { provide: CompletionOutboxService, useValue: completionOutbox },
        { provide: EncodingFileService, useValue: encodingFileService },
        { provide: JobRetryStrategyService, useValue: {} },
        { provide: FileFailureTrackingService, useValue: fileFailureTracking },
      ],
    }).compile();

    service = module.get(EncodingValidatorService);
    jest.spyOn((service as any).logger, 'log').mockImplementation();
    jest.spyOn((service as any).logger, 'warn').mockImplementation();
    jest.spyOn((service as any).logger, 'error').mockImplementation();
  });

  describe('handleJobCompletion - per-file success memory', () => {
    it('does not record anything when no codec override was active', async () => {
      // job.targetCodec is the abstract policy family (e.g. "HEVC"), not a
      // concrete ffmpeg encoder id - it must never be written to
      // lastSuccessfulCodec, which is later fed straight into -c:v.
      const job = createMockJob({
        id: 'job-1',
        filePath: '/media/test.mkv',
        libraryId: 'lib-1',
        targetCodec: 'HEVC',
        codecOverride: null,
        contentFingerprint: null,
      });

      await service.handleJobCompletion(job as any, result);

      expect(fileFailureTracking.recordSuccess).not.toHaveBeenCalled();
    });

    it('records the codecOverride (not targetCodec) when a GPU fallback was active', async () => {
      const job = createMockJob({
        id: 'job-1',
        filePath: '/media/test.mkv',
        libraryId: 'lib-1',
        targetCodec: 'hevc_nvenc',
        codecOverride: 'libx265',
        contentFingerprint: 'fp-abc123',
      });

      await service.handleJobCompletion(job as any, result);

      expect(codecFallbackService.clearFallback).toHaveBeenCalledWith('job-1');
      expect(fileFailureTracking.recordSuccess).toHaveBeenCalledWith(
        '/media/test.mkv',
        'lib-1',
        'libx265',
        'fp-abc123'
      );
    });

    it('does not block job completion when recordSuccess throws', async () => {
      const job = createMockJob({
        id: 'job-1',
        filePath: '/media/test.mkv',
        libraryId: 'lib-1',
        codecOverride: 'libx265',
      });
      fileFailureTracking.recordSuccess.mockRejectedValue(new Error('db unavailable'));

      await expect(service.handleJobCompletion(job as any, result)).resolves.not.toThrow();

      expect(queueService.completeJob).toHaveBeenCalled();
      expect((service as any).logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Failed to record success-path memory'),
        expect.any(Error)
      );
    });
  });
});
