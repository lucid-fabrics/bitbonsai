import { createFeatureSelector, createSelector } from '@ngrx/store';
import type { PoliciesState } from './policies.reducer';

export const selectPoliciesState = createFeatureSelector<PoliciesState>('policies');

export const PoliciesSelectors = {
  selectPolicies: createSelector(selectPoliciesState, (state) => state.policies),
  selectPresets: createSelector(selectPoliciesState, (state) => state.presets),
  selectIsLoading: createSelector(selectPoliciesState, (state) => state.isLoading),
  selectError: createSelector(selectPoliciesState, (state) => state.error),
};
