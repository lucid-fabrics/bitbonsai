import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';

export interface HealthCheck {
  name: string;
  status: 'healthy' | 'warning' | 'critical';
  message?: string;
  value?: number;
  threshold?: number;
}

export interface SystemHealth {
  overall: 'healthy' | 'warning' | 'critical';
  checks: HealthCheck[];
  lastChecked: string;
}

export interface QueueStatistics {
  total: number;
  queued: number;
  encoding: number;
  paused: number;
  completed: number;
  failed: number;
  cancelled: number;
  avgQueueTime: number;
  avgEncodingTime: number;
}

export interface StorageStats {
  totalSavedBytes: number;
  totalSavedGB: number;
  avgSavedPercent: number;
  largestSaving: {
    file: string;
    savedBytes: number;
    savedPercent: number;
  };
}

export interface EncodingMetrics {
  avgFps: number;
  avgBytesPerSecond: number;
  peakFps: number;
  peakBytesPerSecond: number;
  totalProcessingTimeHours: number;
}

export interface HardwareInfo {
  nodeId: string;
  nodeName: string;
  cpuCores: number;
  ramGB: number;
  acceleration: string;
  hasGpu: boolean;
  avgEncodingSpeed: number;
}

export interface DashboardSummary {
  health: SystemHealth;
  queue: QueueStatistics;
  storage: StorageStats;
  encoding: EncodingMetrics;
  hardware: HardwareInfo[];
}

@Injectable({
  providedIn: 'root',
})
export class DashboardClient {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = '/api/v1/system/dashboard';

  getHealth(): Observable<SystemHealth> {
    return this.http.get<SystemHealth>(`${this.apiUrl}/health`);
  }

  getQueueStats(): Observable<QueueStatistics> {
    return this.http.get<QueueStatistics>(`${this.apiUrl}/queue`);
  }

  getStorageStats(): Observable<StorageStats> {
    return this.http.get<StorageStats>(`${this.apiUrl}/storage`);
  }

  getEncodingMetrics(): Observable<EncodingMetrics> {
    return this.http.get<EncodingMetrics>(`${this.apiUrl}/encoding`);
  }

  getHardwareInfo(): Observable<HardwareInfo[]> {
    return this.http.get<HardwareInfo[]>(`${this.apiUrl}/hardware`);
  }

  getSummary(): Observable<DashboardSummary> {
    return this.http.get<DashboardSummary>(`${this.apiUrl}/summary`);
  }
}
