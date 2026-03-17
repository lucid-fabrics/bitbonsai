import { createReducer, on } from '@ngrx/store';
import type { EnvironmentInfo } from '../models/environment-info.model';
import type { License } from '../models/license.model';
import type { SystemSettings } from '../models/system-settings.model';
import { SettingsActions } from './settings.actions';

export interface SettingsState {
  license: License | null;
  environmentInfo: EnvironmentInfo | null;
  systemSettings: SystemSettings | null;
  isLoading: boolean;
  error: string | null;
  successMessage: string | null;
  advancedModeEnabled: boolean;
}

export const initialState: SettingsState = {
  license: null,
  environmentInfo: null,
  systemSettings: null,
  isLoading: false,
  error: null,
  successMessage: null,
  advancedModeEnabled: false,
};

export const settingsReducer = createReducer(
  initialState,

  // Load License
  on(SettingsActions.loadLicense, (state) => ({
    ...state,
    isLoading: true,
    error: null,
  })),
  on(SettingsActions.loadLicenseSuccess, (state, { license }) => ({
    ...state,
    license,
    isLoading: false,
  })),
  on(SettingsActions.loadLicenseFailure, (state, { error }) => ({
    ...state,
    error,
    isLoading: false,
  })),

  // Activate License
  on(SettingsActions.activateLicense, (state) => ({
    ...state,
    isLoading: true,
    error: null,
    successMessage: null,
  })),
  on(SettingsActions.activateLicenseSuccess, (state, { license }) => ({
    ...state,
    license,
    isLoading: false,
    successMessage: 'License activated successfully!',
  })),
  on(SettingsActions.activateLicenseFailure, (state, { error }) => ({
    ...state,
    error,
    isLoading: false,
  })),

  // Load Environment Info
  on(SettingsActions.loadEnvironmentInfo, (state) => ({
    ...state,
    isLoading: true,
    error: null,
  })),
  on(SettingsActions.loadEnvironmentInfoSuccess, (state, { info }) => ({
    ...state,
    environmentInfo: info,
    isLoading: false,
  })),
  on(SettingsActions.loadEnvironmentInfoFailure, (state, { error }) => ({
    ...state,
    error,
    isLoading: false,
  })),

  // Load System Settings
  on(SettingsActions.loadSystemSettings, (state) => ({
    ...state,
    isLoading: true,
    error: null,
  })),
  on(SettingsActions.loadSystemSettingsSuccess, (state, { settings }) => ({
    ...state,
    systemSettings: settings,
    isLoading: false,
  })),
  on(SettingsActions.loadSystemSettingsFailure, (state, { error }) => ({
    ...state,
    error,
    isLoading: false,
  })),

  // Update System Settings
  on(SettingsActions.updateSystemSettings, (state) => ({
    ...state,
    isLoading: true,
    error: null,
    successMessage: null,
  })),
  on(SettingsActions.updateSystemSettingsSuccess, (state, { settings }) => ({
    ...state,
    systemSettings: settings,
    isLoading: false,
    successMessage: 'Settings updated successfully!',
  })),
  on(SettingsActions.updateSystemSettingsFailure, (state, { error }) => ({
    ...state,
    error,
    isLoading: false,
  })),

  // Backup Database
  on(SettingsActions.backupDatabase, (state) => ({
    ...state,
    isLoading: true,
    error: null,
    successMessage: null,
  })),
  on(SettingsActions.backupDatabaseSuccess, (state, { backupPath }) => ({
    ...state,
    isLoading: false,
    successMessage: `Database backed up to: ${backupPath}`,
  })),
  on(SettingsActions.backupDatabaseFailure, (state, { error }) => ({
    ...state,
    error,
    isLoading: false,
  })),

  // Reset To Defaults
  on(SettingsActions.resetToDefaults, (state) => ({
    ...state,
    isLoading: true,
    error: null,
    successMessage: null,
  })),
  on(SettingsActions.resetToDefaultsSuccess, (state, { message }) => ({
    ...state,
    isLoading: false,
    successMessage: message,
  })),
  on(SettingsActions.resetToDefaultsFailure, (state, { error }) => ({
    ...state,
    error,
    isLoading: false,
  })),

  // Regenerate API Key
  on(SettingsActions.regenerateAPIKey, (state) => ({
    ...state,
    isLoading: true,
    error: null,
    successMessage: null,
  })),
  on(SettingsActions.regenerateAPIKeySuccess, (state, { apiKey }) => ({
    ...state,
    systemSettings: state.systemSettings ? { ...state.systemSettings, apiKey } : null,
    isLoading: false,
    successMessage: 'API key regenerated successfully!',
  })),
  on(SettingsActions.regenerateAPIKeyFailure, (state, { error }) => ({
    ...state,
    error,
    isLoading: false,
  })),

  // Load Advanced Mode
  on(SettingsActions.loadAdvancedMode, (state) => ({
    ...state,
    isLoading: true,
    error: null,
  })),
  on(SettingsActions.loadAdvancedModeSuccess, (state, { enabled }) => ({
    ...state,
    advancedModeEnabled: enabled,
    isLoading: false,
  })),
  on(SettingsActions.loadAdvancedModeFailure, (state, { error }) => ({
    ...state,
    error,
    isLoading: false,
  })),

  // Update Advanced Mode
  on(SettingsActions.updateAdvancedMode, (state) => ({
    ...state,
    isLoading: true,
    error: null,
    successMessage: null,
  })),
  on(SettingsActions.updateAdvancedModeSuccess, (state, { enabled }) => ({
    ...state,
    advancedModeEnabled: enabled,
    isLoading: false,
    successMessage: enabled ? 'Advanced mode enabled' : 'Advanced mode disabled',
  })),
  on(SettingsActions.updateAdvancedModeFailure, (state, { error }) => ({
    ...state,
    error,
    isLoading: false,
  }))
);
