import { Injectable, inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { of } from 'rxjs';
import { catchError, map, switchMap } from 'rxjs/operators';
import { QueueService } from '../services/queue.service';
import { QueueActions } from './queue.actions';

@Injectable()
export class QueueEffects {
  private readonly actions$ = inject(Actions);
  private readonly queueService = inject(QueueService);

  loadQueue$ = createEffect(() =>
    this.actions$.pipe(
      ofType(QueueActions.loadQueue),
      switchMap(({ filters }) =>
        this.queueService.getQueue(filters).pipe(
          map((data) => QueueActions.loadQueueSuccess({ data })),
          catchError((error) => of(QueueActions.loadQueueFailure({ error: error.message })))
        )
      )
    )
  );

  cancelJob$ = createEffect(() =>
    this.actions$.pipe(
      ofType(QueueActions.cancelJob),
      switchMap(({ jobId }) =>
        this.queueService.cancelJob(jobId).pipe(
          map(() => QueueActions.cancelJobSuccess({ jobId })),
          catchError((error) => of(QueueActions.cancelJobFailure({ error: error.message })))
        )
      )
    )
  );

  retryJob$ = createEffect(() =>
    this.actions$.pipe(
      ofType(QueueActions.retryJob),
      switchMap(({ jobId }) =>
        this.queueService.retryJob(jobId).pipe(
          map(() => QueueActions.retryJobSuccess({ jobId })),
          catchError((error) => of(QueueActions.retryJobFailure({ error: error.message })))
        )
      )
    )
  );
}
