import type { JobStatus } from './job-status.type';

export interface QueueFilters {
  status?: JobStatus;
  nodeId?: string;
  search?: string;
}
