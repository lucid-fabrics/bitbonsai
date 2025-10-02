import { createFeatureSelector, createSelector } from '@ngrx/store';
import { OverviewState } from './overview.reducer';

export const selectOverviewState = createFeatureSelector<OverviewState>('overview');

export const OverviewSelectors = {
  selectOverviewData: createSelector(selectOverviewState, (state) => state.data),
  selectIsLoading: createSelector(selectOverviewState, (state) => state.isLoading),
  selectError: createSelector(selectOverviewState, (state) => state.error),

  selectSystemHealth: createSelector(
    selectOverviewState,
    (state) => state.data?.system_health
  ),

  selectQueueSummary: createSelector(
    selectOverviewState,
    (state) => state.data?.queue_summary
  ),

  selectRecentActivity: createSelector(
    selectOverviewState,
    (state) => state.data?.recent_activity || []
  ),

  selectTopLibraries: createSelector(
    selectOverviewState,
    (state) => state.data?.top_libraries || []
  ),

  selectTotalQueueItems: createSelector(
    selectOverviewState,
    (state) => {
      if (!state.data) return 0;
      const queue = state.data.queue_summary;
      return queue.queued + queue.encoding + queue.completed + queue.failed;
    }
  ),
};
