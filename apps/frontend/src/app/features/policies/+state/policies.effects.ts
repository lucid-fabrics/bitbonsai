import { Injectable, inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { of } from 'rxjs';
import { catchError, map, switchMap } from 'rxjs/operators';
import { PolicyService } from '../services/policy.service';
import { PoliciesActions } from './policies.actions';

@Injectable()
export class PoliciesEffects {
  private readonly actions$ = inject(Actions);
  private readonly policyService = inject(PolicyService);

  loadPolicies$ = createEffect(() =>
    this.actions$.pipe(
      ofType(PoliciesActions.loadPolicies),
      switchMap(() =>
        this.policyService.getPolicies().pipe(
          map((policies) => PoliciesActions.loadPoliciesSuccess({ policies })),
          catchError((error) => of(PoliciesActions.loadPoliciesFailure({ error: error.message })))
        )
      )
    )
  );

  loadPresets$ = createEffect(() =>
    this.actions$.pipe(
      ofType(PoliciesActions.loadPresets),
      switchMap(() =>
        this.policyService.getPresets().pipe(
          map((presets) => PoliciesActions.loadPresetsSuccess({ presets })),
          catchError((error) => of(PoliciesActions.loadPresetsFailure({ error: error.message })))
        )
      )
    )
  );

  createPolicy$ = createEffect(() =>
    this.actions$.pipe(
      ofType(PoliciesActions.createPolicy),
      switchMap(({ request }) =>
        this.policyService.createPolicy(request).pipe(
          map((policy) => PoliciesActions.createPolicySuccess({ policy })),
          catchError((error) => of(PoliciesActions.createPolicyFailure({ error: error.message })))
        )
      )
    )
  );

  updatePolicy$ = createEffect(() =>
    this.actions$.pipe(
      ofType(PoliciesActions.updatePolicy),
      switchMap(({ id, request }) =>
        this.policyService.updatePolicy(id, request).pipe(
          map((policy) => PoliciesActions.updatePolicySuccess({ policy })),
          catchError((error) => of(PoliciesActions.updatePolicyFailure({ error: error.message })))
        )
      )
    )
  );

  deletePolicy$ = createEffect(() =>
    this.actions$.pipe(
      ofType(PoliciesActions.deletePolicy),
      switchMap(({ id }) =>
        this.policyService.deletePolicy(id).pipe(
          map(() => PoliciesActions.deletePolicySuccess({ id })),
          catchError((error) => of(PoliciesActions.deletePolicyFailure({ error: error.message })))
        )
      )
    )
  );
}
