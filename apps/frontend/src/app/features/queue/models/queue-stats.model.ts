export interface QueueStats {
  detected: number;
  healthCheck: number;
  needsDecision: number;
  codecMatchCount: number; // Jobs in NEEDS_DECISION with codec already matching target
  queued: number;
  transferring: number;
  encoding: number;
  verifying: number;
  completed: number;
  failed: number;
  cancelled: number;
  totalSavedBytes: string;
}
