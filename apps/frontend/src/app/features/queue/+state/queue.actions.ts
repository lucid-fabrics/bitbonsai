import { createActionGroup, emptyProps, props } from '@ngrx/store';
import { QueueFilters, QueueResponse } from '../models/queue.model';

export const QueueActions = createActionGroup({
  source: 'Queue',
  events: {
    'Load Queue': props<{ filters?: QueueFilters }>(),
    'Load Queue Success': props<{ data: QueueResponse }>(),
    'Load Queue Failure': props<{ error: string }>(),

    'Cancel Job': props<{ jobId: string }>(),
    'Cancel Job Success': props<{ jobId: string }>(),
    'Cancel Job Failure': props<{ error: string }>(),

    'Retry Job': props<{ jobId: string }>(),
    'Retry Job Success': props<{ jobId: string }>(),
    'Retry Job Failure': props<{ error: string }>(),

    'Update Filters': props<{ filters: QueueFilters }>(),
  }
});
