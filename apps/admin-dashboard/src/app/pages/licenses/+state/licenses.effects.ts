import { Injectable, inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { of } from 'rxjs';
import { catchError, map, switchMap, tap } from 'rxjs/operators';
import { LicenseApiService } from '../../../services/license-api.service';
import * as LicensesActions from './licenses.actions';

@Injectable()
export class LicensesEffects {
  private readonly actions$ = inject(Actions);
  private readonly licenseApi = inject(LicenseApiService);

  loadLicenses$ = createEffect(() =>
    this.actions$.pipe(
      ofType(LicensesActions.loadLicenses),
      switchMap(({ skip, take, tier }) =>
        this.licenseApi.listLicenses({ skip, take, tier }).pipe(
          map((response) =>
            LicensesActions.loadLicensesSuccess({ licenses: response.data, total: response.total })
          ),
          catchError((error) =>
            of(
              LicensesActions.loadLicensesFailure({
                error: error.message || 'Failed to load licenses',
              })
            )
          )
        )
      )
    )
  );

  searchLicenses$ = createEffect(() =>
    this.actions$.pipe(
      ofType(LicensesActions.searchLicenses),
      switchMap(({ email }) =>
        this.licenseApi.getLicensesByEmail(email).pipe(
          map((licenses) => LicensesActions.searchLicensesSuccess({ licenses })),
          catchError((error) =>
            of(
              LicensesActions.searchLicensesFailure({
                error: error.message || 'Failed to search licenses',
              })
            )
          )
        )
      )
    )
  );

  createLicense$ = createEffect(() =>
    this.actions$.pipe(
      ofType(LicensesActions.createLicense),
      switchMap(({ email, tier, expiresAt, notes }) =>
        this.licenseApi.createLicense({ email, tier, expiresAt, notes }).pipe(
          map(() => LicensesActions.createLicenseSuccess()),
          catchError((error) =>
            of(
              LicensesActions.createLicenseFailure({
                error: error.message || 'Failed to create license',
              })
            )
          )
        )
      )
    )
  );

  createLicenseSuccess$ = createEffect(
    () =>
      this.actions$.pipe(
        ofType(LicensesActions.createLicenseSuccess),
        tap(() => {
          // Reload licenses after creation - dispatched manually in component
        })
      ),
    { dispatch: false }
  );

  revokeLicense$ = createEffect(() =>
    this.actions$.pipe(
      ofType(LicensesActions.revokeLicense),
      switchMap(({ licenseId, reason }) =>
        this.licenseApi.revokeLicense(licenseId, reason).pipe(
          map(() => LicensesActions.revokeLicenseSuccess()),
          catchError((error) =>
            of(
              LicensesActions.revokeLicenseFailure({
                error: error.message || 'Failed to revoke license',
              })
            )
          )
        )
      )
    )
  );

  revokeLicenseSuccess$ = createEffect(
    () =>
      this.actions$.pipe(
        ofType(LicensesActions.revokeLicenseSuccess),
        tap(() => {
          // Reload licenses after revocation - dispatched manually in component
        })
      ),
    { dispatch: false }
  );
}
