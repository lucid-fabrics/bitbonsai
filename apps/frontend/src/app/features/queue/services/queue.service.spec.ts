import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { QueueClient } from '../../../core/clients/queue.client';
import { QueueJobBo } from '../bos/queue-job.bo';
import { QueueService } from './queue.service';

function makeApiJob(overrides: Record<string, unknown> = {}) {
  return {
    id: 'job-1',
    fileName: 'video.mkv',
    filePath: '/media/video.mkv',
    libraryId: 'lib-1',
    libraryName: 'Movies',
    policyName: 'HEVC',
    status: 'QUEUED',
    progress: 0,
    originalSize: 1_000_000,
    currentSize: 1_000_000,
    sourceCodec: 'h264',
    targetCodec: 'hevc',
    nodeId: null,
    startedAt: null,
    completedAt: null,
    error: null,
    retryCount: 0,
    healthStatus: 'UNKNOWN',
    ...overrides,
  };
}

describe('QueueService', () => {
  let service: QueueService;
  let client: jest.Mocked<QueueClient>;

  beforeEach(() => {
    client = {
      getQueue: jest.fn(),
      cancelJob: jest.fn(),
      cancelAllQueued: jest.fn(),
      retryJob: jest.fn(),
      retryAllCancelled: jest.fn(),
      retryAllFailed: jest.fn(),
      recheckJob: jest.fn(),
      detectAndRequeue: jest.fn(),
      unblacklistJob: jest.fn(),
      pauseJob: jest.fn(),
      resumeJob: jest.fn(),
      forceStartJob: jest.fn(),
      clearJobs: jest.fn(),
      rebalanceJobs: jest.fn(),
      updateJobPriority: jest.fn(),
      keepOriginal: jest.fn(),
      deleteOriginal: jest.fn(),
      restoreOriginal: jest.fn(),
      deleteJob: jest.fn(),
      resolveDecision: jest.fn(),
      skipAllCodecMatch: jest.fn(),
      forceEncodeAllCodecMatch: jest.fn(),
      delegateJob: jest.fn(),
      getJobHistory: jest.fn(),
      capturePreview: jest.fn(),
      getActiveTransfers: jest.fn(),
      getTransferProgress: jest.fn(),
      cancelTransfer: jest.fn(),
    } as any;

    TestBed.configureTestingModule({
      providers: [QueueService, { provide: QueueClient, useValue: client }],
    });

    service = TestBed.inject(QueueService);
  });

  describe('getQueue', () => {
    it('transforms raw API jobs into QueueJobBo instances', (done) => {
      const raw = { jobs: [makeApiJob()], totalCount: 1 };
      client.getQueue.mockReturnValue(of(raw as any));

      service.getQueue().subscribe((result) => {
        expect(result.jobs[0]).toBeInstanceOf(QueueJobBo);
        expect(result.jobs[0].id).toBe('job-1');
        done();
      });
    });

    it('passes filters to client', () => {
      const filters = { status: 'QUEUED' as any };
      client.getQueue.mockReturnValue(of({ jobs: [], totalCount: 0 } as any));
      service.getQueue(filters).subscribe();
      expect(client.getQueue).toHaveBeenCalledWith(filters);
    });

    it('propagates API errors', (done) => {
      client.getQueue.mockReturnValue(throwError(() => new Error('network error')));
      service.getQueue().subscribe({
        error: (err) => {
          expect(err.message).toBe('network error');
          done();
        },
      });
    });
  });

  describe('cancelJob', () => {
    it('calls client with jobId and blacklist=false by default', () => {
      client.cancelJob.mockReturnValue(of(undefined));
      service.cancelJob('job-1').subscribe();
      expect(client.cancelJob).toHaveBeenCalledWith('job-1', false);
    });

    it('calls client with blacklist=true when specified', () => {
      client.cancelJob.mockReturnValue(of(undefined));
      service.cancelJob('job-1', true).subscribe();
      expect(client.cancelJob).toHaveBeenCalledWith('job-1', true);
    });

    it('propagates cancellation errors', (done) => {
      client.cancelJob.mockReturnValue(throwError(() => new Error('cancel failed')));
      service.cancelJob('job-1').subscribe({
        error: (err) => {
          expect(err.message).toBe('cancel failed');
          done();
        },
      });
    });
  });

  describe('retryJob', () => {
    it('delegates to client', () => {
      client.retryJob.mockReturnValue(of(undefined));
      service.retryJob('job-1').subscribe();
      expect(client.retryJob).toHaveBeenCalledWith('job-1');
    });
  });

  describe('recheckJob', () => {
    it('wraps response in QueueJobBo', (done) => {
      client.recheckJob.mockReturnValue(of(makeApiJob() as any));
      service.recheckJob('job-1').subscribe((result) => {
        expect(result).toBeInstanceOf(QueueJobBo);
        done();
      });
    });
  });

  describe('updateJobPriority', () => {
    it('wraps response in QueueJobBo', (done) => {
      client.updateJobPriority.mockReturnValue(of(makeApiJob() as any));
      service.updateJobPriority('job-1', 5).subscribe((result) => {
        expect(result).toBeInstanceOf(QueueJobBo);
        done();
      });
    });
  });
});
