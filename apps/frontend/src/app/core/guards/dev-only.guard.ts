import { inject } from '@angular/core';
import { type CanActivateFn, Router } from '@angular/router';
import { environment } from '../../../environments/environment';

/**
 * Guard that prevents access to routes in production
 * Use this to protect debug/development-only features
 */
export const devOnlyGuard: CanActivateFn = () => {
  if (environment.production) {
    const router = inject(Router);
    router.navigate(['/settings']);
    return false;
  }
  return true;
};
