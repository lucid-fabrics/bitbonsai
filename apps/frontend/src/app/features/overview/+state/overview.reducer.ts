import { createReducer, on } from '@ngrx/store';
import type { Node } from '../../nodes/models/node.model';
import type { EnvironmentInfo } from '../../settings/models/environment-info.model';
import type { OverviewModel } from '../models/overview.model';
import { OverviewActions } from './overview.actions';

export interface OverviewState {
  data: OverviewModel | null;
  nodes: Node[];
  environmentInfo: EnvironmentInfo | null;
  isLoading: boolean;
  error: string | null;
}

export const initialState: OverviewState = {
  data: null,
  nodes: [],
  environmentInfo: null,
  isLoading: false,
  error: null,
};

export const overviewReducer = createReducer(
  initialState,

  // Load Overview
  on(OverviewActions.loadOverview, (state) => ({
    ...state,
    isLoading: true,
    error: null,
  })),
  on(OverviewActions.loadOverviewSuccess, (state, { data }) => ({
    ...state,
    data,
    isLoading: false,
  })),
  on(OverviewActions.loadOverviewFailure, (state, { error }) => ({
    ...state,
    error,
    isLoading: false,
  })),

  // Load Nodes
  on(OverviewActions.loadNodes, (state) => ({
    ...state,
    error: null,
  })),
  on(OverviewActions.loadNodesSuccess, (state, { nodes }) => ({
    ...state,
    nodes,
  })),
  on(OverviewActions.loadNodesFailure, (state, { error }) => ({
    ...state,
    error,
  })),

  // Load Environment Info
  on(OverviewActions.loadEnvironmentInfo, (state) => ({
    ...state,
    error: null,
  })),
  on(OverviewActions.loadEnvironmentInfoSuccess, (state, { environmentInfo }) => ({
    ...state,
    environmentInfo,
  })),
  on(OverviewActions.loadEnvironmentInfoFailure, (state, { error }) => ({
    ...state,
    error,
  }))
);
