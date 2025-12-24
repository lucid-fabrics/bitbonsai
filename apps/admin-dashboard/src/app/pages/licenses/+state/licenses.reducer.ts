import { createReducer, on } from '@ngrx/store';
import { License } from '../../../services/license-api.service';
import * as LicensesActions from './licenses.actions';

export interface LicensesState {
  licenses: License[];
  total: number;
  currentPage: number;
  pageSize: number;
  loading: boolean;
  error: string | null;
  searchEmail: string;
  filterTier: string;
  showCreateDialog: boolean;
}

export const initialState: LicensesState = {
  licenses: [],
  total: 0,
  currentPage: 0,
  pageSize: 20,
  loading: false,
  error: null,
  searchEmail: '',
  filterTier: '',
  showCreateDialog: false,
};

export const licensesReducer = createReducer(
  initialState,
  on(LicensesActions.loadLicenses, (state) => ({
    ...state,
    loading: true,
    error: null,
  })),
  on(LicensesActions.loadLicensesSuccess, (state, { licenses, total }) => ({
    ...state,
    licenses,
    total,
    loading: false,
    error: null,
  })),
  on(LicensesActions.loadLicensesFailure, (state, { error }) => ({
    ...state,
    loading: false,
    error,
  })),
  on(LicensesActions.searchLicenses, (state) => ({
    ...state,
    loading: true,
    error: null,
  })),
  on(LicensesActions.searchLicensesSuccess, (state, { licenses }) => ({
    ...state,
    licenses,
    total: licenses.length,
    loading: false,
    error: null,
  })),
  on(LicensesActions.searchLicensesFailure, (state, { error }) => ({
    ...state,
    loading: false,
    error,
  })),
  on(LicensesActions.createLicense, (state) => ({
    ...state,
    loading: true,
    error: null,
  })),
  on(LicensesActions.createLicenseSuccess, (state) => ({
    ...state,
    loading: false,
    error: null,
    showCreateDialog: false,
  })),
  on(LicensesActions.createLicenseFailure, (state, { error }) => ({
    ...state,
    loading: false,
    error,
  })),
  on(LicensesActions.revokeLicense, (state) => ({
    ...state,
    loading: true,
    error: null,
  })),
  on(LicensesActions.revokeLicenseSuccess, (state) => ({
    ...state,
    loading: false,
    error: null,
  })),
  on(LicensesActions.revokeLicenseFailure, (state, { error }) => ({
    ...state,
    loading: false,
    error,
  })),
  on(LicensesActions.resetFilters, (state) => ({
    ...state,
    searchEmail: '',
    filterTier: '',
    currentPage: 0,
  })),
  on(LicensesActions.setPage, (state, { page }) => ({
    ...state,
    currentPage: page,
  })),
  on(LicensesActions.setTierFilter, (state, { tier }) => ({
    ...state,
    filterTier: tier,
    currentPage: 0,
  })),
  on(LicensesActions.setSearchEmail, (state, { email }) => ({
    ...state,
    searchEmail: email,
  })),
  on(LicensesActions.toggleCreateDialog, (state, { show }) => ({
    ...state,
    showCreateDialog: show,
  })),
  on(LicensesActions.clearError, (state) => ({
    ...state,
    error: null,
  }))
);
