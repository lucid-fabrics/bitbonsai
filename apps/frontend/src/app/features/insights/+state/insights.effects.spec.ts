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

  describe('load data effect', () => {
    it('should return loadSuccess action on success', (done) => {
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

    it('should return loadFailure action on error', (done) => {
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
