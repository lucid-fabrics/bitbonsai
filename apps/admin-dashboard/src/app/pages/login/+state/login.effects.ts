import { Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { of } from 'rxjs';
import { catchError, switchMap, tap } from 'rxjs/operators';
import { ApiService } from '../../../services/api.service';
import { AuthService } from '../../../services/auth.service';
import * as LoginActions from './login.actions';

@Injectable()
export class LoginEffects {
  private readonly actions$ = inject(Actions);
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  login$ = createEffect(() =>
    this.actions$.pipe(
      ofType(LoginActions.login),
      switchMap(({ apiKey }) =>
        this.api.testAdminAuth(apiKey).then(
          () => {
            this.auth.setApiKey(apiKey);
            return LoginActions.loginSuccess();
          },
          (error) => LoginActions.loginFailure({ error: error.message || 'Authentication failed' })
        )
      ),
      catchError((error) => of(LoginActions.loginFailure({ error: error.message })))
    )
  );

  loginSuccess$ = createEffect(
    () =>
      this.actions$.pipe(
        ofType(LoginActions.loginSuccess),
        tap(() => this.router.navigate(['/dashboard']))
      ),
    { dispatch: false }
  );
}
