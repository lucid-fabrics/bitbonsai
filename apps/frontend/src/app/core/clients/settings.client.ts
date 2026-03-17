import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';

export interface DefaultQueueViewSettings {
  defaultQueueView: string;
}

export interface ReadyFilesCacheTtlSettings {
  readyFilesCacheTtlMinutes: number;
}

export interface AutoHealRetryLimitSettings {
  maxAutoHealRetries: number;
}

export interface JellyfinSettings {
  jellyfinUrl?: string;
  jellyfinApiKey?: string;
  jellyfinRefreshOnComplete?: boolean;
}

export interface JellyfinTestResult {
  success: boolean;
  serverName?: string;
  version?: string;
  error?: string;
}

export interface AdvancedModeSettings {
  advancedModeEnabled: boolean;
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

  getAutoHealRetryLimit(): Observable<AutoHealRetryLimitSettings> {
    return this.http.get<AutoHealRetryLimitSettings>(`${this.apiUrl}/auto-heal-retry-limit`);
  }

  updateAutoHealRetryLimit(maxRetries: number): Observable<AutoHealRetryLimitSettings> {
    return this.http.patch<AutoHealRetryLimitSettings>(`${this.apiUrl}/auto-heal-retry-limit`, {
      maxAutoHealRetries: maxRetries,
    });
  }

  // Jellyfin integration
  getJellyfinSettings(): Observable<JellyfinSettings> {
    return this.http.get<JellyfinSettings>(`${this.apiUrl}/jellyfin`);
  }

  updateJellyfinSettings(settings: JellyfinSettings): Observable<JellyfinSettings> {
    return this.http.patch<JellyfinSettings>(`${this.apiUrl}/jellyfin`, settings);
  }

  testJellyfinConnection(settings: JellyfinSettings): Observable<JellyfinTestResult> {
    return this.http.post<JellyfinTestResult>(`${this.apiUrl}/jellyfin/test`, settings);
  }

  // Advanced Mode (UI Simplification)
  getAdvancedMode(): Observable<AdvancedModeSettings> {
    return this.http.get<AdvancedModeSettings>(`${this.apiUrl}/advanced-mode`);
  }

  updateAdvancedMode(enabled: boolean): Observable<AdvancedModeSettings> {
    return this.http.patch<AdvancedModeSettings>(`${this.apiUrl}/advanced-mode`, {
      advancedModeEnabled: enabled,
    });
  }
}
