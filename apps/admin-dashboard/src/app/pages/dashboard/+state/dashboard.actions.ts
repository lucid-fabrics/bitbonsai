import { createAction, props } from '@ngrx/store';
import { RevenueMetrics } from '../../../services/api.service';

export const loadMetrics = createAction('[Dashboard] Load Metrics');

export const loadMetricsSuccess = createAction(
  '[Dashboard] Load Metrics Success',
  props<{ metrics: RevenueMetrics }>()
);

export const loadMetricsFailure = createAction(
  '[Dashboard] Load Metrics Failure',
  props<{ error: string }>()
);
