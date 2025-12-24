import { createAction, props } from '@ngrx/store';
import { License } from '../../../services/license-api.service';

export const loadLicenses = createAction(
  '[Licenses] Load Licenses',
  props<{ skip: number; take: number; tier?: string }>()
);

export const loadLicensesSuccess = createAction(
  '[Licenses] Load Licenses Success',
  props<{ licenses: License[]; total: number }>()
);

export const loadLicensesFailure = createAction(
  '[Licenses] Load Licenses Failure',
  props<{ error: string }>()
);

export const searchLicenses = createAction(
  '[Licenses] Search Licenses',
  props<{ email: string }>()
);

export const searchLicensesSuccess = createAction(
  '[Licenses] Search Licenses Success',
  props<{ licenses: License[] }>()
);

export const searchLicensesFailure = createAction(
  '[Licenses] Search Licenses Failure',
  props<{ error: string }>()
);

export const createLicense = createAction(
  '[Licenses] Create License',
  props<{ email: string; tier: string; expiresAt?: string; notes?: string }>()
);

export const createLicenseSuccess = createAction('[Licenses] Create License Success');

export const createLicenseFailure = createAction(
  '[Licenses] Create License Failure',
  props<{ error: string }>()
);

export const revokeLicense = createAction(
  '[Licenses] Revoke License',
  props<{ licenseId: number; reason: string }>()
);

export const revokeLicenseSuccess = createAction('[Licenses] Revoke License Success');

export const revokeLicenseFailure = createAction(
  '[Licenses] Revoke License Failure',
  props<{ error: string }>()
);

export const resetFilters = createAction('[Licenses] Reset Filters');

export const setPage = createAction('[Licenses] Set Page', props<{ page: number }>());

export const setTierFilter = createAction('[Licenses] Set Tier Filter', props<{ tier: string }>());

export const setSearchEmail = createAction(
  '[Licenses] Set Search Email',
  props<{ email: string }>()
);

export const toggleCreateDialog = createAction(
  '[Licenses] Toggle Create Dialog',
  props<{ show: boolean }>()
);

export const clearError = createAction('[Licenses] Clear Error');
