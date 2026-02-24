import { Test, type TestingModule } from '@nestjs/testing';
import { JobEventType, JobStage } from '@prisma/client';
import { PrismaService } from '../../../../prisma/prisma.service';
import { createMockPrismaService } from '../../../../testing/mock-providers';
import { JobHistoryService, type RecordJobEventParams } from '../../job-history.service';

describe('JobHistoryService', () => {
  let service: JobHistoryService;
  let prisma: ReturnType<typeof createMockPrismaService>;

  beforeEach(async () => {
    prisma = createMockPrismaService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [JobHistoryService, { provide: PrismaService, useValue: prisma }],
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
      prisma.jobHistory.create.mockResolvedValue({});

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

      expect(prisma.jobHistory.create).toHaveBeenCalledWith({
        data: {
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
        },
      });
    });

    it('should use default wasAutoHealed=false when not provided', async () => {
      prisma.jobHistory.create.mockResolvedValue({});

      await service.recordEvent(baseParams);

      expect(prisma.jobHistory.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          wasAutoHealed: false,
        }),
      });
    });

    it('should generate system message when none provided', async () => {
      prisma.jobHistory.create.mockResolvedValue({});

      await service.recordEvent({
        ...baseParams,
        retryNumber: 3,
      });

      expect(prisma.jobHistory.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          systemMessage: 'Attempt #3 failed at 45.5%',
        }),
      });
    });

    it('should log recorded event', async () => {
      prisma.jobHistory.create.mockResolvedValue({});

      await service.recordEvent(baseParams);

      expect((service as any).logger.log).toHaveBeenCalledWith(
        'Recorded FAILED event for job job-1 at 45.5%'
      );
    });

    it('should handle database error gracefully', async () => {
      const error = new Error('DB write failed');
      prisma.jobHistory.create.mockRejectedValue(error);

      await service.recordEvent(baseParams);

      expect((service as any).logger.error).toHaveBeenCalledWith(
        'Failed to record job history event',
        expect.stringContaining('DB write failed')
      );
    });

    it('should handle non-Error exceptions', async () => {
      prisma.jobHistory.create.mockRejectedValue('string error');

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
      prisma.jobHistory.findMany.mockResolvedValue(mockHistory);

      const result = await service.getJobHistory('job-1');

      expect(result).toEqual(mockHistory);
      expect(prisma.jobHistory.findMany).toHaveBeenCalledWith({
        where: { jobId: 'job-1' },
        orderBy: { createdAt: 'desc' },
      });
    });

    it('should return empty array when no history exists', async () => {
      prisma.jobHistory.findMany.mockResolvedValue([]);

      const result = await service.getJobHistory('nonexistent-job');

      expect(result).toEqual([]);
    });
  });

  describe('getFailureCount', () => {
    it('should count FAILED, BACKEND_RESTART, and TIMEOUT events', async () => {
      prisma.jobHistory.count = jest.fn().mockResolvedValue(5);

      const result = await service.getFailureCount('job-1');

      expect(result).toBe(5);
      expect(prisma.jobHistory.count).toHaveBeenCalledWith({
        where: {
          jobId: 'job-1',
          eventType: {
            in: [JobEventType.FAILED, JobEventType.BACKEND_RESTART, JobEventType.TIMEOUT],
          },
        },
      });
    });

    it('should return 0 when no failure events exist', async () => {
      prisma.jobHistory.count = jest.fn().mockResolvedValue(0);

      const result = await service.getFailureCount('job-1');

      expect(result).toBe(0);
    });
  });

  describe('generateSystemMessage (private, tested via recordEvent)', () => {
    it('should generate FAILED message with retry number', async () => {
      prisma.jobHistory.create.mockResolvedValue({});

      await service.recordEvent({
        jobId: 'job-1',
        eventType: JobEventType.FAILED,
        stage: JobStage.ENCODING,
        progress: 55.3,
        retryNumber: 2,
      });

      expect(prisma.jobHistory.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          systemMessage: 'Attempt #2 failed at 55.3%',
        }),
      });
    });

    it('should generate FAILED message without retry number', async () => {
      prisma.jobHistory.create.mockResolvedValue({});

      await service.recordEvent({
        jobId: 'job-1',
        eventType: JobEventType.FAILED,
        stage: JobStage.ENCODING,
        progress: 30.0,
      });

      expect(prisma.jobHistory.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          systemMessage: 'Encoding failed at 30.0%',
        }),
      });
    });

    it('should generate CANCELLED message for user cancellation', async () => {
      prisma.jobHistory.create.mockResolvedValue({});

      await service.recordEvent({
        jobId: 'job-1',
        eventType: JobEventType.CANCELLED,
        stage: JobStage.ENCODING,
        progress: 70.0,
        triggeredBy: 'USER',
      });

      expect(prisma.jobHistory.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          systemMessage: 'Cancelled by user at 70.0%',
        }),
      });
    });

    it('should generate CANCELLED message for system cancellation', async () => {
      prisma.jobHistory.create.mockResolvedValue({});

      await service.recordEvent({
        jobId: 'job-1',
        eventType: JobEventType.CANCELLED,
        stage: JobStage.ENCODING,
        progress: 40.0,
        triggeredBy: 'SYSTEM',
      });

      expect(prisma.jobHistory.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          systemMessage: 'Cancelled by system at 40.0%',
        }),
      });
    });

    it('should generate RESTARTED message with startedFromSeconds', async () => {
      prisma.jobHistory.create.mockResolvedValue({});

      await service.recordEvent({
        jobId: 'job-1',
        eventType: JobEventType.RESTARTED,
        stage: JobStage.QUEUED,
        progress: 0,
        startedFromSeconds: 1800,
      });

      expect(prisma.jobHistory.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          systemMessage: 'Restarted from 30 minutes',
        }),
      });
    });

    it('should generate RESTARTED message without startedFromSeconds', async () => {
      prisma.jobHistory.create.mockResolvedValue({});

      await service.recordEvent({
        jobId: 'job-1',
        eventType: JobEventType.RESTARTED,
        stage: JobStage.QUEUED,
        progress: 0,
      });

      expect(prisma.jobHistory.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          systemMessage: 'Restarted encoding from beginning',
        }),
      });
    });

    it('should generate AUTO_HEALED message with temp file preserved', async () => {
      prisma.jobHistory.create.mockResolvedValue({});

      await service.recordEvent({
        jobId: 'job-1',
        eventType: JobEventType.AUTO_HEALED,
        stage: JobStage.FAILED,
        progress: 65.0,
        wasAutoHealed: true,
        tempFileExists: true,
      });

      expect(prisma.jobHistory.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          systemMessage: 'Successfully resumed from 65.0% after backend restart',
        }),
      });
    });

    it('should generate AUTO_HEALED message when temp file lost', async () => {
      prisma.jobHistory.create.mockResolvedValue({});

      await service.recordEvent({
        jobId: 'job-1',
        eventType: JobEventType.AUTO_HEALED,
        stage: JobStage.FAILED,
        progress: 50.0,
        wasAutoHealed: false,
        tempFileExists: false,
      });

      expect(prisma.jobHistory.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          systemMessage: 'Attempted to auto-heal but temp file was lost - restarting from 0%',
        }),
      });
    });

    it('should generate BACKEND_RESTART message', async () => {
      prisma.jobHistory.create.mockResolvedValue({});

      await service.recordEvent({
        jobId: 'job-1',
        eventType: JobEventType.BACKEND_RESTART,
        stage: JobStage.ENCODING,
        progress: 80.0,
      });

      expect(prisma.jobHistory.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          systemMessage: 'Encoding interrupted by backend restart at 80.0%',
        }),
      });
    });

    it('should generate TIMEOUT message with ETA', async () => {
      prisma.jobHistory.create.mockResolvedValue({});

      await service.recordEvent({
        jobId: 'job-1',
        eventType: JobEventType.TIMEOUT,
        stage: JobStage.ENCODING,
        progress: 90.0,
        etaSeconds: 7200,
      });

      expect(prisma.jobHistory.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          systemMessage: 'Encoding timed out after 2 hours at 90.0%',
        }),
      });
    });

    it('should generate TIMEOUT message without ETA', async () => {
      prisma.jobHistory.create.mockResolvedValue({});

      await service.recordEvent({
        jobId: 'job-1',
        eventType: JobEventType.TIMEOUT,
        stage: JobStage.ENCODING,
        progress: 85.0,
      });

      expect(prisma.jobHistory.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          systemMessage: 'Encoding timed out after 0 hours at 85.0%',
        }),
      });
    });

    it('should generate default message for unknown event types', async () => {
      prisma.jobHistory.create.mockResolvedValue({});

      await service.recordEvent({
        jobId: 'job-1',
        eventType: 'UNKNOWN_EVENT' as JobEventType,
        stage: JobStage.ENCODING,
        progress: 25.0,
      });

      expect(prisma.jobHistory.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          systemMessage: 'Event occurred at 25.0%',
        }),
      });
    });

    it('should use provided systemMessage over generated one', async () => {
      prisma.jobHistory.create.mockResolvedValue({});

      await service.recordEvent({
        jobId: 'job-1',
        eventType: JobEventType.FAILED,
        stage: JobStage.ENCODING,
        progress: 50.0,
        systemMessage: 'Custom override message',
      });

      expect(prisma.jobHistory.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          systemMessage: 'Custom override message',
        }),
      });
    });
  });
});
