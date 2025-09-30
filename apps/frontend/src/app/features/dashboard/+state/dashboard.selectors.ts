import { createFeatureSelector, createSelector } from '@ngrx/store';
import { MediaStatsState } from './dashboard.reducer';

export const selectMediaStatsState = createFeatureSelector<MediaStatsState>('mediaStats');

export const MediaStatsSelectors = {
  selectMediaStats: createSelector(selectMediaStatsState, (state) => state.stats),
  selectIsLoading: createSelector(selectMediaStatsState, (state) => state.isLoading),
  selectError: createSelector(selectMediaStatsState, (state) => state.error)
};
