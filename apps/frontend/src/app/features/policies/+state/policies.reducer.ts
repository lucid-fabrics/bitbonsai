import { createReducer, on } from '@ngrx/store';
import { PolicyBo } from '../bos/policy.bo';
import { PresetInfoModel } from '../models/policy.model';
import { PoliciesActions } from './policies.actions';

export interface PoliciesState {
  policies: PolicyBo[];
  presets: PresetInfoModel[];
  isLoading: boolean;
  error: string | null;
}

export const initialState: PoliciesState = {
  policies: [],
  presets: [],
  isLoading: false,
  error: null
};

export const policiesReducer = createReducer(
  initialState,

  // Load Policies
  on(PoliciesActions.loadPolicies, (state) => ({
    ...state,
    isLoading: true,
    error: null
  })),
  on(PoliciesActions.loadPoliciesSuccess, (state, { policies }) => ({
    ...state,
    policies,
    isLoading: false
  })),
  on(PoliciesActions.loadPoliciesFailure, (state, { error }) => ({
    ...state,
    error,
    isLoading: false
  })),

  // Load Presets
  on(PoliciesActions.loadPresets, (state) => ({
    ...state,
    isLoading: true
  })),
  on(PoliciesActions.loadPresetsSuccess, (state, { presets }) => ({
    ...state,
    presets,
    isLoading: false
  })),
  on(PoliciesActions.loadPresetsFailure, (state, { error }) => ({
    ...state,
    error,
    isLoading: false
  })),

  // Create Policy
  on(PoliciesActions.createPolicy, (state) => ({
    ...state,
    isLoading: true,
    error: null
  })),
  on(PoliciesActions.createPolicySuccess, (state, { policy }) => ({
    ...state,
    policies: [...state.policies, policy],
    isLoading: false
  })),
  on(PoliciesActions.createPolicyFailure, (state, { error }) => ({
    ...state,
    error,
    isLoading: false
  })),

  // Update Policy
  on(PoliciesActions.updatePolicy, (state) => ({
    ...state,
    isLoading: true,
    error: null
  })),
  on(PoliciesActions.updatePolicySuccess, (state, { policy }) => ({
    ...state,
    policies: state.policies.map(p => p.id === policy.id ? policy : p),
    isLoading: false
  })),
  on(PoliciesActions.updatePolicyFailure, (state, { error }) => ({
    ...state,
    error,
    isLoading: false
  })),

  // Delete Policy
  on(PoliciesActions.deletePolicy, (state) => ({
    ...state,
    isLoading: true,
    error: null
  })),
  on(PoliciesActions.deletePolicySuccess, (state, { id }) => ({
    ...state,
    policies: state.policies.filter(p => p.id !== id),
    isLoading: false
  })),
  on(PoliciesActions.deletePolicyFailure, (state, { error }) => ({
    ...state,
    error,
    isLoading: false
  }))
);
