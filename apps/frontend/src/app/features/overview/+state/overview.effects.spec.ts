import { TestBed } from '@angular/core/testing';
import { provideMockActions } from '@ngrx/effects/testing';
import type { Action } from '@ngrx/store';
import { type Observable, of, throwError } from 'rxjs';
import { OverviewClient } from '../services/overview.client';
import * as overviewActions from './overview.actions';
import { OverviewEffects } from './overview.effects';

describe('OverviewEffects', () => {
  let actions$: Observable<Action>;
  let effects: OverviewEffects;
  let service: jasmine.SpyObj<OverviewClient>;

  beforeEach(() => {
    const serviceSpy = jasmine.createSpyObj('OverviewClient', [
      'getAll',
      'getById',
      'create',
      'update',
      'delete',
    ]);

    TestBed.configureTestingModule({
      providers: [
        OverviewEffects,
        provideMockActions(() => actions$),
        { provide: OverviewClient, useValue: serviceSpy },
      ],
    });

    effects = TestBed.inject(OverviewEffects);
    service = TestBed.inject(OverviewClient) as jasmine.SpyObj<OverviewClient>;
  });

  it('should be created', () => {
    expect(effects).toBeTruthy();
  });

  describe('load data effect', () => {
    it('should return loadSuccess action on success', (done) => {
      const mockData = [{ id: '1', name: 'Test' }] as any;
      service.getAll.and.returnValue(of(mockData));

      actions$ = of(overviewActions.load());

      effects.load$.subscribe((action) => {
        expect(action.type).toBe(overviewActions.loadSuccess.type);
        expect(service.getAll).toHaveBeenCalled();
        done();
      });
    });

    it('should return loadFailure action on error', (done) => {
      const error = new Error('Load failed');
      service.getAll.and.returnValue(throwError(() => error));

      actions$ = of(overviewActions.load());

      effects.load$.subscribe((action) => {
        expect(action.type).toBe(overviewActions.loadFailure.type);
        done();
      });
    });
  });

  // TODO: Add tests for other effects (create, update, delete)
});
