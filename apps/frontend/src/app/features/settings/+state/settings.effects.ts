import { Injectable, inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { of } from 'rxjs';
import { catchError, map, switchMap } from 'rxjs/operators';
import { humanizeError } from '../../../core/services/error-humanizer';
import { LicenseService } from '../services/license.service';
import { SettingsService } from '../services/settings.service';
import { SettingsActions } from './settings.actions';

@Injectable()
export class SettingsEffects {
  private readonly actions$ = inject(Actions);
  private readonly licenseService = inject(LicenseService);
  private readonly settingsService = inject(SettingsService);

  loadLicense$ = createEffect(() =>
    this.actions$.pipe(
      ofType(SettingsActions.loadLicense),
      switchMap(() =>
        this.licenseService.getCurrentLicense().pipe(
          map((license) => SettingsActions.loadLicenseSuccess({ license })),
          catchError((error) => of(
            SettingsActions.loadLicenseFailure({
              error: humanizeError(error, 'Could not load your license details.'),
            })
          ))
        )
      )
    )
  );

  activateLicense$ = createEffect(() =>
    this.actions$.pipe(
      ofType(SettingsActions.activateLicense),
      switchMap(({ request }) =>
        this.licenseService.activateLicense(request).pipe(
          map((license) => SettingsActions.activateLicenseSuccess({ license })),
          catchError((error) =>
            of(
              SettingsActions.activateLicenseFailure({
                error: humanizeError(error, 'Could not activate this license key. Check the key and try again.'),
              })
            )
          )
        )
      )
    )
  );

  loadEnvironmentInfo$ = createEffect(() =>
    this.actions$.pipe(
      ofType(SettingsActions.loadEnvironmentInfo),
      switchMap(() =>
        this.settingsService.getEnvironmentInfo().pipe(
          map((info) => SettingsActions.loadEnvironmentInfoSuccess({ info })),
          catchError((error) =>
            of(
              SettingsActions.loadEnvironmentInfoFailure({
                error: humanizeError(error, 'Could not load system information.'),
              })
            )
          )
        )
      )
    )
  );

  loadSystemSettings$ = createEffect(() =>
    this.actions$.pipe(
      ofType(SettingsActions.loadSystemSettings),
      switchMap(() =>
        this.settingsService.getSystemSettings().pipe(
          map((settings) => SettingsActions.loadSystemSettingsSuccess({ settings })),
          catchError((error) =>
            of(
              SettingsActions.loadSystemSettingsFailure({
                error: humanizeError(error, 'Could not load settings.'),
              })
            )
          )
        )
      )
    )
  );

  updateSystemSettings$ = createEffect(() =>
    this.actions$.pipe(
      ofType(SettingsActions.updateSystemSettings),
      switchMap(({ updates }) =>
        this.settingsService.updateSystemSettings(updates).pipe(
          map((settings) => SettingsActions.updateSystemSettingsSuccess({ settings })),
          catchError((error) =>
            of(
              SettingsActions.updateSystemSettingsFailure({
                error: humanizeError(error, 'Could not save this setting. Please try again.'),
              })
            )
          )
        )
      )
    )
  );

  backupDatabase$ = createEffect(() =>
    this.actions$.pipe(
      ofType(SettingsActions.backupDatabase),
      switchMap(() =>
        this.settingsService.backupDatabase().pipe(
          map((result) => SettingsActions.backupDatabaseSuccess(result)),
          catchError((error) => of(
            SettingsActions.backupDatabaseFailure({
              error: humanizeError(error, 'Could not create a backup. Please try again.'),
            })
          ))
        )
      )
    )
  );

  resetToDefaults$ = createEffect(() =>
    this.actions$.pipe(
      ofType(SettingsActions.resetToDefaults),
      switchMap(() =>
        this.settingsService.resetToDefaults().pipe(
          map((result) => SettingsActions.resetToDefaultsSuccess(result)),
          catchError((error) =>
            of(
              SettingsActions.resetToDefaultsFailure({
                error: humanizeError(error, 'Could not reset settings. Please try again.'),
              })
            )
          )
        )
      )
    )
  );

  regenerateApiKey$ = createEffect(() =>
    this.actions$.pipe(
      ofType(SettingsActions.regenerateAPIKey),
      switchMap(() =>
        this.settingsService.regenerateApiKey().pipe(
          map((result) => SettingsActions.regenerateAPIKeySuccess(result)),
          catchError((error) =>
            of(
              SettingsActions.regenerateAPIKeyFailure({
                error: humanizeError(error, 'Could not create a new pairing key. Please try again.'),
              })
            )
          )
        )
      )
    )
  );

  loadAdvancedMode$ = createEffect(() =>
    this.actions$.pipe(
      ofType(SettingsActions.loadAdvancedMode),
      switchMap(() =>
        this.settingsService.getAdvancedMode().pipe(
          map((result) =>
            SettingsActions.loadAdvancedModeSuccess({
              enabled: result.advancedModeEnabled,
            })
          ),
          catchError((error) =>
            of(
              SettingsActions.loadAdvancedModeFailure({
                error: humanizeError(error, 'Could not load settings.'),
              })
            )
          )
        )
      )
    )
  );

  updateAdvancedMode$ = createEffect(() =>
    this.actions$.pipe(
      ofType(SettingsActions.updateAdvancedMode),
      switchMap(({ enabled }) =>
        this.settingsService.updateAdvancedMode(enabled).pipe(
          map((result) =>
            SettingsActions.updateAdvancedModeSuccess({
              enabled: result.advancedModeEnabled,
            })
          ),
          catchError((error) =>
            of(
              SettingsActions.updateAdvancedModeFailure({
                error: humanizeError(error, 'Could not save this setting. Please try again.'),
              })
            )
          )
        )
      )
    )
  );
}
