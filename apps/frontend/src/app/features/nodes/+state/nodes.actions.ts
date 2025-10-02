import { createActionGroup, emptyProps, props } from '@ngrx/store';
import { Node } from '../models/node.model';
import { PairRequest, PairResponse, RegisterResponse } from '../services/nodes.client';

export const NodesActions = createActionGroup({
  source: 'Nodes',
  events: {
    'Load Nodes': emptyProps(),
    'Load Nodes Success': props<{ nodes: Node[] }>(),
    'Load Nodes Failure': props<{ error: string }>(),

    'Register Node': emptyProps(),
    'Register Node Success': props<{ response: RegisterResponse }>(),
    'Register Node Failure': props<{ error: string }>(),

    'Pair Node': props<{ request: PairRequest }>(),
    'Pair Node Success': props<{ response: PairResponse }>(),
    'Pair Node Failure': props<{ error: string }>(),

    'Delete Node': props<{ id: string }>(),
    'Delete Node Success': props<{ id: string }>(),
    'Delete Node Failure': props<{ error: string }>(),
  }
});
