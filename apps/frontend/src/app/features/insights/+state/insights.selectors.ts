import { createFeatureSelector, createSelector } from '@ngrx/store';
import { InsightsState } from './insights.reducer';

export const selectInsightsState = createFeatureSelector<InsightsState>('insights');

export const InsightsSelectors = {
  selectSavingsTrend: createSelector(selectInsightsState, (state) => state.savingsTrend),
  selectCodecDistribution: createSelector(selectInsightsState, (state) => state.codecDistribution),
  selectNodePerformance: createSelector(selectInsightsState, (state) => state.nodePerformance),
  selectStats: createSelector(selectInsightsState, (state) => state.stats),
  selectSelectedTimeRange: createSelector(selectInsightsState, (state) => state.selectedTimeRange),
  selectIsLoading: createSelector(selectInsightsState, (state) => state.isLoading),
  selectError: createSelector(selectInsightsState, (state) => state.error),
};
