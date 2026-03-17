import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';

export interface SystemLoadInfo {
  loadAvg1m: number;
  loadAvg5m: number;
  loadAvg15m: number;
  cpuCount: number;
  loadThreshold: number;
  loadThresholdMultiplier: number;
  freeMemoryGB: number;
  totalMemoryGB: number;
  isOverloaded: boolean;
  reason: string;
}

export interface TrackedEncoding {
  jobId: string;
  pid: number | undefined;
  startTime: string;
  lastProgress: number;
  lastOutputTime: string;
  runtimeSeconds: number;
}

export interface SystemFfmpegProcess {
  pid: number;
  command: string;
  cpuPercent: number;
  memPercent: number;
  runtimeSeconds: number;
  isZombie: boolean;
  trackedJobId: string | null;
}

export interface FfmpegProcessesResponse {
  trackedEncodings: TrackedEncoding[];
  systemProcesses: SystemFfmpegProcess[];
  zombieCount: number;
}

export interface KillResult {
  success: boolean;
  message: string;
}

export interface KillAllZombiesResult {
  killed: number;
  failed: number;
  details: Array<{ pid: number; success: boolean; message: string }>;
}

export interface UpdateLoadThresholdResult {
  success: boolean;
  loadThresholdMultiplier: number;
  maxLoad: number;
  cpuCount: number;
  requiresRestart: boolean;
  message?: string;
}

@Injectable({ providedIn: 'root' })
export class DebugClient {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = '/api/v1/debug';

  getSystemLoad(): Observable<SystemLoadInfo> {
    return this.http.get<SystemLoadInfo>(`${this.baseUrl}/system-load`);
  }

  reloadLoadThreshold(): Observable<{ success: boolean; loadThresholdMultiplier: number }> {
    return this.http.post<{ success: boolean; loadThresholdMultiplier: number }>(
      `${this.baseUrl}/reload-load-threshold`,
      {}
    );
  }

  getFfmpegProcesses(): Observable<FfmpegProcessesResponse> {
    return this.http.get<FfmpegProcessesResponse>(`${this.baseUrl}/ffmpeg-processes`);
  }

  killFfmpegProcess(pid: number): Observable<KillResult> {
    return this.http.delete<KillResult>(`${this.baseUrl}/ffmpeg-processes/${pid}`);
  }

  killAllZombies(): Observable<KillAllZombiesResult> {
    return this.http.delete<KillAllZombiesResult>(`${this.baseUrl}/ffmpeg-processes/zombies`);
  }

  updateLoadThreshold(multiplier: number): Observable<UpdateLoadThresholdResult> {
    return this.http.post<UpdateLoadThresholdResult>(`${this.baseUrl}/load-threshold`, {
      loadThresholdMultiplier: multiplier,
    });
  }
}
