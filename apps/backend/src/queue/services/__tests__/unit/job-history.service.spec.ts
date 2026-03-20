import { Test, type TestingModule } from '@nestjs/testing';
import { JobEventType, JobStage } from '@prisma/client';
import { JobHistoryRepository } from '../../../../common/repositories/job-history.repository';
import { JobHistoryService, type RecordJobEventParams } from '../../job-history.service';

const createMockJobHistoryRepository = () => ({
  createEntry: jest.fn(),
  findManyByJobId: jest.fn(),
  countByJobId: jest.fn(),
});

describe('JobHistoryService', () => {
  let service: JobHistoryService;
  let repo: ReturnType<typeof createMockJobHistoryRepository>;

  beforeEach(async () => {
    repo = createMockJobHistoryRepository();

    const module: TestingModule = await Test.createTestingModule({
      providers: [JobHistoryService, { provide: JobHistoryRepository, useValue: repo }],
    }).compile();

    service = module.get<JobHistoryService>(JobHistoryService);

    jest.spyOn((service as any).logger, 'log').mockImplementation();
    jest.spyOn((service as any).logger, 'warn').mockImplementation();
    jest.spyOn((service as any).logger, 'debug').mockImplementation();
    jest.spyOn((service as any).logger, 'error').mockImplementation();
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  describe('recordEvent', () => {
    const baseParams: RecordJobEventParams = {
      jobId: 'job-1',
      eventType: JobEventType.FAILED,
      stage: JobStage.ENCODING,
      progress: 45.5,
    };

    it('should create a job history entry with all fields', async () => {
      repo.createEntry.mockResolvedValue({});

      const params: RecordJobEventParams = {
        ...baseParams,
        errorMessage: 'FFmpeg crashed',
        errorDetails: 'Signal 11',
        wasAutoHealed: true,
        tempFileExists: true,
        retryNumber: 2,
        triggeredBy: 'SYSTEM',
        systemMessage: 'Custom system message',
        fps: 30.5,
        etaSeconds: 3600,
        startedFromSeconds: 120,
      };

      await service.recordEvent(params);

      expect(repo.createEntry).toHaveBeenCalledWith({
        jobId: 'job-1',
        eventType: JobEventType.FAILED,
        stage: JobStage.ENCODING,
        progress: 45.5,
        errorMessage: 'FFmpeg crashed',
        errorDetails: 'Signal 11',
        wasAutoHealed: true,
        tempFileExists: true,
        retryNumber: 2,
        triggeredBy: 'SYSTEM',
        systemMessage: 'Custom system message',
        fps: 30.5,
        etaSeconds: 3600,
        startedFromSeconds: 120,
      });
    });

    it('should use default wasAutoHealed=false when not provided', async () => {
      repo.createEntry.mockResolvedValue({});

      await service.recordEvent(baseParams);

      expect(repo.createEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          wasAutoHealed: false,
        })
      );
    });

    it('should generate system message when none provided', async () => {
      repo.createEntry.mockResolvedValue({});

      await service.recordEvent({
        ...baseParams,
        retryNumber: 3,
      });

      expect(repo.createEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          systemMessage: 'Attempt #3 failed at 45.5%',
        })
      );
    });

    it('should log recorded event', async () => {
      repo.createEntry.mockResolvedValue({});

      await service.recordEvent(baseParams);

      expect((service as any).logger.log).toHaveBeenCalledWith(
        'Recorded FAILED event for job job-1 at 45.5%'
      );
    });

    it('should handle database error gracefully', async () => {
      const error = new Error('DB write failed');
      repo.createEntry.mockRejectedValue(error);

      await service.recordEvent(baseParams);

      expect((service as any).logger.error).toHaveBeenCalledWith(
        'Failed to record job history event',
        expect.stringContaining('DB write failed')
      );
    });

    it('should handle non-Error exceptions', async () => {
      repo.createEntry.mockRejectedValue('string error');

      await service.recordEvent(baseParams);

      expect((service as any).logger.error).toHaveBeenCalledWith(
        'Failed to record job history event',
        'string error'
      );
    });
  });

  describe('getJobHistory', () => {
    it('should return job history sorted by createdAt descending', async () => {
      const mockHistory = [
        { id: 'h-2', jobId: 'job-1', createdAt: new Date('2026-02-24T12:00:00Z') },
        { id: 'h-1', jobId: 'job-1', createdAt: new Date('2026-02-24T11:00:00Z') },
      ];
      repo.findManyByJobId.mockResolvedValue(mockHistory);

      const result = await service.getJobHistory('job-1');

      expect(result).toEqual(mockHistory);
      expect(repo.findManyByJobId).toHaveBeenCalledWith('job-1');
    });

    it('should return empty array when no history exists', async () => {
      repo.findManyByJobId.mockResolvedValue([]);

      const result = await service.getJobHistory('nonexistent-job');

      expect(result).toEqual([]);
    });
  });

  describe('getFailureCount', () => {
    it('should count FAILED, BACKEND_RESTART, and TIMEOUT events', async () => {
      repo.countByJobId.mockResolvedValue(5);

      const result = await service.getFailureCount('job-1');

      expect(result).toBe(5);
      expect(repo.countByJobId).toHaveBeenCalledWith('job-1', [
        JobEventType.FAILED,
        JobEventType.BACKEND_RESTART,
        JobEventType.TIMEOUT,
      ]);
    });

    it('should return 0 when no failure events exist', async () => {
      repo.countByJobId.mockResolvedValue(0);

      const result = await service.getFailureCount('job-1');

      expect(result).toBe(0);
    });
  });

  describe('generateSystemMessage (private, tested via recordEvent)', () => {
    it('should generate FAILED message with retry number', async () => {
      repo.createEntry.mockResolvedValue({});

      await service.recordEvent({
        jobId: 'job-1',
        eventType: JobEventType.FAILED,
        stage: JobStage.ENCODING,
        progress: 55.3,
        retryNumber: 2,
      });

      expect(repo.createEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          systemMessage: 'Attempt #2 failed at 55.3%',
        })
      );
    });

    it('should generate FAILED message without retry number', async () => {
      repo.createEntry.mockResolvedValue({});

      await service.recordEvent({
        jobId: 'job-1',
        eventType: JobEventType.FAILED,
        stage: JobStage.ENCODING,
        progress: 30.0,
      });

      expect(repo.createEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          systemMessage: 'Encoding failed at 30.0%',
        })
      );
    });

    it('should generate CANCELLED message for user cancellation', async () => {
      repo.createEntry.mockResolvedValue({});

      await service.recordEvent({
        jobId: 'job-1',
        eventType: JobEventType.CANCELLED,
        stage: JobStage.ENCODING,
        progress: 70.0,
        triggeredBy: 'USER',
      });

      expect(repo.createEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          systemMessage: 'Cancelled by user at 70.0%',
        })
      );
    });

    it('should generate CANCELLED message for system cancellation', async () => {
      repo.createEntry.mockResolvedValue({});

      await service.recordEvent({
        jobId: 'job-1',
        eventType: JobEventType.CANCELLED,
        stage: JobStage.ENCODING,
        progress: 40.0,
        triggeredBy: 'SYSTEM',
      });

      expect(repo.createEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          systemMessage: 'Cancelled by system at 40.0%',
        })
      );
    });

    it('should generate RESTARTED message with startedFromSeconds', async () => {
      repo.createEntry.mockResolvedValue({});

      await service.recordEvent({
        jobId: 'job-1',
        eventType: JobEventType.RESTARTED,
        stage: JobStage.QUEUED,
        progress: 0,
        startedFromSeconds: 1800,
      });

      expect(repo.createEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          systemMessage: 'Restarted from 30 minutes',
        })
      );
    });

    it('should generate RESTARTED message without startedFromSeconds', async () => {
      repo.createEntry.mockResolvedValue({});

      await service.recordEvent({
        jobId: 'job-1',
        eventType: JobEventType.RESTARTED,
        stage: JobStage.QUEUED,
        progress: 0,
      });

      expect(repo.createEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          systemMessage: 'Restarted encoding from beginning',
        })
      );
    });

    it('should generate AUTO_HEALED message with temp file preserved', async () => {
      repo.createEntry.mockResolvedValue({});

      await service.recordEvent({
        jobId: 'job-1',
        eventType: JobEventType.AUTO_HEALED,
        stage: JobStage.FAILED,
        progress: 65.0,
        wasAutoHealed: true,
        tempFileExists: true,
      });

      expect(repo.createEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          systemMessage: 'Successfully resumed from 65.0% after backend restart',
        })
      );
    });

    it('should generate AUTO_HEALED message when temp file lost', async () => {
      repo.createEntry.mockResolvedValue({});

      await service.recordEvent({
        jobId: 'job-1',
        eventType: JobEventType.AUTO_HEALED,
        stage: JobStage.FAILED,
        progress: 50.0,
        wasAutoHealed: false,
        tempFileExists: false,
      });

      expect(repo.createEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          systemMessage: 'Attempted to auto-heal but temp file was lost - restarting from 0%',
        })
      );
    });

    it('should generate BACKEND_RESTART message', async () => {
      repo.createEntry.mockResolvedValue({});

      await service.recordEvent({
        jobId: 'job-1',
        eventType: JobEventType.BACKEND_RESTART,
        stage: JobStage.ENCODING,
        progress: 80.0,
      });

      expect(repo.createEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          systemMessage: 'Encoding interrupted by backend restart at 80.0%',
        })
      );
    });

    it('should generate TIMEOUT message with ETA', async () => {
      repo.createEntry.mockResolvedValue({});

      await service.recordEvent({
        jobId: 'job-1',
        eventType: JobEventType.TIMEOUT,
        stage: JobStage.ENCODING,
        progress: 90.0,
        etaSeconds: 7200,
      });

      expect(repo.createEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          systemMessage: 'Encoding timed out after 2 hours at 90.0%',
        })
      );
    });

    it('should generate TIMEOUT message without ETA', async () => {
      repo.createEntry.mockResolvedValue({});

      await service.recordEvent({
        jobId: 'job-1',
        eventType: JobEventType.TIMEOUT,
        stage: JobStage.ENCODING,
        progress: 85.0,
      });

      expect(repo.createEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          systemMessage: 'Encoding timed out after 0 hours at 85.0%',
        })
      );
    });

    it('should generate default message for unknown event types', async () => {
      repo.createEntry.mockResolvedValue({});

      await service.recordEvent({
        jobId: 'job-1',
        eventType: 'UNKNOWN_EVENT' as JobEventType,
        stage: JobStage.ENCODING,
        progress: 25.0,
      });

      expect(repo.createEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          systemMessage: 'Event occurred at 25.0%',
        })
      );
    });

    it('should use provided systemMessage over generated one', async () => {
      repo.createEntry.mockResolvedValue({});

      await service.recordEvent({
        jobId: 'job-1',
        eventType: JobEventType.FAILED,
        stage: JobStage.ENCODING,
        progress: 50.0,
        systemMessage: 'Custom override message',
      });

      expect(repo.createEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          systemMessage: 'Custom override message',
        })
      );
    });
  });
});
