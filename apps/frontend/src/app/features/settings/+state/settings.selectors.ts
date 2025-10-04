import { createFeatureSelector, createSelector } from '@ngrx/store';
import type { SettingsState } from './settings.reducer';

export const selectSettingsState = createFeatureSelector<SettingsState>('settings');

export const SettingsSelectors = {
  selectLicense: createSelector(selectSettingsState, (state) => state.license),
  selectEnvironmentInfo: createSelector(selectSettingsState, (state) => state.environmentInfo),
  selectSystemSettings: createSelector(selectSettingsState, (state) => state.systemSettings),
  selectIsLoading: createSelector(selectSettingsState, (state) => state.isLoading),
  selectError: createSelector(selectSettingsState, (state) => state.error),
  selectSuccessMessage: createSelector(selectSettingsState, (state) => state.successMessage),
};
