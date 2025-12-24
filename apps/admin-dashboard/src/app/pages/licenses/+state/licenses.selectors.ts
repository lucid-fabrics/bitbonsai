import { createFeatureSelector, createSelector } from '@ngrx/store';
import { LicensesState } from './licenses.reducer';

export const selectLicensesState = createFeatureSelector<LicensesState>('licenses');

export const selectLicenses = createSelector(selectLicensesState, (state) => state.licenses);

export const selectTotal = createSelector(selectLicensesState, (state) => state.total);

export const selectCurrentPage = createSelector(selectLicensesState, (state) => state.currentPage);

export const selectPageSize = createSelector(selectLicensesState, (state) => state.pageSize);

export const selectLoading = createSelector(selectLicensesState, (state) => state.loading);

export const selectError = createSelector(selectLicensesState, (state) => state.error);

export const selectSearchEmail = createSelector(selectLicensesState, (state) => state.searchEmail);

export const selectFilterTier = createSelector(selectLicensesState, (state) => state.filterTier);

export const selectShowCreateDialog = createSelector(
  selectLicensesState,
  (state) => state.showCreateDialog
);
