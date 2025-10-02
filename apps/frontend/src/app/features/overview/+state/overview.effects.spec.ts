import { TestBed } from '@angular/core/testing';
import { provideMockActions } from '@ngrx/effects/testing';
import { Observable, of, throwError } from 'rxjs';
import { Action } from '@ngrx/store';
import { OverviewEffects } from './overview.effects';
import * as overviewActions from './overview.actions';
import { OverviewService } from '../../../core/services/overview.service';

describe('OverviewEffects', () => {
  let actions$: Observable<Action>;
  let effects: OverviewEffects;
  let service: jasmine.SpyObj<OverviewService>;

  beforeEach(() => {
    const serviceSpy = jasmine.createSpyObj('OverviewService', [
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
        { provide: OverviewService, useValue: serviceSpy },
      ],
    });

    effects = TestBed.inject(OverviewEffects);
    service = TestBed.inject(OverviewService) as jasmine.SpyObj<OverviewService>;
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
