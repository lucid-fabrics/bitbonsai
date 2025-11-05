import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';

export interface DefaultQueueViewSettings {
  defaultQueueView: string;
}

export interface ReadyFilesCacheTtlSettings {
  readyFilesCacheTtlMinutes: number;
}

@Injectable({
  providedIn: 'root',
})
export class SettingsClient {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = '/api/v1/settings';

  getDefaultQueueView(): Observable<DefaultQueueViewSettings> {
    return this.http.get<DefaultQueueViewSettings>(`${this.apiUrl}/default-queue-view`);
  }

  updateDefaultQueueView(defaultQueueView: string): Observable<DefaultQueueViewSettings> {
    return this.http.patch<DefaultQueueViewSettings>(`${this.apiUrl}/default-queue-view`, {
      defaultQueueView,
    });
  }

  getReadyFilesCacheTtl(): Observable<ReadyFilesCacheTtlSettings> {
    return this.http.get<ReadyFilesCacheTtlSettings>(`${this.apiUrl}/ready-files-cache-ttl`);
  }

  updateReadyFilesCacheTtl(ttlMinutes: number): Observable<ReadyFilesCacheTtlSettings> {
    return this.http.patch<ReadyFilesCacheTtlSettings>(`${this.apiUrl}/ready-files-cache-ttl`, {
      readyFilesCacheTtlMinutes: ttlMinutes,
    });
  }
}
