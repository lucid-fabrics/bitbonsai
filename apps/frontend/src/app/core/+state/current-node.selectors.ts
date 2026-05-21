import { createFeatureSelector, createSelector } from '@ngrx/store';
import { NodeRole } from '../../features/nodes/models/node.model';
import type { CurrentNodeState } from './current-node.reducer';

export const selectCurrentNodeState = createFeatureSelector<CurrentNodeState>('currentNode');

// Base selectors
export const selectCurrentNode = createSelector(
  selectCurrentNodeState,
  (state) => state.currentNode
);

export const selectMainNode = createSelector(selectCurrentNodeState, (state) => state.mainNode);

export const selectIsLoading = createSelector(selectCurrentNodeState, (state) => state.isLoading);

export const selectError = createSelector(selectCurrentNodeState, (state) => state.error);

// Computed selectors
export const selectIsMainNode = createSelector(
  selectCurrentNode,
  (node) => node?.role === NodeRole.MAIN
);

export const selectIsLinkedNode = createSelector(
  selectCurrentNode,
  (node) => node?.role === NodeRole.LINKED
);

// Grouped selectors for convenience
export const CurrentNodeSelectors = {
  selectCurrentNode,
  selectMainNode,
  selectIsLoading,
  selectError,
  selectIsMainNode,
  selectIsLinkedNode,
};
