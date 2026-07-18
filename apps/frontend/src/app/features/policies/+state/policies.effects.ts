import { Injectable, inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { of } from 'rxjs';
import { catchError, map, switchMap, tap } from 'rxjs/operators';
import { humanizeError } from '../../../core/services/error-humanizer';
import { ToastService } from '../../../core/services/toast.service';
import { PolicyService } from '../services/policy.service';
import { PoliciesActions } from './policies.actions';

@Injectable()
export class PoliciesEffects {
  private readonly actions$ = inject(Actions);
  private readonly policyService = inject(PolicyService);
  private readonly toast = inject(ToastService);

  loadPolicies$ = createEffect(() =>
    this.actions$.pipe(
      ofType(PoliciesActions.loadPolicies),
      switchMap(() =>
        this.policyService.getPolicies().pipe(
          map((policies) => PoliciesActions.loadPoliciesSuccess({ policies })),
          catchError((error) => of(
            PoliciesActions.loadPoliciesFailure({
              error: humanizeError(error, 'Could not load your encoding policies. Retrying automatically.'),
            })
          ))
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
          catchError((error) => of(
            PoliciesActions.loadPresetsFailure({
              error: humanizeError(error, 'Could not load the built-in presets. Retrying automatically.'),
            })
          ))
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
          catchError((error) => of(
            PoliciesActions.createPolicyFailure({
              error: humanizeError(error, 'Could not create this policy. Please try again.'),
            })
          ))
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
          catchError((error) => of(
            PoliciesActions.updatePolicyFailure({
              error: humanizeError(error, 'Could not save your changes. Please try again.'),
            })
          ))
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
          catchError((error) => of(
            PoliciesActions.deletePolicyFailure({
              error: humanizeError(error, 'Could not remove this policy. Please try again.'),
            })
          ))
        )
      )
    )
  );

  successFeedback$ = createEffect(
    () =>
      this.actions$.pipe(
        ofType(
          PoliciesActions.createPolicySuccess,
          PoliciesActions.updatePolicySuccess,
          PoliciesActions.deletePolicySuccess
        ),
        tap((action) => {
          switch (action.type) {
            case PoliciesActions.createPolicySuccess.type:
              this.toast.success('Policy created');
              break;
            case PoliciesActions.updatePolicySuccess.type:
              this.toast.success('Saved');
              break;
            case PoliciesActions.deletePolicySuccess.type:
              this.toast.success('Policy removed');
              break;
          }
        })
      ),
    { dispatch: false }
  );
}
