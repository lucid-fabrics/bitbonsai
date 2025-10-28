export interface QueueStats {
  detected: number;
  healthCheck: number;
  queued: number;
  encoding: number;
  verifying: number;
  completed: number;
  failed: number;
  cancelled: number;
  totalSavedBytes: string;
}
