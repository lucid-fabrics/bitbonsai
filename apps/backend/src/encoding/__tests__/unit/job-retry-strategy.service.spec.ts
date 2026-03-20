import { Test, type TestingModule } from '@nestjs/testing';
import { QueueService } from '../../../queue/queue.service';
import type { JobWithPolicy } from '../../encoding-file.service';
import { JobRetryStrategyService } from '../../job-retry-strategy.service';

const makeJob = (overrides: Partial<JobWithPolicy> = {}): JobWithPolicy =>
  ({
    id: 'job-1',
    retryCount: 0,
    filePath: '/videos/movie.mkv',
    ...overrides,
  }) as unknown as JobWithPolicy;

describe('JobRetryStrategyService', () => {
  let service: JobRetryStrategyService;

  const mockQueueService = {
    update: jest.fn(),
    failJob: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [JobRetryStrategyService, { provide: QueueService, useValue: mockQueueService }],
    }).compile();

    service = module.get(JobRetryStrategyService);
  });

  // ─── isNonRetriableError ───────────────────────────────────────────────────

  describe('isNonRetriableError', () => {
    it.each([
      ['non-retriable error flag', 'non-retriable error: something bad'],
      ['source file appears corrupted', 'source file appears corrupted or truncated'],
      ['could not find ref with poc', 'could not find ref with poc 12'],
      ['error submitting packet to decoder', 'error submitting packet to decoder'],
      ['invalid data found when processing input', 'invalid data found when processing input'],
      ['corrupt decoded frame', 'corrupt decoded frame in stream 0'],
      ['missing reference picture', 'missing reference picture'],
      ['moov atom not found', 'moov atom not found'],
      ['case insensitive match', 'MOOV ATOM NOT FOUND'],
    ])('returns true for: %s', (_label, message) => {
      expect(service.isNonRetriableError(message)).toBe(true);
    });

    it.each(['ECONNRESET', 'network timeout', 'some random ffmpeg error', ''])(
      'returns false for: %s',
      (message) => {
        expect(service.isNonRetriableError(message)).toBe(false);
      }
    );
  });

  // ─── isTransientError ─────────────────────────────────────────────────────

  describe('isTransientError', () => {
    it.each([
      ['ECONNRESET', 'read ECONNRESET'],
      ['ETIMEDOUT', 'connect ETIMEDOUT'],
      ['ENOTFOUND', 'getaddrinfo ENOTFOUND host'],
      ['ECONNREFUSED', 'connect ECONNREFUSED 127.0.0.1:3000'],
      ['temporarily unavailable', 'resource temporarily unavailable'],
      ['network', 'network error occurred'],
      ['case insensitive', 'Network error'],
    ])('returns true for: %s', (_label, message) => {
      expect(service.isTransientError(message)).toBe(true);
    });

    it.each(['codec not found', 'moov atom not found', 'corrupt decoded frame', ''])(
      'returns false for: %s',
      (message) => {
        expect(service.isTransientError(message)).toBe(false);
      }
    );
  });

  // ─── handleJobFailure ─────────────────────────────────────────────────────

  describe('handleJobFailure', () => {
    describe('transient errors - retry path', () => {
      it('schedules retry on first attempt with 1 minute delay', async () => {
        const job = makeJob({ retryCount: 0 });
        const error = new Error('read ECONNRESET');

        const before = Date.now();
        await service.handleJobFailure(job, error);
        const after = Date.now();

        expect(mockQueueService.update).toHaveBeenCalledWith(
          'job-1',
          expect.objectContaining({
            stage: 'QUEUED',
            progress: 0,
            retryCount: 1,
            error: expect.stringContaining('Attempt 1/3 failed'),
          })
        );

        const call = mockQueueService.update.mock.calls[0][1];
        const nextRetryMs = call.nextRetryAt.getTime();
        // 1 minute = 60_000 ms delay (2^0 × 60)
        expect(nextRetryMs).toBeGreaterThanOrEqual(before + 60_000);
        expect(nextRetryMs).toBeLessThanOrEqual(after + 60_000 + 50);
      });

      it('schedules retry on second attempt with 2 minute delay', async () => {
        const job = makeJob({ retryCount: 1 });
        const error = new Error('ETIMEDOUT');

        const before = Date.now();
        await service.handleJobFailure(job, error);

        expect(mockQueueService.update).toHaveBeenCalledWith(
          'job-1',
          expect.objectContaining({
            retryCount: 2,
            error: expect.stringContaining('Attempt 2/3 failed'),
          })
        );

        const call = mockQueueService.update.mock.calls[0][1];
        const nextRetryMs = call.nextRetryAt.getTime();
        // 2 minutes = 120_000 ms delay (2^1 × 60)
        expect(nextRetryMs).toBeGreaterThanOrEqual(before + 120_000);
      });

      it('schedules retry on third attempt with 4 minute delay', async () => {
        const job = makeJob({ retryCount: 2 });
        const error = new Error('network error');

        const before = Date.now();
        await service.handleJobFailure(job, error);

        expect(mockQueueService.update).toHaveBeenCalledWith(
          'job-1',
          expect.objectContaining({
            retryCount: 3,
            error: expect.stringContaining('Attempt 3/3 failed'),
          })
        );

        const call = mockQueueService.update.mock.calls[0][1];
        const nextRetryMs = call.nextRetryAt.getTime();
        // 4 minutes = 240_000 ms delay (2^2 × 60)
        expect(nextRetryMs).toBeGreaterThanOrEqual(before + 240_000);
      });

      it('permanently fails after MAX_RETRIES exceeded', async () => {
        const job = makeJob({ retryCount: 3 }); // 4th failure
        const error = new Error('ECONNRESET');

        await service.handleJobFailure(job, error);

        expect(mockQueueService.update).not.toHaveBeenCalled();
        expect(mockQueueService.failJob).toHaveBeenCalledWith(
          'job-1',
          expect.stringContaining('All 3 retry attempts exhausted')
        );
      });
    });

    describe('non-retriable errors', () => {
      it('permanently fails without retrying for corrupted source', async () => {
        const job = makeJob({ retryCount: 0 });
        const error = new Error('moov atom not found');

        await service.handleJobFailure(job, error);

        expect(mockQueueService.update).not.toHaveBeenCalled();
        expect(mockQueueService.failJob).toHaveBeenCalledWith(
          'job-1',
          expect.stringContaining('Non-retriable error (corrupted source file)')
        );
      });

      it('permanently fails for corrupt decoded frame regardless of retry count', async () => {
        const job = makeJob({ retryCount: 0 });
        const error = new Error('corrupt decoded frame in stream 0');

        await service.handleJobFailure(job, error);

        expect(mockQueueService.failJob).toHaveBeenCalled();
        expect(mockQueueService.update).not.toHaveBeenCalled();
      });
    });

    describe('non-transient, non-corrupted errors', () => {
      it('permanently fails for errors that are neither transient nor non-retriable', async () => {
        const job = makeJob({ retryCount: 0 });
        const error = new Error('codec not supported');

        await service.handleJobFailure(job, error);

        expect(mockQueueService.update).not.toHaveBeenCalled();
        expect(mockQueueService.failJob).toHaveBeenCalledWith(
          'job-1',
          expect.stringContaining('Non-retriable error after 1 attempt(s)')
        );
      });
    });

    describe('error handling', () => {
      it('accepts string errors (non-Error objects)', async () => {
        const job = makeJob({ retryCount: 0 });

        await service.handleJobFailure(job, 'ECONNRESET string error');

        expect(mockQueueService.update).toHaveBeenCalled();
      });

      it('handles null retryCount (treats as 0)', async () => {
        const job = makeJob({ retryCount: null as unknown as number });
        const error = new Error('ECONNRESET');

        await service.handleJobFailure(job, error);

        expect(mockQueueService.update).toHaveBeenCalledWith(
          'job-1',
          expect.objectContaining({ retryCount: 1 })
        );
      });

      it('does not throw if queueService.update throws', async () => {
        const job = makeJob({ retryCount: 0 });
        const error = new Error('ECONNRESET');
        mockQueueService.update.mockRejectedValueOnce(new Error('DB connection lost'));

        await expect(service.handleJobFailure(job, error)).resolves.toBeUndefined();
      });

      it('does not throw if queueService.failJob throws', async () => {
        const job = makeJob({ retryCount: 0 });
        const error = new Error('moov atom not found');
        mockQueueService.failJob.mockRejectedValueOnce(new Error('DB error'));

        await expect(service.handleJobFailure(job, error)).resolves.toBeUndefined();
      });
    });
  });
});
