import type { QueueJobBo } from '../bos/queue-job.bo';
import type { QueueStats } from './queue-stats.model';

export interface QueueResponse {
  jobs: QueueJobBo[];
  stats: QueueStats;
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}
