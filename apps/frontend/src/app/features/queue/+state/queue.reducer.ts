import { createReducer, on } from '@ngrx/store';
import type { QueueFilters } from '../models/queue-filters.model';
import type { QueueJob } from '../models/queue-job.model';
import type { QueueStats } from '../models/queue-stats.model';
import { QueueActions } from './queue.actions';

export interface QueueState {
  jobs: QueueJob[];
  stats: QueueStats | null;
  filters: QueueFilters;
  isLoading: boolean;
  error: string | null;
}

export const initialState: QueueState = {
  jobs: [],
  stats: null,
  filters: {},
  isLoading: false,
  error: null,
};

export const queueReducer = createReducer(
  initialState,

  // Load Queue
  on(QueueActions.loadQueue, (state, { filters }) => ({
    ...state,
    filters: filters || state.filters,
    isLoading: true,
    error: null,
  })),
  on(QueueActions.loadQueueSuccess, (state, { data }) => ({
    ...state,
    jobs: data.jobs,
    stats: data.stats,
    isLoading: false,
  })),
  on(QueueActions.loadQueueFailure, (state, { error }) => ({
    ...state,
    error,
    isLoading: false,
  })),

  // Cancel Job
  on(QueueActions.cancelJob, (state) => ({
    ...state,
    isLoading: true,
    error: null,
  })),
  on(QueueActions.cancelJobSuccess, (state, { jobId }) => ({
    ...state,
    jobs: state.jobs.map((job) =>
      job.id === jobId ? { ...job, status: 'CANCELLED' as const } : job
    ),
    isLoading: false,
  })),
  on(QueueActions.cancelJobFailure, (state, { error }) => ({
    ...state,
    error,
    isLoading: false,
  })),

  // Retry Job
  on(QueueActions.retryJob, (state) => ({
    ...state,
    isLoading: true,
    error: null,
  })),
  on(QueueActions.retryJobSuccess, (state, { jobId }) => ({
    ...state,
    jobs: state.jobs.map((job) => (job.id === jobId ? { ...job, status: 'QUEUED' as const } : job)),
    isLoading: false,
  })),
  on(QueueActions.retryJobFailure, (state, { error }) => ({
    ...state,
    error,
    isLoading: false,
  })),

  // Update Filters
  on(QueueActions.updateFilters, (state, { filters }) => ({
    ...state,
    filters,
  }))
);
