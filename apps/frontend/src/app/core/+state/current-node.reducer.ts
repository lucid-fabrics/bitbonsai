import { createReducer, on } from '@ngrx/store';
import type { CurrentNode } from '../../features/nodes/models/node.model';
import { CurrentNodeActions } from './current-node.actions';

export interface CurrentNodeState {
  currentNode: CurrentNode | null;
  mainNode: CurrentNode | null;
  isLoading: boolean;
  error: string | null;
}

export const initialState: CurrentNodeState = {
  currentNode: null,
  mainNode: null,
  isLoading: false,
  error: null,
};

export const currentNodeReducer = createReducer(
  initialState,

  // Load Current Node
  on(CurrentNodeActions.loadCurrentNode, (state) => ({
    ...state,
    isLoading: true,
    error: null,
  })),
  on(CurrentNodeActions.loadCurrentNodeSuccess, (state, { node }) => ({
    ...state,
    currentNode: node,
    isLoading: false,
  })),
  on(CurrentNodeActions.loadCurrentNodeFailure, (state, { error }) => ({
    ...state,
    error,
    isLoading: false,
  })),

  // Load Main Node
  on(CurrentNodeActions.loadMainNode, (state) => ({
    ...state,
    error: null,
  })),
  on(CurrentNodeActions.loadMainNodeSuccess, (state, { mainNode }) => ({
    ...state,
    mainNode,
  })),
  on(CurrentNodeActions.loadMainNodeFailure, (state, { error }) => ({
    ...state,
    error,
  }))
);
