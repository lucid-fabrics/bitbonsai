import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';
import { environment } from '../../../../environments/environment';
import type { AdvancedModeSettings } from '../../../core/clients/settings.client';
import type { EnvironmentInfo } from '../models/environment-info.model';
import type { SecuritySettings } from '../models/security-settings.model';
import type { SystemResources } from '../models/system-resources.model';
import type { SystemSettings } from '../models/system-settings.model';
import type { UpdateSystemSettings } from '../models/update-system-settings.model';

@Injectable({
  providedIn: 'root',
})
export class SettingsService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = `${environment.apiUrl}/settings`;

  getEnvironmentInfo(): Observable<EnvironmentInfo> {
    return this.http.get<EnvironmentInfo>(`${this.apiUrl}/environment`);
  }

  getSystemSettings(): Observable<SystemSettings> {
    return this.http.get<SystemSettings>(`${this.apiUrl}/system`);
  }

  updateSystemSettings(updateDto: UpdateSystemSettings): Observable<SystemSettings> {
    return this.http.patch<SystemSettings>(`${this.apiUrl}/system`, updateDto);
  }

  backupDatabase(): Observable<{ backupPath: string; timestamp: string }> {
    return this.http.post<{ backupPath: string; timestamp: string }>(
      `${this.apiUrl}/system/backup`,
      null
    );
  }

  resetToDefaults(): Observable<{ message: string }> {
    return this.http.post<{ message: string }>(`${this.apiUrl}/system/reset`, null);
  }

  regenerateApiKey(): Observable<{ apiKey: string }> {
    return this.http.post<{ apiKey: string }>(`${this.apiUrl}/system/api-key/regenerate`, {});
  }

  getSecuritySettings(): Observable<SecuritySettings> {
    return this.http.get<SecuritySettings>(`${this.apiUrl}/security`);
  }

  updateSecuritySettings(settings: SecuritySettings): Observable<SecuritySettings> {
    return this.http.patch<SecuritySettings>(`${this.apiUrl}/security`, settings);
  }

  getSystemResources(): Observable<SystemResources> {
    return this.http.get<SystemResources>(`${environment.apiUrl}/system/resources`);
  }

  getAdvancedMode(): Observable<AdvancedModeSettings> {
    return this.http.get<AdvancedModeSettings>('/api/v1/settings/advanced-mode');
  }

  updateAdvancedMode(enabled: boolean): Observable<AdvancedModeSettings> {
    return this.http.patch<AdvancedModeSettings>('/api/v1/settings/advanced-mode', {
      advancedModeEnabled: enabled,
    });
  }
}
