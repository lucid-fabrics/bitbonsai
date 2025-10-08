import { TestBed } from '@angular/core/testing';
import { provideMockActions } from '@ngrx/effects/testing';
import type { Action } from '@ngrx/store';
import { type Observable, of, throwError } from 'rxjs';
import { OverviewClient } from '../services/overview.client';
import { OverviewActions } from './overview.actions';
import { OverviewEffects } from './overview.effects';

describe('OverviewEffects', () => {
  let actions$: Observable<Action>;
  let effects: OverviewEffects;
  let service: jest.Mocked<OverviewClient>;

  beforeEach(() => {
    const serviceSpy = {
      getOverview: jest.fn(),
    } as jest.Mocked<OverviewClient>;

    TestBed.configureTestingModule({
      providers: [
        OverviewEffects,
        provideMockActions(() => actions$),
        { provide: OverviewClient, useValue: serviceSpy },
      ],
    });

    effects = TestBed.inject(OverviewEffects);
    service = TestBed.inject(OverviewClient) as jest.Mocked<OverviewClient>;
  });

  it('should be created', () => {
    expect(effects).toBeTruthy();
  });

  describe('load data effect', () => {
    it('should return loadSuccess action on success', (done) => {
      const mockData = { system_health: {}, queue_summary: {} } as never;
      service.getOverview.mockReturnValue(of(mockData));

      actions$ = of(OverviewActions.loadOverview());

      effects.loadOverview$.subscribe((action) => {
        expect(action.type).toBe(OverviewActions.loadOverviewSuccess.type);
        expect(service.getOverview).toHaveBeenCalled();
        done();
      });
    });

    it('should return loadFailure action on error', (done) => {
      const error = new Error('Load failed');
      service.getOverview.mockReturnValue(throwError(() => error));

      actions$ = of(OverviewActions.loadOverview());

      effects.loadOverview$.subscribe((action) => {
        expect(action.type).toBe(OverviewActions.loadOverviewFailure.type);
        done();
      });
    });
  });
});
