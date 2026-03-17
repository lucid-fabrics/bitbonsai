import { createActionGroup, emptyProps, props } from '@ngrx/store';
import type { Node } from '../../nodes/models/node.model';
import type { EnvironmentInfo } from '../../settings/models/environment-info.model';
import type { OverviewModel } from '../models/overview.model';

export const OverviewActions = createActionGroup({
  source: 'Overview',
  events: {
    // Initialize overview page (loads all data)
    'Init Overview': emptyProps(),

    // Load overview data
    'Load Overview': emptyProps(),
    'Load Overview Success': props<{ data: OverviewModel }>(),
    'Load Overview Failure': props<{ error: string }>(),

    // Load nodes
    'Load Nodes': emptyProps(),
    'Load Nodes Success': props<{ nodes: Node[] }>(),
    'Load Nodes Failure': props<{ error: string }>(),

    // Load environment info
    'Load Environment Info': emptyProps(),
    'Load Environment Info Success': props<{ environmentInfo: EnvironmentInfo }>(),
    'Load Environment Info Failure': props<{ error: string }>(),

    // Start/stop polling
    'Start Polling': emptyProps(),
    'Stop Polling': emptyProps(),
  },
});
