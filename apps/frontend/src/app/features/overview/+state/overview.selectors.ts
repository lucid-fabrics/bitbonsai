import { createFeatureSelector, createSelector } from '@ngrx/store';
import type { OverviewState } from './overview.reducer';

export const selectOverviewState = createFeatureSelector<OverviewState>('overview');

// Base selectors
export const selectOverviewData = createSelector(selectOverviewState, (state) => state.data);
export const selectNodes = createSelector(selectOverviewState, (state) => state.nodes);
export const selectEnvironmentInfo = createSelector(
  selectOverviewState,
  (state) => state.environmentInfo
);
export const selectIsLoading = createSelector(selectOverviewState, (state) => state.isLoading);
export const selectError = createSelector(selectOverviewState, (state) => state.error);

// Data selectors
export const selectSystemHealth = createSelector(
  selectOverviewState,
  (state) => state.data?.system_health
);

export const selectQueueSummary = createSelector(
  selectOverviewState,
  (state) => state.data?.queue_summary
);

export const selectRecentActivity = createSelector(
  selectOverviewState,
  (state) => state.data?.recent_activity || []
);

export const selectTopLibraries = createSelector(
  selectOverviewState,
  (state) => state.data?.top_libraries || []
);

// Computed selectors (replacing signal computed values)
export const selectHasData = createSelector(selectOverviewData, (data) => data !== null);

export const selectTotalQueueItems = createSelector(selectOverviewState, (state) => {
  if (!state.data) return 0;
  const queue = state.data.queue_summary;
  return queue.queued + queue.encoding + queue.completed + queue.failed;
});

export const selectMainNode = createSelector(
  selectNodes,
  (nodes) => nodes.find((n) => n.role === 'MAIN') || null
);

export const selectChildNodes = createSelector(selectNodes, (nodes) =>
  nodes.filter((n) => n.role === 'LINKED')
);

// Grouped selectors for convenience
export const OverviewSelectors = {
  selectOverviewData,
  selectNodes,
  selectEnvironmentInfo,
  selectIsLoading,
  selectError,
  selectSystemHealth,
  selectQueueSummary,
  selectRecentActivity,
  selectTopLibraries,
  selectHasData,
  selectTotalQueueItems,
  selectMainNode,
  selectChildNodes,
};
