import { TestBed } from '@angular/core/testing';
import { provideMockActions } from '@ngrx/effects/testing';
import type { Action } from '@ngrx/store';
import { type Observable, of, throwError } from 'rxjs';
import { MediaStatsService } from '../services/media-stats.service';
import { MediaStatsActions } from './dashboard.actions';
import { MediaStatsEffects } from './dashboard.effects';

describe('MediaStatsEffects', () => {
  let actions$: Observable<Action>;
  let effects: MediaStatsEffects;
  let service: jest.Mocked<MediaStatsService>;

  beforeEach(() => {
    const serviceMock = {
      getMediaStats: jest.fn(),
      triggerScan: jest.fn(),
    } as unknown as jest.Mocked<MediaStatsService>;

    TestBed.configureTestingModule({
      providers: [
        MediaStatsEffects,
        provideMockActions(() => actions$),
        { provide: MediaStatsService, useValue: serviceMock },
      ],
    });

    effects = TestBed.inject(MediaStatsEffects);
    service = TestBed.inject(MediaStatsService) as jest.Mocked<MediaStatsService>;
  });

  it('should be created', () => {
    expect(effects).toBeTruthy();
  });

  describe('load data effect', () => {
    it('should return loadSuccess action on success', (done) => {
      const mockData = {
        total_size_gb: 100,
        total_files: 10,
        average_bitrate_mbps: 5.5,
        codec_distribution: { hevc: 5, h264: 3, av1: 1, other: 1 },
        folders: [],
        scan_timestamp: new Date().toISOString(),
      } as never;
      service.getMediaStats.mockReturnValue(of(mockData));

      actions$ = of(MediaStatsActions.loadMediaStats());

      effects.loadMediaStats$.subscribe((action) => {
        expect(action.type).toBe(MediaStatsActions.loadMediaStatsSuccess.type);
        expect(service.getMediaStats).toHaveBeenCalled();
        done();
      });
    });

    it('should return loadFailure action on error', (done) => {
      const error = new Error('Load failed');
      service.getMediaStats.mockReturnValue(throwError(() => error));

      actions$ = of(MediaStatsActions.loadMediaStats());

      effects.loadMediaStats$.subscribe((action) => {
        expect(action.type).toBe(MediaStatsActions.loadMediaStatsFailure.type);
        done();
      });
    });
  });
});
