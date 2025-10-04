import { createReducer, on } from '@ngrx/store';
import type { OverviewModel } from '../models/overview.model';
import { OverviewActions } from './overview.actions';

export interface OverviewState {
  data: OverviewModel | null;
  isLoading: boolean;
  error: string | null;
}

export const initialState: OverviewState = {
  data: null,
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
  }))
);
