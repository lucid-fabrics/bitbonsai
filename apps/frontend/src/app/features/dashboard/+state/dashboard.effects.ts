import { Injectable, inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { of } from 'rxjs';
import { catchError, map, switchMap } from 'rxjs/operators';
import { MediaStatsService } from '../services/media-stats.service';
import { MediaStatsActions } from './dashboard.actions';

@Injectable()
export class MediaStatsEffects {
  private readonly actions$ = inject(Actions);
  private readonly mediaStatsService = inject(MediaStatsService);

  loadMediaStats$ = createEffect(() =>
    this.actions$.pipe(
      ofType(MediaStatsActions.loadMediaStats),
      switchMap(() =>
        this.mediaStatsService.getMediaStats().pipe(
          map((stats) => MediaStatsActions.loadMediaStatsSuccess({ stats })),
          catchError((error) =>
            of(MediaStatsActions.loadMediaStatsFailure({ error: error.message }))
          )
        )
      )
    )
  );

  triggerScan$ = createEffect(() =>
    this.actions$.pipe(
      ofType(MediaStatsActions.triggerScan),
      switchMap(() =>
        this.mediaStatsService.triggerScan().pipe(
          map(() => MediaStatsActions.triggerScanSuccess()),
          catchError((error) => of(MediaStatsActions.triggerScanFailure({ error: error.message })))
        )
      )
    )
  );

  reloadAfterScan$ = createEffect(() =>
    this.actions$.pipe(
      ofType(MediaStatsActions.triggerScanSuccess),
      map(() => MediaStatsActions.loadMediaStats())
    )
  );
}
