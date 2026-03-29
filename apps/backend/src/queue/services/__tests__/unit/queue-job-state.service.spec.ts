import { HttpService } from '@nestjs/axios';
import { Test, type TestingModule } from '@nestjs/testing';
import { NodeConfigService } from '../../../../core/services/node-config.service';
import { FfmpegService } from '../../../../encoding/ffmpeg.service';
import { PrismaService } from '../../../../prisma/prisma.service';
import { createMockPrismaService } from '../../../../testing/mock-providers';
import { FileFailureTrackingService } from '../../file-failure-tracking.service';
import { FileTransferService } from '../../file-transfer.service';
import { JobHistoryService } from '../../job-history.service';
import { QueueJobCrudService } from '../../queue-job-crud.service';
import { QueueJobStateService } from '../../queue-job-state.service';

describe('QueueJobStateService', () => {
  let service: QueueJobStateService;

  beforeEach(async () => {
    const prisma = createMockPrismaService();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QueueJobStateService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: FfmpegService,
          useValue: {
            killProcess: jest.fn(),
            pauseEncoding: jest.fn(),
            resumeEncoding: jest.fn(),
            reniceProcess: jest.fn(),
            verifyFile: jest.fn(),
          },
        },
        { provide: JobHistoryService, useValue: { recordEvent: jest.fn() } },
        {
          provide: FileTransferService,
          useValue: { cancelTransfer: jest.fn(), cleanupRemoteTempFile: jest.fn() },
        },
        {
          provide: NodeConfigService,
          useValue: { getMainApiUrl: jest.fn().mockReturnValue(null) },
        },
        {
          provide: FileFailureTrackingService,
          useValue: {
            recordFailure: jest.fn().mockResolvedValue(false),
            clearBlacklist: jest.fn(),
          },
        },
        {
          provide: QueueJobCrudService,
          useValue: { validateJobOwnership: jest.fn(), findOne: jest.fn() },
        },
        { provide: HttpService, useValue: { post: jest.fn() } },
      ],
    }).compile();
    service = module.get<QueueJobStateService>(QueueJobStateService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('categorizeError', () => {
    it('should categorize FFmpeg exit code errors', () => {
      const result = service.categorizeError('FFmpeg exit code 1');
      expect(result).toBe('FFmpeg Error Code 1');
    });
    it('should categorize file not found errors', () => {
      const result = service.categorizeError('File not found /path/to/file');
      expect(result).toBe('File Not Found');
    });
    it('should categorize timeout errors', () => {
      const result = service.categorizeError('Operation timed out');
      expect(result).toBe('Job Timeout/Stuck');
    });
    it('should categorize network errors', () => {
      const result = service.categorizeError('Connection refused');
      expect(result).toBe('Network Error');
    });
    it('should categorize disk space errors', () => {
      const result = service.categorizeError('No space left on device');
      expect(result).toBe('Disk Space Error');
    });
    it('should categorize permission errors', () => {
      const result = service.categorizeError('Permission denied');
      expect(result).toBe('Permission Error');
    });
    it('should categorize memory errors', () => {
      const result = service.categorizeError('Out of memory');
      expect(result).toBe('Memory Error');
    });
    it('should categorize codec errors', () => {
      const result = service.categorizeError('Unsupported codec');
      expect(result).toBe('Codec Error');
    });
    it('should return original for unknown', () => {
      const result = service.categorizeError('Unknown error');
      expect(result).toBe('Unknown error');
    });
  });
});
