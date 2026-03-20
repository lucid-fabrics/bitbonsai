import { HttpService } from '@nestjs/axios';
import { BadRequestException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { type Job, JobStage } from '@prisma/client';
import { of, throwError } from 'rxjs';
import { NodeConfigService } from '../../../core/services/node-config.service';
import { JobMetricsController } from '../../controllers/job-metrics.controller';
import { type JobStatsDto } from '../../dto/job-stats.dto';
import { QueueService } from '../../queue.service';

const makeJob = (overrides: Partial<Job> = {}): Job =>
  ({
    id: 'job-1',
    fileLabel: 'movie.mkv',
    stage: JobStage.QUEUED,
    ...overrides,
  }) as unknown as Job;

const makePaginatedResponse = (jobs: Job[] = []) => ({
  jobs,
  total: jobs.length,
  page: 1,
  limit: 20,
  totalPages: 1,
});

const makeStats = (overrides: Partial<JobStatsDto> = {}): JobStatsDto => ({
  detected: 0,
  healthCheck: 0,
  needsDecision: 0,
  codecMatchCount: 0,
  queued: 5,
  transferring: 0,
  encoding: 2,
  verifying: 0,
  completed: 100,
  failed: 3,
  cancelled: 1,
  totalSavedBytes: '1073741824',
  ...overrides,
});

describe('JobMetricsController', () => {
  let controller: JobMetricsController;

  const mockQueueService = {
    findAll: jest.fn(),
    getJobStats: jest.fn(),
    getNextJob: jest.fn(),
  };

  const mockNodeConfig = {
    getMainApiUrl: jest.fn(),
  };

  const mockHttpService = {
    get: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [JobMetricsController],
      providers: [
        { provide: QueueService, useValue: mockQueueService },
        { provide: NodeConfigService, useValue: mockNodeConfig },
        { provide: HttpService, useValue: mockHttpService },
      ],
    }).compile();

    controller = module.get(JobMetricsController);

    // Default: MAIN node (no proxy)
    mockNodeConfig.getMainApiUrl.mockReturnValue(null);
  });

  // ── findAll ───────────────────────────────────────────────────────────────

  describe('findAll', () => {
    it('calls queueService.findAll with no filters on MAIN node', async () => {
      const paginated = makePaginatedResponse([makeJob()]);
      mockQueueService.findAll.mockResolvedValue(paginated);

      const result = await controller.findAll();

      expect(mockQueueService.findAll).toHaveBeenCalledWith(
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined
      );
      expect(result).toEqual(paginated);
    });

    it('passes stage and nodeId filters to queueService.findAll', async () => {
      mockQueueService.findAll.mockResolvedValue(makePaginatedResponse());

      await controller.findAll(JobStage.ENCODING, 'node-1');

      expect(mockQueueService.findAll).toHaveBeenCalledWith(
        JobStage.ENCODING,
        'node-1',
        undefined,
        undefined,
        undefined,
        undefined
      );
    });

    it('passes all query params including pagination', async () => {
      mockQueueService.findAll.mockResolvedValue(makePaginatedResponse());

      await controller.findAll(JobStage.COMPLETED, 'node-2', 'movie', 'lib-1', 2, 50);

      expect(mockQueueService.findAll).toHaveBeenCalledWith(
        JobStage.COMPLETED,
        'node-2',
        'movie',
        'lib-1',
        2,
        50
      );
    });

    it('proxies request to MAIN node when getMainApiUrl returns a URL', async () => {
      mockNodeConfig.getMainApiUrl.mockReturnValue('http://main:3100');
      const proxyData = makePaginatedResponse([makeJob()]);
      mockHttpService.get.mockReturnValue(of({ data: proxyData }));

      const result = await controller.findAll(JobStage.QUEUED);

      expect(mockQueueService.findAll).not.toHaveBeenCalled();
      expect(mockHttpService.get).toHaveBeenCalledWith(
        'http://main:3100/api/v1/queue',
        expect.objectContaining({ params: expect.objectContaining({ stage: JobStage.QUEUED }) })
      );
      expect(result).toEqual(proxyData);
    });

    it('does not include undefined params in proxy request', async () => {
      mockNodeConfig.getMainApiUrl.mockReturnValue('http://main:3100');
      mockHttpService.get.mockReturnValue(of({ data: makePaginatedResponse() }));

      await controller.findAll();

      const params = mockHttpService.get.mock.calls[0][1].params;
      expect(params).not.toHaveProperty('stage');
      expect(params).not.toHaveProperty('nodeId');
    });

    it('throws BadRequestException when proxy to MAIN fails', async () => {
      mockNodeConfig.getMainApiUrl.mockReturnValue('http://main:3100');
      mockHttpService.get.mockReturnValue(throwError(() => new Error('connection refused')));

      await expect(controller.findAll()).rejects.toThrow(BadRequestException);
    });

    it('converts page and limit to numbers in proxy params', async () => {
      mockNodeConfig.getMainApiUrl.mockReturnValue('http://main:3100');
      mockHttpService.get.mockReturnValue(of({ data: makePaginatedResponse() }));

      await controller.findAll(undefined, undefined, undefined, undefined, 3, 25);

      const params = mockHttpService.get.mock.calls[0][1].params;
      expect(params.page).toBe('3');
      expect(params.limit).toBe('25');
    });
  });

  // ── getStats ──────────────────────────────────────────────────────────────

  describe('getStats', () => {
    it('returns stats from queueService', async () => {
      const stats = makeStats({ queued: 10, encoding: 5 });
      mockQueueService.getJobStats.mockResolvedValue(stats);

      const result = await controller.getStats();

      expect(mockQueueService.getJobStats).toHaveBeenCalledWith(undefined);
      expect(result).toEqual(stats);
    });

    it('passes nodeId filter to queueService.getJobStats', async () => {
      mockQueueService.getJobStats.mockResolvedValue(makeStats());

      await controller.getStats('node-42');

      expect(mockQueueService.getJobStats).toHaveBeenCalledWith('node-42');
    });
  });

  // ── getNextJob ────────────────────────────────────────────────────────────

  describe('getNextJob', () => {
    it('returns job from queueService when available', async () => {
      const job = makeJob({ stage: JobStage.ENCODING });
      mockQueueService.getNextJob.mockResolvedValue(job);

      const result = await controller.getNextJob('node-1');

      expect(mockQueueService.getNextJob).toHaveBeenCalledWith('node-1');
      expect(result).toEqual(job);
    });

    it('returns null when no jobs are available', async () => {
      mockQueueService.getNextJob.mockResolvedValue(null);

      const result = await controller.getNextJob('node-1');

      expect(result).toBeNull();
    });
  });

  // ── getNextJobByQuery ─────────────────────────────────────────────────────

  describe('getNextJobByQuery', () => {
    it('delegates to queueService.getNextJob with query nodeId', async () => {
      const job = makeJob({ stage: JobStage.ENCODING });
      mockQueueService.getNextJob.mockResolvedValue(job);

      const result = await controller.getNextJobByQuery('node-2');

      expect(mockQueueService.getNextJob).toHaveBeenCalledWith('node-2');
      expect(result).toEqual(job);
    });

    it('returns null when no jobs available', async () => {
      mockQueueService.getNextJob.mockResolvedValue(null);

      const result = await controller.getNextJobByQuery('node-2');

      expect(result).toBeNull();
    });
  });
});
