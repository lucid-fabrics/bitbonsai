import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { JobStatus } from '../../features/queue/models/job-status.enum';
import type { QueueFilters } from '../../features/queue/models/queue-filters.model';
import type { QueueJobApiModel } from '../../features/queue/models/queue-job-api.model';
import type { QueueStats } from '../../features/queue/models/queue-stats.model';
import { QueueClient } from './queue.client';

describe('QueueClient', () => {
  let client: QueueClient;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [QueueClient],
    });
    client = TestBed.inject(QueueClient);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should be created', () => {
    expect(client).toBeTruthy();
  });

  describe('getQueue', () => {
    it('should fetch queue data without filters', () => {
      const mockJobs: QueueJobApiModel[] = [
        {
          id: '1',
          filePath: '/media/movie1.mp4',
          status: JobStatus.QUEUED,
          nodeId: 'node-1',
          nodeName: 'Worker 1',
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
          progress: 0,
          originalSize: 1073741824,
          currentSize: 1073741824,
          codec: 'h264',
        },
      ];

      const mockStats: QueueStats = {
        total: 100,
        queued: 10,
        encoding: 5,
        completed: 80,
        failed: 5,
        cancelled: 0,
      };

      client.getQueue().subscribe((response) => {
        expect(response.jobs).toBeDefined();
        expect(response.jobs.length).toBe(1);
        expect(response.stats).toEqual(mockStats);
        expect(response.stats.total).toBe(100);
      });

      const jobsReq = httpMock.expectOne('/api/v1/queue');
      expect(jobsReq.request.method).toBe('GET');
      jobsReq.flush(mockJobs);

      const statsReq = httpMock.expectOne('/api/v1/queue/stats');
      expect(statsReq.request.method).toBe('GET');
      statsReq.flush(mockStats);
    });

    it('should fetch queue data with status filter', () => {
      const filters: QueueFilters = {
        status: JobStatus.ENCODING,
      };

      const mockJobs: QueueJobApiModel[] = [
        {
          id: '2',
          filePath: '/media/movie2.mp4',
          status: JobStatus.ENCODING,
          nodeId: 'node-1',
          nodeName: 'Worker 1',
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
          progress: 50,
          originalSize: 1073741824,
          currentSize: 536870912,
          codec: 'h264',
        },
      ];

      const mockStats: QueueStats = {
        total: 100,
        queued: 10,
        encoding: 5,
        completed: 80,
        failed: 5,
        cancelled: 0,
      };

      client.getQueue(filters).subscribe((response) => {
        expect(response.jobs.length).toBe(1);
        expect(response.jobs[0].status).toBe(JobStatus.ENCODING);
      });

      const jobsReq = httpMock.expectOne(
        (req) => req.url === '/api/v1/queue' && req.params.get('stage') === JobStatus.ENCODING
      );
      expect(jobsReq.request.method).toBe('GET');
      jobsReq.flush(mockJobs);

      const statsReq = httpMock.expectOne('/api/v1/queue/stats');
      statsReq.flush(mockStats);
    });

    it('should fetch queue data with nodeId filter', () => {
      const filters: QueueFilters = {
        nodeId: 'node-1',
      };

      const mockJobs: QueueJobApiModel[] = [];
      const mockStats: QueueStats = {
        total: 0,
        queued: 0,
        encoding: 0,
        completed: 0,
        failed: 0,
        cancelled: 0,
      };

      client.getQueue(filters).subscribe();

      const jobsReq = httpMock.expectOne(
        (req) => req.url === '/api/v1/queue' && req.params.get('nodeId') === 'node-1'
      );
      expect(jobsReq.request.method).toBe('GET');
      jobsReq.flush(mockJobs);

      const statsReq = httpMock.expectOne('/api/v1/queue/stats');
      statsReq.flush(mockStats);
    });

    it('should fetch queue data with search filter', () => {
      const filters: QueueFilters = {
        search: 'movie',
      };

      const mockJobs: QueueJobApiModel[] = [];
      const mockStats: QueueStats = {
        total: 0,
        queued: 0,
        encoding: 0,
        completed: 0,
        failed: 0,
        cancelled: 0,
      };

      client.getQueue(filters).subscribe();

      const jobsReq = httpMock.expectOne(
        (req) => req.url === '/api/v1/queue' && req.params.get('search') === 'movie'
      );
      expect(jobsReq.request.method).toBe('GET');
      jobsReq.flush(mockJobs);

      const statsReq = httpMock.expectOne('/api/v1/queue/stats');
      statsReq.flush(mockStats);
    });

    it('should fetch queue data with multiple filters', () => {
      const filters: QueueFilters = {
        status: JobStatus.COMPLETED,
        nodeId: 'node-2',
        search: 'tv',
      };

      const mockJobs: QueueJobApiModel[] = [];
      const mockStats: QueueStats = {
        total: 0,
        queued: 0,
        encoding: 0,
        completed: 0,
        failed: 0,
        cancelled: 0,
      };

      client.getQueue(filters).subscribe();

      const jobsReq = httpMock.expectOne((req) => {
        return (
          req.url === '/api/v1/queue' &&
          req.params.get('stage') === JobStatus.COMPLETED &&
          req.params.get('nodeId') === 'node-2' &&
          req.params.get('search') === 'tv'
        );
      });
      jobsReq.flush(mockJobs);

      const statsReq = httpMock.expectOne('/api/v1/queue/stats');
      statsReq.flush(mockStats);
    });

    it('should transform jobs using QueueJobBo', () => {
      const mockJobs: QueueJobApiModel[] = [
        {
          id: '1',
          filePath: '/media/movie1.mp4',
          status: JobStatus.QUEUED,
          nodeId: 'node-1',
          nodeName: 'Worker 1',
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
          progress: 0,
          originalSize: 1073741824,
          currentSize: 1073741824,
          codec: 'h264',
        },
      ];

      const mockStats: QueueStats = {
        total: 1,
        queued: 1,
        encoding: 0,
        completed: 0,
        failed: 0,
        cancelled: 0,
      };

      client.getQueue().subscribe((response) => {
        expect(response.jobs[0]).toBeDefined();
        expect(response.jobs[0].id).toBe('1');
        expect(response.jobs[0].filePath).toBe('/media/movie1.mp4');
      });

      const jobsReq = httpMock.expectOne('/api/v1/queue');
      jobsReq.flush(mockJobs);

      const statsReq = httpMock.expectOne('/api/v1/queue/stats');
      statsReq.flush(mockStats);
    });

    it('should handle errors when fetching queue', (done) => {
      client.getQueue().subscribe({
        next: () => fail('should have failed'),
        error: (error) => {
          expect(error.status).toBe(500);
          // Clean up any pending requests
          const statsReqs = httpMock.match('/api/v1/queue/stats');
          statsReqs.forEach((req) => {
            if (!req.cancelled) {
              req.flush({}, { status: 500, statusText: 'Server Error' });
            }
          });
          done();
        },
      });

      const jobsReq = httpMock.expectOne('/api/v1/queue');
      jobsReq.flush('Error', { status: 500, statusText: 'Server Error' });
    });
  });

  describe('cancelJob', () => {
    it('should cancel a job', () => {
      client.cancelJob('job-1').subscribe((response) => {
        expect(response).toBeUndefined();
      });

      const req = httpMock.expectOne('/api/v1/queue/job-1/cancel');
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({});
      req.flush(null);
    });

    it('should handle errors when cancelling job', () => {
      client.cancelJob('job-999').subscribe({
        next: () => fail('should have failed'),
        error: (error) => {
          expect(error.status).toBe(404);
        },
      });

      const req = httpMock.expectOne('/api/v1/queue/job-999/cancel');
      req.flush('Not Found', { status: 404, statusText: 'Not Found' });
    });
  });

  describe('retryJob', () => {
    it('should retry a job', () => {
      client.retryJob('job-1').subscribe((response) => {
        expect(response).toBeUndefined();
      });

      const req = httpMock.expectOne('/api/v1/queue/job-1/retry');
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({});
      req.flush(null);
    });

    it('should handle errors when retrying job', () => {
      client.retryJob('job-999').subscribe({
        next: () => fail('should have failed'),
        error: (error) => {
          expect(error.status).toBe(400);
        },
      });

      const req = httpMock.expectOne('/api/v1/queue/job-999/retry');
      req.flush('Bad Request', { status: 400, statusText: 'Bad Request' });
    });
  });
});
