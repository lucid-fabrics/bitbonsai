import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import type {
  CreatePolicyRequest,
  PolicyModel,
  PolicyPreset,
  PresetInfoModel,
  TargetCodec,
  UpdatePolicyRequest,
} from '../../features/policies/models/policy.model';

interface PresetApiResponse {
  preset: PolicyPreset;
  name: string;
  description: string;
  defaultCodec: TargetCodec;
  recommendedQuality: number;
}

const PRESET_USE_CASES: Record<string, string> = {
  BALANCED_HEVC: 'Great for most libraries',
  FAST_HEVC: 'When speed matters more than size',
  QUALITY_AV1: 'Smallest files, slowest conversion',
  COPY_IF_COMPLIANT: 'Fastest, never converts compatible files',
  CUSTOM: 'Full manual control',
};

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
    // API sends { defaultCodec, recommendedQuality }; the UI model wants { codec, crf }
    return this.http.get<PresetApiResponse[]>(`${this.apiUrl}/policies/presets`).pipe(
      map((presets) =>
        presets.map((p) => ({
          preset: p.preset,
          name: p.name,
          description: p.description,
          codec: p.defaultCodec,
          crf: p.recommendedQuality,
          use_case: PRESET_USE_CASES[p.preset] ?? '',
          icon: '',
          recommended: p.preset === 'BALANCED_HEVC',
        }))
      )
    );
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
