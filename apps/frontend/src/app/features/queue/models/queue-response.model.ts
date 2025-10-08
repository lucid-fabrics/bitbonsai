import type { QueueJob } from './queue-job.model';
import type { QueueStats } from './queue-stats.model';

export interface QueueResponse {
  jobs: QueueJob[];
  stats: QueueStats;
}
