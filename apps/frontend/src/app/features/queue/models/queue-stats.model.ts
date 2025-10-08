export interface QueueStats {
  queued: number;
  encoding: number;
  completed: number;
  failed: number;
  totalSavedBytes: string;
}
