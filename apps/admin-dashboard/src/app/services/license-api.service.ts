import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export interface License {
  id: string;
  key: string;
  email: string;
  tier: string;
  maxNodes: number;
  maxConcurrentJobs: number;
  expiresAt?: Date;
  createdAt: Date;
  status?: string;
}

export interface LicenseListResponse {
  data: License[];
  total: number;
}

export interface CreateLicenseRequest {
  email: string;
  tier: string;
  expiresAt?: string;
  notes?: string;
}

@Injectable({
  providedIn: 'root',
})
export class LicenseApiService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.licenseApiUrl}/licenses`;

  listLicenses(params: {
    skip?: number;
    take?: number;
    status?: string;
    tier?: string;
  }): Observable<LicenseListResponse> {
    let httpParams = new HttpParams();
    if (params.skip !== undefined) httpParams = httpParams.set('skip', params.skip.toString());
    if (params.take !== undefined) httpParams = httpParams.set('take', params.take.toString());
    if (params.status) httpParams = httpParams.set('status', params.status);
    if (params.tier) httpParams = httpParams.set('tier', params.tier);

    return this.http.get<LicenseListResponse>(this.baseUrl, { params: httpParams });
  }

  getLicense(id: string): Observable<License> {
    return this.http.get<License>(`${this.baseUrl}/${id}`);
  }

  getLicensesByEmail(email: string): Observable<License[]> {
    return this.http.get<License[]>(`${this.baseUrl}/email/${email}`);
  }

  createLicense(request: CreateLicenseRequest): Observable<License> {
    return this.http.post<License>(this.baseUrl, request);
  }

  revokeLicense(id: string, reason: string): Observable<License> {
    return this.http.post<License>(`${this.baseUrl}/${id}/revoke`, { reason });
  }
}
