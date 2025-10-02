import { TestBed } from '@angular/core/testing';
import { provideMockActions } from '@ngrx/effects/testing';
import { Observable, of, throwError } from 'rxjs';
import { Action } from '@ngrx/store';
import { MediaStatsEffects } from './dashboard.effects';
import * as dashboardActions from './dashboard.actions';
import { DashboardService } from '../../../core/services/dashboard.service';

describe('MediaStatsEffects', () => {
  let actions$: Observable<Action>;
  let effects: MediaStatsEffects;
  let service: jasmine.SpyObj<DashboardService>;

  beforeEach(() => {
    const serviceSpy = jasmine.createSpyObj('DashboardService', [
      'getAll',
      'getById',
      'create',
      'update',
      'delete',
    ]);

    TestBed.configureTestingModule({
      providers: [
        MediaStatsEffects,
        provideMockActions(() => actions$),
        { provide: DashboardService, useValue: serviceSpy },
      ],
    });

    effects = TestBed.inject(MediaStatsEffects);
    service = TestBed.inject(DashboardService) as jasmine.SpyObj<DashboardService>;
  });

  it('should be created', () => {
    expect(effects).toBeTruthy();
  });

  describe('load data effect', () => {
    it('should return loadSuccess action on success', (done) => {
      const mockData = [{ id: '1', name: 'Test' }] as any;
      service.getAll.and.returnValue(of(mockData));

      actions$ = of(dashboardActions.load());

      effects.load$.subscribe((action) => {
        expect(action.type).toBe(dashboardActions.loadSuccess.type);
        expect(service.getAll).toHaveBeenCalled();
        done();
      });
    });

    it('should return loadFailure action on error', (done) => {
      const error = new Error('Load failed');
      service.getAll.and.returnValue(throwError(() => error));

      actions$ = of(dashboardActions.load());

      effects.load$.subscribe((action) => {
        expect(action.type).toBe(dashboardActions.loadFailure.type);
        done();
      });
    });
  });

  // TODO: Add tests for other effects (create, update, delete)
});
