import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';
import type {
  CreatePolicyRequest,
  PolicyModel,
  PresetInfoModel,
  UpdatePolicyRequest,
} from '../models/policy.model';

@Injectable({ providedIn: 'root' })
export class PolicyClient {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = '/api/v1';

  getPolicies(): Observable<PolicyModel[]> {
    return this.http.get<PolicyModel[]>(`${this.apiUrl}/policies`);
  }

  getPolicy(id: string): Observable<PolicyModel> {
    return this.http.get<PolicyModel>(`${this.apiUrl}/policies/${id}`);
  }

  getPresets(): Observable<PresetInfoModel[]> {
    return this.http.get<PresetInfoModel[]>(`${this.apiUrl}/policies/presets`);
  }

  createPolicy(request: CreatePolicyRequest): Observable<PolicyModel> {
    return this.http.post<PolicyModel>(`${this.apiUrl}/policies`, request);
  }

  updatePolicy(id: string, request: UpdatePolicyRequest): Observable<PolicyModel> {
    return this.http.patch<PolicyModel>(`${this.apiUrl}/policies/${id}`, request);
  }

  deletePolicy(id: string): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/policies/${id}`);
  }
}
