import { createActionGroup, emptyProps, props } from '@ngrx/store';
import { PolicyBo } from '../bos/policy.bo';
import { CreatePolicyRequest, PresetInfoModel, UpdatePolicyRequest } from '../models/policy.model';

export const PoliciesActions = createActionGroup({
  source: 'Policies',
  events: {
    'Load Policies': emptyProps(),
    'Load Policies Success': props<{ policies: PolicyBo[] }>(),
    'Load Policies Failure': props<{ error: string }>(),

    'Load Presets': emptyProps(),
    'Load Presets Success': props<{ presets: PresetInfoModel[] }>(),
    'Load Presets Failure': props<{ error: string }>(),

    'Create Policy': props<{ request: CreatePolicyRequest }>(),
    'Create Policy Success': props<{ policy: PolicyBo }>(),
    'Create Policy Failure': props<{ error: string }>(),

    'Update Policy': props<{ id: string; request: UpdatePolicyRequest }>(),
    'Update Policy Success': props<{ policy: PolicyBo }>(),
    'Update Policy Failure': props<{ error: string }>(),

    'Delete Policy': props<{ id: string }>(),
    'Delete Policy Success': props<{ id: string }>(),
    'Delete Policy Failure': props<{ error: string }>(),
  }
});
