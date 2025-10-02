import { TestBed } from '@angular/core/testing';
import { provideMockActions } from '@ngrx/effects/testing';
import { Observable, of, throwError } from 'rxjs';
import { Action } from '@ngrx/store';
import { InsightsEffects } from './insights.effects';
import * as insightsActions from './insights.actions';
import { InsightsService } from '../services/insights.service';

describe('InsightsEffects', () => {
  let actions$: Observable<Action>;
  let effects: InsightsEffects;
  let service: jasmine.SpyObj<InsightsService>;

  beforeEach(() => {
    const serviceSpy = jasmine.createSpyObj('InsightsService', [
      'getAll',
      'getById',
      'create',
      'update',
      'delete',
    ]);

    TestBed.configureTestingModule({
      providers: [
        InsightsEffects,
        provideMockActions(() => actions$),
        { provide: InsightsService, useValue: serviceSpy },
      ],
    });

    effects = TestBed.inject(InsightsEffects);
    service = TestBed.inject(InsightsService) as jasmine.SpyObj<InsightsService>;
  });

  it('should be created', () => {
    expect(effects).toBeTruthy();
  });

  describe('load data effect', () => {
    it('should return loadSuccess action on success', (done) => {
      const mockData = [{ id: '1', name: 'Test' }] as any;
      service.getAll.and.returnValue(of(mockData));

      actions$ = of(insightsActions.load());

      effects.load$.subscribe((action) => {
        expect(action.type).toBe(insightsActions.loadSuccess.type);
        expect(service.getAll).toHaveBeenCalled();
        done();
      });
    });

    it('should return loadFailure action on error', (done) => {
      const error = new Error('Load failed');
      service.getAll.and.returnValue(throwError(() => error));

      actions$ = of(insightsActions.load());

      effects.load$.subscribe((action) => {
        expect(action.type).toBe(insightsActions.loadFailure.type);
        done();
      });
    });
  });

  // TODO: Add tests for other effects (create, update, delete)
});
