export interface OverviewModel {
  system_health: SystemHealthModel;
  queue_summary: QueueSummaryModel;
  recent_activity: RecentActivityModel[];
  top_libraries: TopLibraryModel[];
  last_updated: string;
}

export interface SystemHealthModel {
  active_nodes: {
    current: number;
    total: number;
  };
  queue_status: {
    encoding_count: number;
  };
  storage_saved: {
    total_tb: number;
  };
  success_rate: {
    percentage: number;
  };
}

export interface QueueSummaryModel {
  queued: number;
  encoding: number;
  completed: number;
  failed: number;
}

export interface RecentActivityModel {
  id: string;
  file_name: string;
  library: string;
  codec_change: string;
  savings_gb: number;
  duration_seconds: number;
  completed_at: string;
}

export interface TopLibraryModel {
  name: string;
  job_count: number;
  total_savings_gb: number;
}
