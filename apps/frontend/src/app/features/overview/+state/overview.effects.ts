import { Injectable, inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { interval, of } from 'rxjs';
import { catchError, map, mergeMap, startWith, switchMap, takeUntil } from 'rxjs/operators';
import { humanizeError } from '../../../core/services/error-humanizer';
import { OverviewService } from '../services/overview.service';
import { OverviewActions } from './overview.actions';

@Injectable()
export class OverviewEffects {
  private readonly actions$ = inject(Actions);
  private readonly overviewService = inject(OverviewService);

  // Initialize overview page - load all data once
  initOverview$ = createEffect(() =>
    this.actions$.pipe(
      ofType(OverviewActions.initOverview),
      mergeMap(() => [
        OverviewActions.loadNodes(),
        OverviewActions.loadEnvironmentInfo(),
        OverviewActions.startPolling(),
      ])
    )
  );

  // Load overview data
  loadOverview$ = createEffect(() =>
    this.actions$.pipe(
      ofType(OverviewActions.loadOverview),
      switchMap(() =>
        this.overviewService.getOverview().pipe(
          map((data) => OverviewActions.loadOverviewSuccess({ data })),
          catchError((error) => of(
            OverviewActions.loadOverviewFailure({
              error: humanizeError(error, 'Could not load the overview. Retrying automatically.'),
            })
          ))
        )
      )
    )
  );

  // Load nodes
  loadNodes$ = createEffect(() =>
    this.actions$.pipe(
      ofType(OverviewActions.loadNodes),
      switchMap(() =>
        this.overviewService.getNodes().pipe(
          map((nodes) => OverviewActions.loadNodesSuccess({ nodes })),
          catchError((error) => of(
            OverviewActions.loadNodesFailure({
              error: humanizeError(error, 'Could not load your computers. Retrying automatically.'),
            })
          ))
        )
      )
    )
  );

  // Load environment info
  loadEnvironmentInfo$ = createEffect(() =>
    this.actions$.pipe(
      ofType(OverviewActions.loadEnvironmentInfo),
      switchMap(() =>
        this.overviewService.getEnvironmentInfo().pipe(
          map((environmentInfo) => OverviewActions.loadEnvironmentInfoSuccess({ environmentInfo })),
          catchError((error) =>
            of(
              OverviewActions.loadEnvironmentInfoFailure({
                error: humanizeError(error, 'Could not load system information. Retrying automatically.'),
              })
            )
          )
        )
      )
    )
  );

  // Start polling - poll every 5 seconds
  startPolling$ = createEffect(() =>
    this.actions$.pipe(
      ofType(OverviewActions.startPolling),
      switchMap(() =>
        interval(5000).pipe(
          startWith(0), // Start immediately
          mergeMap(() => [OverviewActions.loadOverview(), OverviewActions.loadNodes()]),
          takeUntil(this.actions$.pipe(ofType(OverviewActions.stopPolling)))
        )
      )
    )
  );
}
