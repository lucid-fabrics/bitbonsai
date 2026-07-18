import { Injectable, inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { of } from 'rxjs';
import { catchError, map, switchMap } from 'rxjs/operators';
import { humanizeError } from '../../../core/services/error-humanizer';
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
          catchError((error) => of(
            QueueActions.loadQueueFailure({
              error: humanizeError(error, 'Could not load the queue. Retrying automatically.'),
            })
          ))
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
          catchError((error) => of(
            QueueActions.cancelJobFailure({
              error: humanizeError(error, 'Could not cancel this job. Please try again.'),
            })
          ))
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
          catchError((error) => of(
            QueueActions.retryJobFailure({
              error: humanizeError(error, 'Could not retry this job. Please try again.'),
            })
          ))
        )
      )
    )
  );
}
