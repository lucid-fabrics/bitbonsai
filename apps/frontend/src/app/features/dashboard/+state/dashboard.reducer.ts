import { createReducer, on } from '@ngrx/store';
import { MediaStatsActions } from './dashboard.actions';
import { MediaStatsBo } from '../../../core/business-objects/media-stats.bo';

export interface MediaStatsState {
  stats: MediaStatsBo | null;
  isLoading: boolean;
  error: string | null;
}

export const initialState: MediaStatsState = {
  stats: null,
  isLoading: false,
  error: null
};

export const mediaStatsReducer = createReducer(
  initialState,
  on(MediaStatsActions.loadMediaStats, (state) => ({
    ...state,
    isLoading: true,
    error: null
  })),
  on(MediaStatsActions.loadMediaStatsSuccess, (state, { stats }) => ({
    ...state,
    stats,
    isLoading: false,
    error: null
  })),
  on(MediaStatsActions.loadMediaStatsFailure, (state, { error }) => ({
    ...state,
    isLoading: false,
    error
  })),
  on(MediaStatsActions.triggerScan, (state) => ({
    ...state,
    isLoading: true,
    error: null
  })),
  on(MediaStatsActions.triggerScanSuccess, (state) => ({
    ...state,
    isLoading: false
  })),
  on(MediaStatsActions.triggerScanFailure, (state, { error }) => ({
    ...state,
    isLoading: false,
    error
  }))
);
