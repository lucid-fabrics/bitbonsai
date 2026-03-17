export interface OverviewModel {
  system_health: SystemHealthModel;
  queue_summary: QueueSummaryModel;
  node_status: NodeStatusModel[];
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
  cpu_utilization: {
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
  source_codec: string;
  target_codec: string;
  stage: string; // 'COMPLETED' | 'ENCODING'
  before_size_bytes: number;
  after_size_bytes: number | null;
  saved_bytes: number | null;
  saved_percent: number | null;
  progress: number | null; // 0-100, only for ENCODING jobs
  completed_at: string;
}

export interface TopLibraryModel {
  name: string;
  media_type: string;
  job_count: number;
  completed_jobs: number;
  encoding_jobs: number;
  total_savings_bytes: number;
  total_before_bytes: number;
}

export interface NodeStatusModel {
  id: string;
  name: string;
  role: string; // 'MAIN' | 'LINKED'
  status: string; // 'ONLINE' | 'OFFLINE' | 'ERROR'
  acceleration: string; // 'NONE' | 'NVIDIA' | 'INTEL_QSV' | 'AMD' | 'APPLE_M'
  cpu_usage: number | null;
  encoding_count: number;
  completed_count: number;
  failed_count: number;
  total_saved_bytes: number;
  success_rate: number;
  total_queue_time_seconds: number | null;
  last_heartbeat: string;
}
