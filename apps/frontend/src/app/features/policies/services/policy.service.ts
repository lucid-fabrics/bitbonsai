import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { PolicyBo } from '../bos/policy.bo';
import { PolicyClient } from './policy.client';
import { CreatePolicyRequest, PresetInfoModel, UpdatePolicyRequest } from '../models/policy.model';

@Injectable({
  providedIn: 'root'
})
export class PolicyService {
  private readonly policyClient = inject(PolicyClient);

  getPolicies(): Observable<PolicyBo[]> {
    return this.policyClient.getPolicies().pipe(
      map((policies) => policies.map(p => new PolicyBo(p)))
    );
  }

  getPolicy(id: string): Observable<PolicyBo> {
    return this.policyClient.getPolicy(id).pipe(
      map((policy) => new PolicyBo(policy))
    );
  }

  getPresets(): Observable<PresetInfoModel[]> {
    return this.policyClient.getPresets();
  }

  createPolicy(request: CreatePolicyRequest): Observable<PolicyBo> {
    return this.policyClient.createPolicy(request).pipe(
      map((policy) => new PolicyBo(policy))
    );
  }

  updatePolicy(id: string, request: UpdatePolicyRequest): Observable<PolicyBo> {
    return this.policyClient.updatePolicy(id, request).pipe(
      map((policy) => new PolicyBo(policy))
    );
  }

  deletePolicy(id: string): Observable<void> {
    return this.policyClient.deletePolicy(id);
  }
}
