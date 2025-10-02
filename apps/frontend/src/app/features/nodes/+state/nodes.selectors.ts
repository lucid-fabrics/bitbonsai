import { createFeatureSelector, createSelector } from '@ngrx/store';
import { NodesState } from './nodes.reducer';
import { NodeStatus } from '../models/node.model';

export const selectNodesState = createFeatureSelector<NodesState>('nodes');

export const NodesSelectors = {
  selectAllNodes: createSelector(selectNodesState, (state) => state.nodes),
  selectRegisterResponse: createSelector(selectNodesState, (state) => state.registerResponse),
  selectIsLoading: createSelector(selectNodesState, (state) => state.isLoading),
  selectError: createSelector(selectNodesState, (state) => state.error),

  selectTotalNodes: createSelector(
    selectNodesState,
    (state) => state.nodes.length
  ),

  selectOnlineNodes: createSelector(
    selectNodesState,
    (state) => state.nodes.filter(n => n.status === NodeStatus.ONLINE).length
  ),

  selectOfflineNodes: createSelector(
    selectNodesState,
    (state) => state.nodes.filter(n => n.status === NodeStatus.OFFLINE).length
  ),

  selectNodeById: (id: string) => createSelector(
    selectNodesState,
    (state) => state.nodes.find(node => node.id === id)
  ),
};
