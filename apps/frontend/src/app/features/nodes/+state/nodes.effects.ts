import { Injectable, inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { of } from 'rxjs';
import { catchError, map, switchMap } from 'rxjs/operators';
import { NodesClient } from '../services/nodes.client';
import { NodesActions } from './nodes.actions';

@Injectable()
export class NodesEffects {
  private readonly actions$ = inject(Actions);
  private readonly nodesClient = inject(NodesClient);

  loadNodes$ = createEffect(() =>
    this.actions$.pipe(
      ofType(NodesActions.loadNodes),
      switchMap(() =>
        this.nodesClient.getNodes().pipe(
          map((nodes) => NodesActions.loadNodesSuccess({ nodes })),
          catchError((error) => of(NodesActions.loadNodesFailure({ error: error.message })))
        )
      )
    )
  );

  registerNode$ = createEffect(() =>
    this.actions$.pipe(
      ofType(NodesActions.registerNode),
      switchMap(() =>
        this.nodesClient.register().pipe(
          map((response) => NodesActions.registerNodeSuccess({ response })),
          catchError((error) => of(NodesActions.registerNodeFailure({ error: error.message })))
        )
      )
    )
  );

  pairNode$ = createEffect(() =>
    this.actions$.pipe(
      ofType(NodesActions.pairNode),
      switchMap(({ request }) =>
        this.nodesClient.pair(request).pipe(
          map((response) => NodesActions.pairNodeSuccess({ response })),
          catchError((error) => of(NodesActions.pairNodeFailure({ error: error.message })))
        )
      )
    )
  );

  deleteNode$ = createEffect(() =>
    this.actions$.pipe(
      ofType(NodesActions.deleteNode),
      switchMap(({ id }) =>
        this.nodesClient.deleteNode(id).pipe(
          map(() => NodesActions.deleteNodeSuccess({ id })),
          catchError((error) => of(NodesActions.deleteNodeFailure({ error: error.message })))
        )
      )
    )
  );
}
