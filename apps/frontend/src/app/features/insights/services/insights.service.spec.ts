import { provideHttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { InsightsClient } from '../../../core/clients/insights.client';
import { InsightsService } from './insights.service';

describe('InsightsService', () => {
  let service: InsightsService;
  let client: jest.Mocked<InsightsClient>;

  beforeEach(() => {
    const clientMock = {
      getSavingsTrend: jest.fn(),
      getCodecDistribution: jest.fn(),
      getNodePerformance: jest.fn(),
      getStats: jest.fn(),
    } as unknown as jest.Mocked<InsightsClient>;

    TestBed.configureTestingModule({
      providers: [
        InsightsService,
        { provide: InsightsClient, useValue: clientMock },
        provideHttpClient(),
      ],
    });

    service = TestBed.inject(InsightsService);
    client = TestBed.inject(InsightsClient) as jest.Mocked<InsightsClient>;
  });

  it('exposes a getStats method that returns an observable', () => {
    expect(typeof service.getStats).toBe('function');
  });

  describe('data retrieval', () => {
    it('should transform client responses to BOs', (done) => {
      const mockData = {
        totalJobsCompleted: 100,
        totalSavedGB: 50,
        successRate: 95,
        avgThroughput: 10,
      };
      client.getStats.mockReturnValue(of(mockData));

      service.getStats().subscribe((result) => {
        expect(result.totalJobsCompleted).toBe(100);
        expect(result.totalStorageSavedGB).toBe(50);
        expect(result.averageSuccessRate).toBe(95);
        expect(result.averageThroughput).toBe(10);
        expect(client.getStats).toHaveBeenCalled();
        done();
      });
    });

    it('should handle errors from client', (done) => {
      const error = new Error('Client error');
      client.getStats.mockReturnValue(throwError(() => error));

      service.getStats().subscribe({
        error: (err) => {
          expect(err).toBe(error);
          done();
        },
      });
    });
  });
});
