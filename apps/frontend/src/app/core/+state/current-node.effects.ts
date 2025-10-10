import { Injectable, inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { of } from 'rxjs';
import { catchError, map, switchMap } from 'rxjs/operators';
import { NodeService } from '../services/node.service';
import { CurrentNodeActions } from './current-node.actions';

@Injectable()
export class CurrentNodeEffects {
  private readonly actions$ = inject(Actions);
  private readonly nodeService = inject(NodeService);

  // Load current node
  loadCurrentNode$ = createEffect(() =>
    this.actions$.pipe(
      ofType(CurrentNodeActions.loadCurrentNode),
      switchMap(() =>
        this.nodeService.getCurrentNode().pipe(
          map((node) => CurrentNodeActions.loadCurrentNodeSuccess({ node })),
          catchError((error) =>
            of(CurrentNodeActions.loadCurrentNodeFailure({ error: error.message }))
          )
        )
      )
    )
  );

  // Load main node (for linked nodes)
  loadMainNode$ = createEffect(() =>
    this.actions$.pipe(
      ofType(CurrentNodeActions.loadMainNode),
      switchMap(() =>
        this.nodeService.getMainNode().pipe(
          map((mainNode) => CurrentNodeActions.loadMainNodeSuccess({ mainNode })),
          catchError((error) =>
            of(CurrentNodeActions.loadMainNodeFailure({ error: error.message }))
          )
        )
      )
    )
  );
}
