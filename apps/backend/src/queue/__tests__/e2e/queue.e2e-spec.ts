import { HttpService } from '@nestjs/axios';
import { type INestApplication, NotFoundException, ValidationPipe } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { type Job } from '@prisma/client';
import request from 'supertest';
import { JwtAuthGuard } from '../../../auth/guards/jwt-auth.guard';
import { NodeConfigService } from '../../../core/services/node-config.service';
import { JobController } from '../../controllers/job.controller';
import { JobMetricsController } from '../../controllers/job-metrics.controller';
import { QueueService } from '../../queue.service';
import { JobHistoryService } from '../../services/job-history.service';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makeJob = (overrides: Partial<Job> = {}): Job =>
  ({
    id: 'job-1',
    nodeId: 'node-1',
    libraryId: 'lib-1',
    policyId: 'pol-1',
    filePath: '/media/movie.mkv',
    fileLabel: 'movie.mkv',
    sourceCodec: 'H.264',
    targetCodec: 'HEVC',
    stage: 'QUEUED',
    progress: 0,
    isBlacklisted: false,
    beforeSizeBytes: '1000000000',
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    ...overrides,
  }) as unknown as Job;

// ---------------------------------------------------------------------------
// Mock services
// ---------------------------------------------------------------------------

const mockQueueService = {
  findAll: jest.fn(),
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
  getJobStats: jest.fn(),
  cancelAllQueued: jest.fn(),
};

const mockJobHistoryService = {
  getJobHistory: jest.fn(),
};

const mockNodeConfig = {
  getNodeId: jest.fn().mockReturnValue('node-1'),
  isMainNode: jest.fn().mockReturnValue(true),
  getMainApiUrl: jest.fn().mockReturnValue(null),
};

const mockHttpService = {
  get: jest.fn(),
  post: jest.fn(),
};

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('Queue HTTP endpoints (E2E — mocked services)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [JobController, JobMetricsController],
      providers: [
        { provide: QueueService, useValue: mockQueueService },
        { provide: JobHistoryService, useValue: mockJobHistoryService },
        { provide: NodeConfigService, useValue: mockNodeConfig },
        { provide: HttpService, useValue: mockHttpService },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    // Restore default mock values after each clear
    mockNodeConfig.getNodeId.mockReturnValue('node-1');
    mockNodeConfig.isMainNode.mockReturnValue(true);
    mockNodeConfig.getMainApiUrl.mockReturnValue(null);
  });

  // -------------------------------------------------------------------------
  // GET /queue — paginated jobs list
  // -------------------------------------------------------------------------
  describe('GET /queue', () => {
    it('returns 200 with paginated jobs list', async () => {
      const jobs = [makeJob(), makeJob({ id: 'job-2', filePath: '/media/show.mkv' })];
      mockQueueService.findAll.mockResolvedValue({
        jobs,
        total: 2,
        page: 1,
        limit: 20,
        totalPages: 1,
      });

      const res = await request(app.getHttpServer()).get('/queue').expect(200);

      expect(res.body.jobs).toHaveLength(2);
      expect(res.body.total).toBe(2);
      expect(mockQueueService.findAll).toHaveBeenCalled();
    });

    it('filters by stage query param', async () => {
      mockQueueService.findAll.mockResolvedValue({
        jobs: [makeJob({ stage: 'ENCODING' })],
        total: 1,
        page: 1,
        limit: 20,
        totalPages: 1,
      });

      const res = await request(app.getHttpServer()).get('/queue?stage=ENCODING').expect(200);

      expect(res.body.jobs[0].stage).toBe('ENCODING');
      const [stage] = mockQueueService.findAll.mock.calls[0];
      expect(stage).toBe('ENCODING');
    });

    it('returns 200 with empty list when no jobs exist', async () => {
      mockQueueService.findAll.mockResolvedValue({
        jobs: [],
        total: 0,
        page: 1,
        limit: 20,
        totalPages: 0,
      });

      const res = await request(app.getHttpServer()).get('/queue').expect(200);

      expect(res.body.jobs).toHaveLength(0);
      expect(res.body.total).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // GET /queue/:id — single job
  // -------------------------------------------------------------------------
  describe('GET /queue/:id', () => {
    it('returns 200 with the job when found', async () => {
      const job = makeJob();
      mockQueueService.findOne.mockResolvedValue(job);

      const res = await request(app.getHttpServer()).get('/queue/job-1').expect(200);

      expect(res.body.id).toBe('job-1');
      expect(mockQueueService.findOne).toHaveBeenCalledWith('job-1');
    });

    it('returns 404 when job does not exist', async () => {
      mockQueueService.findOne.mockRejectedValue(new NotFoundException('Job not found'));

      await request(app.getHttpServer()).get('/queue/missing-id').expect(404);
    });
  });

  // -------------------------------------------------------------------------
  // PATCH /queue/:id — update job
  // -------------------------------------------------------------------------
  describe('PATCH /queue/:id', () => {
    it('returns 200 and updated job for main node', async () => {
      const job = makeJob({ nodeId: 'node-1' });
      const updated = makeJob({ progress: 50 });
      mockQueueService.findOne.mockResolvedValue(job);
      mockQueueService.update.mockResolvedValue(updated);

      const res = await request(app.getHttpServer())
        .patch('/queue/job-1')
        .send({ progress: 50 })
        .expect(200);

      expect(res.body.progress).toBe(50);
    });

    it('returns 404 when job not found during update', async () => {
      mockQueueService.findOne.mockRejectedValue(new NotFoundException('Job not found'));

      await request(app.getHttpServer())
        .patch('/queue/missing-id')
        .send({ progress: 30 })
        .expect(404);
    });

    it('returns 403 when non-owner node tries to update', async () => {
      mockNodeConfig.isMainNode.mockReturnValue(false);
      mockNodeConfig.getNodeId.mockReturnValue('node-other');
      mockQueueService.findOne.mockResolvedValue(makeJob({ nodeId: 'node-1' }));

      await request(app.getHttpServer()).patch('/queue/job-1').send({ progress: 10 }).expect(403);
    });
  });

  // -------------------------------------------------------------------------
  // DELETE /queue/:id — delete job
  // -------------------------------------------------------------------------
  describe('DELETE /queue/:id', () => {
    it('returns 204 on successful deletion', async () => {
      mockQueueService.remove.mockResolvedValue(undefined);

      await request(app.getHttpServer()).delete('/queue/job-1').expect(204);

      expect(mockQueueService.remove).toHaveBeenCalledWith('job-1');
    });

    it('returns 404 when job to delete does not exist', async () => {
      mockQueueService.remove.mockRejectedValue(new NotFoundException('Job not found'));

      await request(app.getHttpServer()).delete('/queue/missing-id').expect(404);
    });
  });

  // -------------------------------------------------------------------------
  // POST /queue/:id/cancel — cancel encoding
  // -------------------------------------------------------------------------
  describe('POST /queue/:id/cancel', () => {
    it('returns 200 with cancelled job', async () => {
      const cancelled = makeJob({ stage: 'CANCELLED' });
      mockQueueService.cancelJob.mockResolvedValue(cancelled);

      const res = await request(app.getHttpServer())
        .post('/queue/job-1/cancel')
        .send({ blacklist: false })
        .expect(201);

      expect(res.body.stage).toBe('CANCELLED');
      expect(mockQueueService.cancelJob).toHaveBeenCalledWith('job-1', false);
    });

    it('cancels and blacklists when blacklist=true', async () => {
      const cancelled = makeJob({ stage: 'CANCELLED', isBlacklisted: true });
      mockQueueService.cancelJob.mockResolvedValue(cancelled);

      const res = await request(app.getHttpServer())
        .post('/queue/job-1/cancel')
        .send({ blacklist: true })
        .expect(201);

      expect(res.body.isBlacklisted).toBe(true);
      expect(mockQueueService.cancelJob).toHaveBeenCalledWith('job-1', true);
    });

    it('returns 404 when job to cancel does not exist', async () => {
      mockQueueService.cancelJob.mockRejectedValue(new NotFoundException('Job not found'));

      await request(app.getHttpServer())
        .post('/queue/missing-id/cancel')
        .send({ blacklist: false })
        .expect(404);
    });
  });

  // -------------------------------------------------------------------------
  // POST /queue/:id/complete
  // -------------------------------------------------------------------------
  describe('POST /queue/:id/complete', () => {
    it('returns 201 with completed job', async () => {
      const completed = makeJob({ stage: 'COMPLETED' });
      mockQueueService.completeJob.mockResolvedValue(completed);

      const res = await request(app.getHttpServer())
        .post('/queue/job-1/complete')
        .send({ afterSizeBytes: '800000000', savedBytes: '200000000', savedPercent: 20 })
        .expect(201);

      expect(res.body.stage).toBe('COMPLETED');
    });
  });

  // -------------------------------------------------------------------------
  // POST /queue/:id/fail
  // -------------------------------------------------------------------------
  describe('POST /queue/:id/fail', () => {
    it('returns 201 with failed job', async () => {
      const failed = makeJob({ stage: 'FAILED' });
      mockQueueService.failJob.mockResolvedValue(failed);

      const res = await request(app.getHttpServer())
        .post('/queue/job-1/fail')
        .send({ error: 'FFmpeg exit code 1' })
        .expect(201);

      expect(res.body.stage).toBe('FAILED');
      expect(mockQueueService.failJob).toHaveBeenCalledWith('job-1', 'FFmpeg exit code 1');
    });
  });

  // -------------------------------------------------------------------------
  // POST /queue/:id/retry
  // -------------------------------------------------------------------------
  describe('POST /queue/:id/retry', () => {
    it('returns 201 with requeued job', async () => {
      const requeued = makeJob({ stage: 'QUEUED' });
      mockQueueService.retryJob.mockResolvedValue(requeued);

      const res = await request(app.getHttpServer()).post('/queue/job-1/retry').expect(201);

      expect(res.body.stage).toBe('QUEUED');
      expect(mockQueueService.retryJob).toHaveBeenCalledWith('job-1');
    });
  });

  // -------------------------------------------------------------------------
  // GET /queue/:id/history
  // -------------------------------------------------------------------------
  describe('GET /queue/:id/history', () => {
    it('returns 200 with job history timeline', async () => {
      const job = makeJob();
      const history = [
        { id: 'h1', eventType: 'FAILED', progress: 45.3, createdAt: new Date().toISOString() },
      ];
      mockQueueService.findOne.mockResolvedValue(job);
      mockJobHistoryService.getJobHistory.mockResolvedValue(history);

      const res = await request(app.getHttpServer()).get('/queue/job-1/history').expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body[0].eventType).toBe('FAILED');
    });

    it('returns 404 when job not found for history', async () => {
      mockQueueService.findOne.mockRejectedValue(new NotFoundException('Job not found'));

      await request(app.getHttpServer()).get('/queue/missing-id/history').expect(404);
    });
  });
});
