import { Injectable, inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { of } from 'rxjs';
import { catchError, map, switchMap } from 'rxjs/operators';
import { OverviewClient } from '../services/overview.client';
import { OverviewActions } from './overview.actions';

@Injectable()
export class OverviewEffects {
  private readonly actions$ = inject(Actions);
  private readonly overviewClient = inject(OverviewClient);

  loadOverview$ = createEffect(() =>
    this.actions$.pipe(
      ofType(OverviewActions.loadOverview),
      switchMap(() =>
        this.overviewClient.getOverview().pipe(
          map((data) => OverviewActions.loadOverviewSuccess({ data })),
          catchError((error) => of(OverviewActions.loadOverviewFailure({ error: error.message })))
        )
      )
    )
  );
}
