import { createActionGroup, emptyProps, props } from '@ngrx/store';
import { OverviewModel } from '../models/overview.model';

export const OverviewActions = createActionGroup({
  source: 'Overview',
  events: {
    'Load Overview': emptyProps(),
    'Load Overview Success': props<{ data: OverviewModel }>(),
    'Load Overview Failure': props<{ error: string }>(),
  }
});
