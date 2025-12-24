import { createReducer, on } from '@ngrx/store';
import { RevenueMetrics } from '../../../services/api.service';
import * as DashboardActions from './dashboard.actions';

export interface DashboardState {
  metrics: RevenueMetrics | null;
  loading: boolean;
  error: string | null;
}

export const initialState: DashboardState = {
  metrics: null,
  loading: false,
  error: null,
};

export const dashboardReducer = createReducer(
  initialState,
  on(DashboardActions.loadMetrics, (state) => ({
    ...state,
    loading: true,
    error: null,
  })),
  on(DashboardActions.loadMetricsSuccess, (state, { metrics }) => ({
    ...state,
    metrics,
    loading: false,
    error: null,
  })),
  on(DashboardActions.loadMetricsFailure, (state, { error }) => ({
    ...state,
    loading: false,
    error,
  }))
);
