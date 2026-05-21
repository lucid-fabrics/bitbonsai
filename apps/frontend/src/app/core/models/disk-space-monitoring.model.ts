export interface LibraryDiskSpaceModel {
  libraryId: string;
  libraryName: string;
  path: string;
  status: 'ok' | 'warning' | 'critical';
  totalBytes: string;
  availableBytes: string;
  usedBytes: string;
  usedPercent: number;
  availableFormatted: string;
  totalFormatted: string;
  queuedJobsCount: number;
  estimatedSpaceNeededBytes: string | null;
  hasEnoughSpaceForQueue: boolean;
  warningMessage: string | null;
}

export interface DiskSpaceMonitoringModel {
  overallStatus: 'ok' | 'warning' | 'critical';
  timestamp: string;
  libraries: LibraryDiskSpaceModel[];
  globalWarnings: string[];
  totalQueuedJobs: number;
  totalEstimatedSpaceNeeded: string | null;
  canAccommodateQueue: boolean;
}
