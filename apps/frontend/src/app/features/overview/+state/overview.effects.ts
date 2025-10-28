import { Injectable, inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { interval, of } from 'rxjs';
import { catchError, map, mergeMap, startWith, switchMap, takeUntil } from 'rxjs/operators';
import { NodesClient } from '../../../core/clients/nodes.client';
import { OverviewClient } from '../../../core/clients/overview.client';
import { SettingsService } from '../../settings/services/settings.service';
import { OverviewActions } from './overview.actions';

@Injectable()
export class OverviewEffects {
  private readonly actions$ = inject(Actions);
  private readonly overviewClient = inject(OverviewClient);
  private readonly nodesClient = inject(NodesClient);
  private readonly settingsService = inject(SettingsService);

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
        this.overviewClient.getOverview().pipe(
          map((data) => OverviewActions.loadOverviewSuccess({ data })),
          catchError((error) => of(OverviewActions.loadOverviewFailure({ error: error.message })))
        )
      )
    )
  );

  // Load nodes
  loadNodes$ = createEffect(() =>
    this.actions$.pipe(
      ofType(OverviewActions.loadNodes),
      switchMap(() =>
        this.nodesClient.getNodes().pipe(
          map((nodes) => OverviewActions.loadNodesSuccess({ nodes })),
          catchError((error) => of(OverviewActions.loadNodesFailure({ error: error.message })))
        )
      )
    )
  );

  // Load environment info
  loadEnvironmentInfo$ = createEffect(() =>
    this.actions$.pipe(
      ofType(OverviewActions.loadEnvironmentInfo),
      switchMap(() =>
        this.settingsService.getEnvironmentInfo().pipe(
          map((environmentInfo) => OverviewActions.loadEnvironmentInfoSuccess({ environmentInfo })),
          catchError((error) =>
            of(OverviewActions.loadEnvironmentInfoFailure({ error: error.message }))
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
