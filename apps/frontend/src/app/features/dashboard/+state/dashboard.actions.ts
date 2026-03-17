import { createActionGroup, emptyProps, props } from '@ngrx/store';
import type { MediaStatsBo } from '../bos/media-stats.bo';

export const MediaStatsActions = createActionGroup({
  source: 'Media Stats',
  events: {
    'Load Media Stats': emptyProps(),
    'Load Media Stats Success': props<{ stats: MediaStatsBo }>(),
    'Load Media Stats Failure': props<{ error: string }>(),
    'Trigger Scan': emptyProps(),
    'Trigger Scan Success': emptyProps(),
    'Trigger Scan Failure': props<{ error: string }>(),
  },
});
