import { createActionGroup, emptyProps, props } from '@ngrx/store';
import type { CodecDistributionBO } from '../bos/codec-distribution.bo';
import type { InsightsStatsBO } from '../bos/insights-stats.bo';
import type { NodePerformanceBO } from '../bos/node-performance.bo';
import type { SavingsTrendBO } from '../bos/savings-trend.bo';

export const InsightsActions = createActionGroup({
  source: 'Insights',
  events: {
    'Load Savings Trend': props<{ days: number }>(),
    'Load Savings Trend Success': props<{ data: SavingsTrendBO[] }>(),
    'Load Savings Trend Failure': props<{ error: string }>(),

    'Load Codec Distribution': emptyProps(),
    'Load Codec Distribution Success': props<{ data: CodecDistributionBO[] }>(),
    'Load Codec Distribution Failure': props<{ error: string }>(),

    'Load Node Performance': emptyProps(),
    'Load Node Performance Success': props<{ data: NodePerformanceBO[] }>(),
    'Load Node Performance Failure': props<{ error: string }>(),

    'Load Stats': emptyProps(),
    'Load Stats Success': props<{ data: InsightsStatsBO }>(),
    'Load Stats Failure': props<{ error: string }>(),

    'Update Time Range': props<{ days: number }>(),
  },
});
