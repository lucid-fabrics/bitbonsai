import { HttpClient } from '@angular/common/http';
import { inject } from '@angular/core';
import {
  ActivatedRouteSnapshot,
  CanActivateFn,
  Router,
  RouterStateSnapshot,
  UrlTree,
} from '@angular/router';
import { Observable, of } from 'rxjs';
import { catchError, map, switchMap, take, timeout } from 'rxjs/operators';
import { AuthService } from './auth.service';

/**
 * Authentication guard to protect routes from unauthorized access.
 *
 * This functional guard checks if the user is authenticated before allowing
 * route activation. If not authenticated, it checks if local network bypass
 * is enabled. If neither condition is met, redirects to login with returnUrl.
 *
 * @example
 * ```typescript
 * {
 *   path: 'protected',
 *   component: ProtectedComponent,
 *   canActivate: [authGuard]
 * }
 * ```
 */
export const authGuard: CanActivateFn = (
  _route: ActivatedRouteSnapshot,
  state: RouterStateSnapshot
): Observable<boolean | UrlTree> | Promise<boolean | UrlTree> | boolean | UrlTree => {
  const authService = inject(AuthService);
  const router = inject(Router);
  const http = inject(HttpClient);

  return authService.isAuthenticated$.pipe(
    take(1),
    switchMap((isAuthenticated: boolean) => {
      // If authenticated with token, allow access
      if (isAuthenticated) {
        return of(true);
      }

      // If not authenticated, check if local network bypass is enabled
      // DEEP AUDIT P2: Add 5-second timeout to prevent guard from hanging
      return http.get<{ allowLocalNetworkWithoutAuth: boolean }>('/api/v1/settings/security').pipe(
        timeout(5000), // DEEP AUDIT P2: 5-second timeout
        map((settings) => {
          // If local network bypass is enabled, allow access without authentication
          if (settings.allowLocalNetworkWithoutAuth) {
            return true;
          }

          // Otherwise, redirect to login
          return router.createUrlTree(['/login'], {
            queryParams: { returnUrl: state.url },
          });
        }),
        catchError(() => {
          // If security settings check fails or times out, redirect to login
          return of(
            router.createUrlTree(['/login'], {
              queryParams: { returnUrl: state.url },
            })
          );
        })
      );
    })
  );
};
