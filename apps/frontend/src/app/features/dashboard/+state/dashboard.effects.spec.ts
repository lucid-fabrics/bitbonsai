import { TestBed } from '@angular/core/testing';
import { provideMockActions } from '@ngrx/effects/testing';
import type { Action } from '@ngrx/store';
import { type Observable, of, throwError } from 'rxjs';
import type { MediaStatsModel } from '../models/media-stats.model';
import { MediaStatsClient } from '../services/media-stats.client';
import * as dashboardActions from './dashboard.actions';
import { MediaStatsEffects } from './dashboard.effects';

describe('MediaStatsEffects', () => {
  let actions$: Observable<Action>;
  let effects: MediaStatsEffects;
  let service: jasmine.SpyObj<MediaStatsClient>;

  beforeEach(() => {
    const serviceSpy = jasmine.createSpyObj('MediaStatsClient', [
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
        { provide: MediaStatsClient, useValue: serviceSpy },
      ],
    });

    effects = TestBed.inject(MediaStatsEffects);
    service = TestBed.inject(MediaStatsClient) as jasmine.SpyObj<MediaStatsClient>;
  });

  it('should be created', () => {
    expect(effects).toBeTruthy();
  });

  describe('load data effect', () => {
    it('should return loadSuccess action on success', (done) => {
      const mockData: Partial<MediaStatsModel> = {
        total_size_gb: 100,
        total_files: 10,
        average_bitrate_mbps: 5.5,
        codec_distribution: { hevc: 5, h264: 3, av1: 1, other: 1 },
        folders: [],
        scan_timestamp: new Date().toISOString(),
      };
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
