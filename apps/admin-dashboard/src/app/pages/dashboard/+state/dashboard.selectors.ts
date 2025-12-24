import { createFeatureSelector, createSelector } from '@ngrx/store';
import { DashboardState } from './dashboard.reducer';

export const selectDashboardState = createFeatureSelector<DashboardState>('dashboard');

export const selectMetrics = createSelector(selectDashboardState, (state) => state.metrics);

export const selectLoading = createSelector(selectDashboardState, (state) => state.loading);

export const selectError = createSelector(selectDashboardState, (state) => state.error);
