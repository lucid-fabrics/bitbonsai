import { Injectable, inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { of } from 'rxjs';
import { catchError, map, switchMap } from 'rxjs/operators';
import { ApiService } from '../../../services/api.service';
import * as DashboardActions from './dashboard.actions';

@Injectable()
export class DashboardEffects {
  private readonly actions$ = inject(Actions);
  private readonly api = inject(ApiService);

  loadMetrics$ = createEffect(() =>
    this.actions$.pipe(
      ofType(DashboardActions.loadMetrics),
      switchMap(() =>
        this.api.getRevenueMetrics().pipe(
          map((metrics) => DashboardActions.loadMetricsSuccess({ metrics })),
          catchError((error) =>
            of(
              DashboardActions.loadMetricsFailure({
                error: error.message || 'Failed to load metrics',
              })
            )
          )
        )
      )
    )
  );
}
