import { createReducer, on } from '@ngrx/store';
import type { Node } from '../models/node.model';
import type { RegisterResponse } from '../services/nodes.client';
import { NodesActions } from './nodes.actions';

export interface NodesState {
  nodes: Node[];
  registerResponse: RegisterResponse | null;
  isLoading: boolean;
  error: string | null;
}

export const initialState: NodesState = {
  nodes: [],
  registerResponse: null,
  isLoading: false,
  error: null,
};

export const nodesReducer = createReducer(
  initialState,

  // Load Nodes
  on(NodesActions.loadNodes, (state) => ({
    ...state,
    isLoading: true,
    error: null,
  })),
  on(NodesActions.loadNodesSuccess, (state, { nodes }) => ({
    ...state,
    nodes,
    isLoading: false,
  })),
  on(NodesActions.loadNodesFailure, (state, { error }) => ({
    ...state,
    error,
    isLoading: false,
  })),

  // Register Node
  on(NodesActions.registerNode, (state) => ({
    ...state,
    isLoading: true,
    error: null,
    registerResponse: null,
  })),
  on(NodesActions.registerNodeSuccess, (state, { response }) => ({
    ...state,
    registerResponse: response,
    isLoading: false,
  })),
  on(NodesActions.registerNodeFailure, (state, { error }) => ({
    ...state,
    error,
    isLoading: false,
  })),

  // Pair Node
  on(NodesActions.pairNode, (state) => ({
    ...state,
    isLoading: true,
    error: null,
  })),
  on(NodesActions.pairNodeSuccess, (state, { response }) => ({
    ...state,
    nodes: [...state.nodes, response.node],
    isLoading: false,
    registerResponse: null,
  })),
  on(NodesActions.pairNodeFailure, (state, { error }) => ({
    ...state,
    error,
    isLoading: false,
  })),

  // Delete Node
  on(NodesActions.deleteNode, (state) => ({
    ...state,
    isLoading: true,
    error: null,
  })),
  on(NodesActions.deleteNodeSuccess, (state, { id }) => ({
    ...state,
    nodes: state.nodes.filter((n) => n.id !== id),
    isLoading: false,
  })),
  on(NodesActions.deleteNodeFailure, (state, { error }) => ({
    ...state,
    error,
    isLoading: false,
  }))
);
