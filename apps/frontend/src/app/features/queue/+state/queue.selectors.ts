import { createFeatureSelector, createSelector } from '@ngrx/store';
import { QueueState } from './queue.reducer';

export const selectQueueState = createFeatureSelector<QueueState>('queue');

export const QueueSelectors = {
  selectJobs: createSelector(selectQueueState, (state) => state.jobs),
  selectStats: createSelector(selectQueueState, (state) => state.stats),
  selectFilters: createSelector(selectQueueState, (state) => state.filters),
  selectIsLoading: createSelector(selectQueueState, (state) => state.isLoading),
  selectError: createSelector(selectQueueState, (state) => state.error),

  selectQueueData: createSelector(
    selectQueueState,
    (state) => ({
      jobs: state.jobs,
      stats: state.stats
    })
  ),

  selectAvailableNodes: createSelector(
    selectQueueState,
    (state) => [...new Set(state.jobs.map(job => job.nodeName))].sort()
  ),
};
