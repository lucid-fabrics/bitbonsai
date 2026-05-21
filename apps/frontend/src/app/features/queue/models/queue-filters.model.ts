import { JobStatus } from './job-status.enum';

export interface QueueFilters {
  status?: JobStatus;
  nodeId?: string;
  libraryId?: string;
  search?: string;
  page?: number;
  limit?: number;
}
