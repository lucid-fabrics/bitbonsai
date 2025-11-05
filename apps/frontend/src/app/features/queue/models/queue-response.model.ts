import type { QueueJob } from './queue-job.model';
import type { QueueStats } from './queue-stats.model';

export interface QueueResponse {
  jobs: QueueJob[];
  stats: QueueStats;
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}
