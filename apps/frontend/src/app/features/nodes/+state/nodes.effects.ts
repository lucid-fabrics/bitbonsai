import { Injectable, inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { of } from 'rxjs';
import { catchError, map, switchMap } from 'rxjs/operators';
import { humanizeError } from '../../../core/services/error-humanizer';
import { NodesService } from '../services/nodes.service';
import { NodesActions } from './nodes.actions';

@Injectable()
export class NodesEffects {
  private readonly actions$ = inject(Actions);
  private readonly nodesService = inject(NodesService);

  loadNodes$ = createEffect(() =>
    this.actions$.pipe(
      ofType(NodesActions.loadNodes),
      switchMap(() =>
        this.nodesService.getNodes().pipe(
          map((nodes) => NodesActions.loadNodesSuccess({ nodes })),
          catchError((error) => of(
            NodesActions.loadNodesFailure({
              error: humanizeError(error, 'Could not load your computers. Retrying automatically.'),
            })
          ))
        )
      )
    )
  );

  registerNode$ = createEffect(() =>
    this.actions$.pipe(
      ofType(NodesActions.registerNode),
      switchMap(() =>
        this.nodesService.register().pipe(
          map((response) => NodesActions.registerNodeSuccess({ response })),
          catchError((error) => of(
            NodesActions.registerNodeFailure({
              error: humanizeError(error, 'Could not add this computer. Please try again.'),
            })
          ))
        )
      )
    )
  );

  pairNode$ = createEffect(() =>
    this.actions$.pipe(
      ofType(NodesActions.pairNode),
      switchMap(({ request }) =>
        this.nodesService.pair(request).pipe(
          map((response) => NodesActions.pairNodeSuccess({ response })),
          catchError((error) => of(
            NodesActions.pairNodeFailure({
              error: humanizeError(error, 'Could not connect this computer. Check the pairing key and try again.'),
            })
          ))
        )
      )
    )
  );

  deleteNode$ = createEffect(() =>
    this.actions$.pipe(
      ofType(NodesActions.deleteNode),
      switchMap(({ id }) =>
        this.nodesService.deleteNode(id).pipe(
          map(() => NodesActions.deleteNodeSuccess({ id })),
          catchError((error) => of(
            NodesActions.deleteNodeFailure({
              error: humanizeError(error, 'Could not remove this computer. Please try again.'),
            })
          ))
        )
      )
    )
  );
}
