import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { OverviewModel } from '../../features/overview/models/overview.model';
import { OverviewClient } from './overview.client';

describe('OverviewClient', () => {
  let client: OverviewClient;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [OverviewClient],
    });
    client = TestBed.inject(OverviewClient);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should be created', () => {
    expect(client).toBeTruthy();
  });

  describe('getOverview', () => {
    it('should fetch overview data from the API', () => {
      const mockOverview: OverviewModel = {
        totalLibraries: 5,
        totalNodes: 3,
        totalJobs: 100,
        activeJobs: 10,
        completedJobs: 85,
        failedJobs: 5,
        totalStorageSaved: 52428800, // 50 MB in bytes
        systemHealth: 'healthy',
      };

      client.getOverview().subscribe((data) => {
        expect(data).toEqual(mockOverview);
        expect(data.totalLibraries).toBe(5);
        expect(data.totalNodes).toBe(3);
        expect(data.totalJobs).toBe(100);
        expect(data.activeJobs).toBe(10);
        expect(data.completedJobs).toBe(85);
        expect(data.failedJobs).toBe(5);
        expect(data.totalStorageSaved).toBe(52428800);
        expect(data.systemHealth).toBe('healthy');
      });

      const req = httpMock.expectOne('/api/v1/overview');
      expect(req.request.method).toBe('GET');
      req.flush(mockOverview);
    });

    it('should handle HTTP errors gracefully', () => {
      const errorMessage = 'Server error';

      client.getOverview().subscribe({
        next: () => fail('should have failed with 500 error'),
        error: (error) => {
          expect(error.status).toBe(500);
          expect(error.statusText).toBe('Server Error');
        },
      });

      const req = httpMock.expectOne('/api/v1/overview');
      req.flush(errorMessage, { status: 500, statusText: 'Server Error' });
    });

    it('should handle network errors', () => {
      const errorEvent = new ProgressEvent('error');

      client.getOverview().subscribe({
        next: () => fail('should have failed with network error'),
        error: (error) => {
          expect(error.error).toBe(errorEvent);
        },
      });

      const req = httpMock.expectOne('/api/v1/overview');
      req.error(errorEvent);
    });
  });
});
