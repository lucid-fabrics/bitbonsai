import { TestBed } from '@angular/core/testing';
import { provideMockActions } from '@ngrx/effects/testing';
import type { Action } from '@ngrx/store';
import { type Observable, of, throwError } from 'rxjs';
import { InsightsService } from '../services/insights.service';
import { InsightsActions } from './insights.actions';
import { InsightsEffects } from './insights.effects';

describe('InsightsEffects', () => {
  let actions$: Observable<Action>;
  let effects: InsightsEffects;
  let service: jest.Mocked<InsightsService>;

  beforeEach(() => {
    const serviceMock = {
      getSavingsTrend: jest.fn(),
      getCodecDistribution: jest.fn(),
      getNodePerformance: jest.fn(),
      getStats: jest.fn(),
    } as unknown as jest.Mocked<InsightsService>;

    TestBed.configureTestingModule({
      providers: [
        InsightsEffects,
        provideMockActions(() => actions$),
        { provide: InsightsService, useValue: serviceMock },
      ],
    });

    effects = TestBed.inject(InsightsEffects);
    service = TestBed.inject(InsightsService) as jest.Mocked<InsightsService>;
  });

  it('should be created', () => {
    expect(effects).toBeTruthy();
  });

  describe('loadSavingsTrend$', () => {
    it('should dispatch loadSavingsTrendSuccess on success', (done) => {
      const mockData = [{ date: '2025-01-01', savingsGB: 10 }] as never;
      service.getSavingsTrend.mockReturnValue(of(mockData));

      actions$ = of(InsightsActions.loadSavingsTrend({ days: 30 }));

      effects.loadSavingsTrend$.subscribe((action) => {
        expect(action.type).toBe(InsightsActions.loadSavingsTrendSuccess.type);
        expect(service.getSavingsTrend).toHaveBeenCalledWith(30);
        done();
      });
    });

    it('should dispatch loadSavingsTrendFailure on error', (done) => {
      const error = new Error('Network error');
      service.getSavingsTrend.mockReturnValue(throwError(() => error));

      actions$ = of(InsightsActions.loadSavingsTrend({ days: 7 }));

      effects.loadSavingsTrend$.subscribe((action) => {
        expect(action.type).toBe(InsightsActions.loadSavingsTrendFailure.type);
        done();
      });
    });
  });

  describe('loadCodecDistribution$', () => {
    it('should dispatch loadCodecDistributionSuccess on success', (done) => {
      const mockData = [{ codec: 'hevc', count: 50, percentage: 50 }] as never;
      service.getCodecDistribution.mockReturnValue(of(mockData));

      actions$ = of(InsightsActions.loadCodecDistribution());

      effects.loadCodecDistribution$.subscribe((action) => {
        expect(action.type).toBe(InsightsActions.loadCodecDistributionSuccess.type);
        expect(service.getCodecDistribution).toHaveBeenCalled();
        done();
      });
    });

    it('should dispatch loadCodecDistributionFailure on error', (done) => {
      const error = new Error('API error');
      service.getCodecDistribution.mockReturnValue(throwError(() => error));

      actions$ = of(InsightsActions.loadCodecDistribution());

      effects.loadCodecDistribution$.subscribe((action) => {
        expect(action.type).toBe(InsightsActions.loadCodecDistributionFailure.type);
        done();
      });
    });
  });

  describe('loadNodePerformance$', () => {
    it('should dispatch loadNodePerformanceSuccess on success', (done) => {
      const mockData = [{ nodeId: 'n1', nodeName: 'Main', jobsCompleted: 100 }] as never;
      service.getNodePerformance.mockReturnValue(of(mockData));

      actions$ = of(InsightsActions.loadNodePerformance());

      effects.loadNodePerformance$.subscribe((action) => {
        expect(action.type).toBe(InsightsActions.loadNodePerformanceSuccess.type);
        expect(service.getNodePerformance).toHaveBeenCalled();
        done();
      });
    });

    it('should dispatch loadNodePerformanceFailure on error', (done) => {
      const error = new Error('Server unavailable');
      service.getNodePerformance.mockReturnValue(throwError(() => error));

      actions$ = of(InsightsActions.loadNodePerformance());

      effects.loadNodePerformance$.subscribe((action) => {
        expect(action.type).toBe(InsightsActions.loadNodePerformanceFailure.type);
        done();
      });
    });
  });

  describe('loadStats$', () => {
    it('should dispatch loadStatsSuccess on success', (done) => {
      const mockData = {
        totalJobsCompleted: 100,
        totalStorageSavedGB: 50,
        averageSuccessRate: 95,
        averageThroughput: 10,
      } as never;
      service.getStats.mockReturnValue(of(mockData));

      actions$ = of(InsightsActions.loadStats());

      effects.loadStats$.subscribe((action) => {
        expect(action.type).toBe(InsightsActions.loadStatsSuccess.type);
        expect(service.getStats).toHaveBeenCalled();
        done();
      });
    });

    it('should dispatch loadStatsFailure on error', (done) => {
      const error = new Error('Load failed');
      service.getStats.mockReturnValue(throwError(() => error));

      actions$ = of(InsightsActions.loadStats());

      effects.loadStats$.subscribe((action) => {
        expect(action.type).toBe(InsightsActions.loadStatsFailure.type);
        done();
      });
    });
  });
});
