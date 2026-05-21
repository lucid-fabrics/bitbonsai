import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { catchError, map, of } from 'rxjs';
import { ErrorLoggerService } from '../services/error-logger.service';
import { SetupService } from '../services/setup.service';

/**
 * Setup Guard - Ensures first-time setup flow is properly enforced.
 *
 * Logic:
 * - On /setup route:
 *   - If setup IS complete: redirect to /login (setup already done)
 *   - If setup is NOT complete: allow access (needs setup)
 * - On other routes:
 *   - If setup is NOT complete: redirect to /setup (needs setup first)
 *   - If setup IS complete: allow navigation
 * - On error (e.g., API unavailable): allows navigation (fail-open approach)
 *
 * Usage:
 * - Apply to /setup route to prevent access after setup is complete
 * - Apply to all authenticated routes to ensure setup is done first
 * - Should run BEFORE authGuard in the guard chain
 *
 * @param route - The route being activated
 * @returns boolean | UrlTree - true to allow navigation, UrlTree to redirect
 */
export const setupGuard: CanActivateFn = (route) => {
  const setupService = inject(SetupService);
  const router = inject(Router);
  const errorLogger = inject(ErrorLoggerService);

  const isSetupRoute = route.routeConfig?.path === 'setup';

  return setupService.checkSetupStatus().pipe(
    map((status) => {
      if (isSetupRoute) {
        // On setup route: redirect away if setup is already complete
        if (status.isSetupComplete) {
          return router.createUrlTree(['/login']);
        }
        // Setup not complete, allow access to setup page
        return true;
      } else {
        // On other routes: redirect to setup if not complete
        if (!status.isSetupComplete) {
          return router.createUrlTree(['/setup']);
        }
        // Setup complete, allow navigation
        return true;
      }
    }),
    catchError((error) => {
      // On error, allow navigation (fail-open approach)
      // This prevents the app from being locked out if the API is temporarily unavailable
      errorLogger.error('Setup guard error', error);
      return of(true);
    })
  );
};
