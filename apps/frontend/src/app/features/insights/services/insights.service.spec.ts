import { provideHttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { InsightsClient } from './insights.client';
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

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('data retrieval', () => {
    it('should transform client responses to BOs', (done) => {
      const mockData = {
        totalJobsCompleted: 100,
        totalStorageSavedGB: 50,
        averageSuccessRate: 95,
        averageThroughput: 10,
      };
      client.getStats.mockReturnValue(of(mockData));

      service.getStats().subscribe((result) => {
        expect(result).toBeDefined();
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

  // TODO: Add more specific tests based on service methods
});
