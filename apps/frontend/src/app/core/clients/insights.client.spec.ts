import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { InsightsClient } from './insights.client';

describe('InsightsClient', () => {
  let client: InsightsClient;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [InsightsClient],
    });
    client = TestBed.inject(InsightsClient);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should be created', () => {
    expect(client).toBeTruthy();
  });

  describe('getSavingsTrend', () => {
    it('should fetch savings trend data for specified days', () => {
      const mockData = [
        { date: '2024-01-01', savingsGB: 10.5 },
        { date: '2024-01-02', savingsGB: 12.3 },
        { date: '2024-01-03', savingsGB: 15.8 },
      ];

      client.getSavingsTrend(7).subscribe((data) => {
        expect(data).toEqual(mockData);
        expect(data.length).toBe(3);
        expect(data[0].savingsGB).toBe(10.5);
      });

      const req = httpMock.expectOne('/api/v1/insights/savings?days=7');
      expect(req.request.method).toBe('GET');
      expect(req.request.params.get('days')).toBe('7');
      req.flush(mockData);
    });

    it('should fetch savings trend for 30 days', () => {
      const mockData = [{ date: '2024-01-01', savingsGB: 5.0 }];

      client.getSavingsTrend(30).subscribe((data) => {
        expect(data).toEqual(mockData);
      });

      const req = httpMock.expectOne('/api/v1/insights/savings?days=30');
      expect(req.request.params.get('days')).toBe('30');
      req.flush(mockData);
    });

    it('should handle errors when fetching savings trend', () => {
      client.getSavingsTrend(7).subscribe({
        next: () => fail('should have failed'),
        error: (error) => {
          expect(error.status).toBe(500);
        },
      });

      const req = httpMock.expectOne('/api/v1/insights/savings?days=7');
      req.flush('Error', { status: 500, statusText: 'Server Error' });
    });
  });

  describe('getCodecDistribution', () => {
    it('should fetch codec distribution data', () => {
      const mockData = [
        { codec: 'h264', count: 500, percentage: 50.0 },
        { codec: 'h265', count: 300, percentage: 30.0 },
        { codec: 'av1', count: 200, percentage: 20.0 },
      ];

      client.getCodecDistribution().subscribe((data) => {
        expect(data).toEqual(mockData);
        expect(data.length).toBe(3);
        expect(data[0].codec).toBe('h264');
        expect(data[0].count).toBe(500);
        expect(data[0].percentage).toBe(50.0);
      });

      const req = httpMock.expectOne('/api/v1/insights/codecs');
      expect(req.request.method).toBe('GET');
      req.flush(mockData);
    });

    it('should handle empty codec distribution', () => {
      const mockData: never[] = [];

      client.getCodecDistribution().subscribe((data) => {
        expect(data).toEqual(mockData);
        expect(data.length).toBe(0);
      });

      const req = httpMock.expectOne('/api/v1/insights/codecs');
      req.flush(mockData);
    });

    it('should handle errors when fetching codec distribution', () => {
      client.getCodecDistribution().subscribe({
        next: () => fail('should have failed'),
        error: (error) => {
          expect(error.status).toBe(500);
        },
      });

      const req = httpMock.expectOne('/api/v1/insights/codecs');
      req.flush('Error', { status: 500, statusText: 'Server Error' });
    });
  });

  describe('getNodePerformance', () => {
    it('should fetch node performance data', () => {
      const mockData = [
        { nodeName: 'Worker 1', jobsCompleted: 150, successRate: 98.5 },
        { nodeName: 'Worker 2', jobsCompleted: 120, successRate: 95.0 },
        { nodeName: 'Worker 3', jobsCompleted: 80, successRate: 99.2 },
      ];

      client.getNodePerformance().subscribe((data) => {
        expect(data).toEqual(mockData);
        expect(data.length).toBe(3);
        expect(data[0].nodeName).toBe('Worker 1');
        expect(data[0].jobsCompleted).toBe(150);
        expect(data[0].successRate).toBe(98.5);
      });

      const req = httpMock.expectOne('/api/v1/insights/nodes');
      expect(req.request.method).toBe('GET');
      req.flush(mockData);
    });

    it('should handle no nodes performance data', () => {
      const mockData: never[] = [];

      client.getNodePerformance().subscribe((data) => {
        expect(data).toEqual(mockData);
        expect(data.length).toBe(0);
      });

      const req = httpMock.expectOne('/api/v1/insights/nodes');
      req.flush(mockData);
    });

    it('should handle errors when fetching node performance', () => {
      client.getNodePerformance().subscribe({
        next: () => fail('should have failed'),
        error: (error) => {
          expect(error.status).toBe(500);
        },
      });

      const req = httpMock.expectOne('/api/v1/insights/nodes');
      req.flush('Error', { status: 500, statusText: 'Server Error' });
    });
  });

  describe('getStats', () => {
    it('should fetch overall insights statistics', () => {
      const mockStats = {
        totalJobsCompleted: 1000,
        totalStorageSavedGB: 250.5,
        averageSuccessRate: 97.8,
        averageThroughput: 15.3,
      };

      client.getStats().subscribe((data) => {
        expect(data).toEqual(mockStats);
        expect(data.totalJobsCompleted).toBe(1000);
        expect(data.totalStorageSavedGB).toBe(250.5);
        expect(data.averageSuccessRate).toBe(97.8);
        expect(data.averageThroughput).toBe(15.3);
      });

      const req = httpMock.expectOne('/api/v1/insights/stats');
      expect(req.request.method).toBe('GET');
      req.flush(mockStats);
    });

    it('should handle zero stats', () => {
      const mockStats = {
        totalJobsCompleted: 0,
        totalStorageSavedGB: 0,
        averageSuccessRate: 0,
        averageThroughput: 0,
      };

      client.getStats().subscribe((data) => {
        expect(data).toEqual(mockStats);
        expect(data.totalJobsCompleted).toBe(0);
      });

      const req = httpMock.expectOne('/api/v1/insights/stats');
      req.flush(mockStats);
    });

    it('should handle errors when fetching stats', () => {
      client.getStats().subscribe({
        next: () => fail('should have failed'),
        error: (error) => {
          expect(error.status).toBe(500);
        },
      });

      const req = httpMock.expectOne('/api/v1/insights/stats');
      req.flush('Error', { status: 500, statusText: 'Server Error' });
    });
  });
});
