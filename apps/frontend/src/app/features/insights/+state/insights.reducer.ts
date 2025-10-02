import { createReducer, on } from '@ngrx/store';
import {
  CodecDistributionBO,
  InsightsStatsBO,
  NodePerformanceBO,
  SavingsTrendBO,
} from '../../../core/business-objects/insights.bo';
import { InsightsActions } from './insights.actions';

export interface InsightsState {
  savingsTrend: SavingsTrendBO[];
  codecDistribution: CodecDistributionBO[];
  nodePerformance: NodePerformanceBO[];
  stats: InsightsStatsBO | null;
  selectedTimeRange: number;
  isLoading: boolean;
  error: string | null;
}

export const initialState: InsightsState = {
  savingsTrend: [],
  codecDistribution: [],
  nodePerformance: [],
  stats: null,
  selectedTimeRange: 30,
  isLoading: false,
  error: null
};

export const insightsReducer = createReducer(
  initialState,

  // Load Savings Trend
  on(InsightsActions.loadSavingsTrend, (state) => ({
    ...state,
    isLoading: true,
    error: null
  })),
  on(InsightsActions.loadSavingsTrendSuccess, (state, { data }) => ({
    ...state,
    savingsTrend: data,
    isLoading: false
  })),
  on(InsightsActions.loadSavingsTrendFailure, (state, { error }) => ({
    ...state,
    error,
    isLoading: false
  })),

  // Load Codec Distribution
  on(InsightsActions.loadCodecDistribution, (state) => ({
    ...state,
    isLoading: true,
    error: null
  })),
  on(InsightsActions.loadCodecDistributionSuccess, (state, { data }) => ({
    ...state,
    codecDistribution: data,
    isLoading: false
  })),
  on(InsightsActions.loadCodecDistributionFailure, (state, { error }) => ({
    ...state,
    error,
    isLoading: false
  })),

  // Load Node Performance
  on(InsightsActions.loadNodePerformance, (state) => ({
    ...state,
    isLoading: true,
    error: null
  })),
  on(InsightsActions.loadNodePerformanceSuccess, (state, { data }) => ({
    ...state,
    nodePerformance: data,
    isLoading: false
  })),
  on(InsightsActions.loadNodePerformanceFailure, (state, { error }) => ({
    ...state,
    error,
    isLoading: false
  })),

  // Load Stats
  on(InsightsActions.loadStats, (state) => ({
    ...state,
    isLoading: true,
    error: null
  })),
  on(InsightsActions.loadStatsSuccess, (state, { data }) => ({
    ...state,
    stats: data,
    isLoading: false
  })),
  on(InsightsActions.loadStatsFailure, (state, { error }) => ({
    ...state,
    error,
    isLoading: false
  })),

  // Update Time Range
  on(InsightsActions.updateTimeRange, (state, { days }) => ({
    ...state,
    selectedTimeRange: days
  }))
);
