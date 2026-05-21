import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { EndUserAuthService } from '../services/end-user-auth.service';

export const endUserAuthGuard: CanActivateFn = () => {
  const authService = inject(EndUserAuthService);
  const router = inject(Router);

  // Allow OAuth redirects through so the component can call handleOAuthFragment()
  if (window.location.hash.startsWith('#token=')) {
    return true;
  }

  if (authService.isLoggedIn()) {
    return true;
  }

  router.navigate(['/login']);
  return false;
};
