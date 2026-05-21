import { createActionGroup, emptyProps, props } from '@ngrx/store';
import type { CurrentNode } from '../../features/nodes/models/node.model';

export const CurrentNodeActions = createActionGroup({
  source: 'Current Node',
  events: {
    // Load current node
    'Load Current Node': emptyProps(),
    'Load Current Node Success': props<{ node: CurrentNode }>(),
    'Load Current Node Failure': props<{ error: string }>(),

    // Load main node (for linked nodes to display which main they're connected to)
    'Load Main Node': emptyProps(),
    'Load Main Node Success': props<{ mainNode: CurrentNode }>(),
    'Load Main Node Failure': props<{ error: string }>(),
  },
});
