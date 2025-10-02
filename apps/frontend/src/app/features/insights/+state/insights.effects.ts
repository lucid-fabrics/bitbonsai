import { Injectable, inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { of } from 'rxjs';
import { catchError, map, switchMap } from 'rxjs/operators';
import { InsightsService } from '../../../core/services/insights.service';
import { InsightsActions } from './insights.actions';

@Injectable()
export class InsightsEffects {
  private readonly actions$ = inject(Actions);
  private readonly insightsService = inject(InsightsService);

  loadSavingsTrend$ = createEffect(() =>
    this.actions$.pipe(
      ofType(InsightsActions.loadSavingsTrend),
      switchMap(({ days }) =>
        this.insightsService.getSavingsTrend(days).pipe(
          map((data) => InsightsActions.loadSavingsTrendSuccess({ data })),
          catchError((error) => of(InsightsActions.loadSavingsTrendFailure({ error: error.message })))
        )
      )
    )
  );

  loadCodecDistribution$ = createEffect(() =>
    this.actions$.pipe(
      ofType(InsightsActions.loadCodecDistribution),
      switchMap(() =>
        this.insightsService.getCodecDistribution().pipe(
          map((data) => InsightsActions.loadCodecDistributionSuccess({ data })),
          catchError((error) => of(InsightsActions.loadCodecDistributionFailure({ error: error.message })))
        )
      )
    )
  );

  loadNodePerformance$ = createEffect(() =>
    this.actions$.pipe(
      ofType(InsightsActions.loadNodePerformance),
      switchMap(() =>
        this.insightsService.getNodePerformance().pipe(
          map((data) => InsightsActions.loadNodePerformanceSuccess({ data })),
          catchError((error) => of(InsightsActions.loadNodePerformanceFailure({ error: error.message })))
        )
      )
    )
  );

  loadStats$ = createEffect(() =>
    this.actions$.pipe(
      ofType(InsightsActions.loadStats),
      switchMap(() =>
        this.insightsService.getStats().pipe(
          map((data) => InsightsActions.loadStatsSuccess({ data })),
          catchError((error) => of(InsightsActions.loadStatsFailure({ error: error.message })))
        )
      )
    )
  );
}
