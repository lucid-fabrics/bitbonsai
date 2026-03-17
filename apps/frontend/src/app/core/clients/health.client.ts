import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';
import type { DiskSpaceMonitoringModel } from '../models/disk-space-monitoring.model';

@Injectable({
  providedIn: 'root',
})
export class HealthClient {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = '/api/v1/health';

  /**
   * Get disk space monitoring data for all libraries
   * Includes per-library breakdown, queued jobs, and predictive warnings
   */
  getDiskSpaceMonitoring(): Observable<DiskSpaceMonitoringModel> {
    return this.http.get<DiskSpaceMonitoringModel>(`${this.apiUrl}/disk-space`);
  }
}
