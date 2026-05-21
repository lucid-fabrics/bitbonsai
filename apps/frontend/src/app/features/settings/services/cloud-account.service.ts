import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';
import { environment } from '../../../../environments/environment';

export interface DeviceFlowResponse {
  userCode: string;
  verificationUri: string;
  verificationUriComplete: string;
  expiresIn: number;
  interval: number;
  deviceCode: string;
}

export interface CloudAuthStatus {
  linked: boolean;
  email: string | null;
  tier: string | null;
  maxNodes: number | null;
  maxConcurrentJobs: number | null;
  validatedAt: Date | null;
  gracePeriodExpiresAt: Date | null;
  gracePeriodExpired: boolean;
}

@Injectable({ providedIn: 'root' })
export class CloudAccountService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = `${environment.apiUrl}/cloud-auth`;

  startDeviceFlow(machineName?: string): Observable<DeviceFlowResponse> {
    return this.http.post<DeviceFlowResponse>(`${this.apiUrl}/start`, { machineName });
  }

  getStatus(): Observable<CloudAuthStatus> {
    return this.http.get<CloudAuthStatus>(`${this.apiUrl}/status`);
  }

  logout(): Observable<void> {
    return this.http.post<void>(`${this.apiUrl}/logout`, {});
  }

  validateNow(): Observable<boolean> {
    return this.http.post<boolean>(`${this.apiUrl}/validate`, {});
  }
}
