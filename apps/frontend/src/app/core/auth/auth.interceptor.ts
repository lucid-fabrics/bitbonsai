import {
  HttpErrorResponse,
  HttpHandlerFn,
  HttpInterceptorFn,
  HttpRequest,
} from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { BehaviorSubject, catchError, filter, Observable, switchMap, take, throwError } from 'rxjs';
import { AuthService } from './auth.service';

/**
 * HTTP interceptor for JWT token injection and automatic token refresh.
 *
 * Features:
 * - Automatically injects Bearer tokens into outgoing requests
 * - Excludes login, refresh, and setup endpoints from token injection
 * - Handles 401 errors with automatic token refresh
 * - Prevents race conditions during concurrent refresh attempts
 * - Redirects to login on authentication failure
 */
export const authInterceptor: HttpInterceptorFn = (
  req: HttpRequest<unknown>,
  next: HttpHandlerFn
) => {
  const authService = inject(AuthService);
  const router = inject(Router);

  // Endpoints that should NOT have Authorization header
  const excludedEndpoints = [
    '/api/v1/auth/login',
    '/api/v1/auth/refresh',
    '/api/v1/setup/status',
    '/api/v1/setup/initialize',
  ];

  // Check if current request should be excluded from token injection
  const isExcluded = excludedEndpoints.some((endpoint) => req.url.includes(endpoint));

  // Clone request and add Authorization header if not excluded
  let authReq = req;
  if (!isExcluded) {
    const token = authService.getAccessToken();
    if (token) {
      authReq = addAuthHeader(req, token);
    }
  }

  // Execute request and handle 401 errors
  return next(authReq).pipe(
    catchError((error: HttpErrorResponse) => {
      // Only handle 401 Unauthorized errors
      if (error.status === 401 && !isExcluded) {
        return handle401Error(authReq, next, authService, router);
      }
      return throwError(() => error);
    })
  );
};

/**
 * Adds Authorization header to request
 */
function addAuthHeader(request: HttpRequest<unknown>, token: string): HttpRequest<unknown> {
  return request.clone({
    setHeaders: {
      Authorization: `Bearer ${token}`,
    },
  });
}

/**
 * Handles 401 errors with token refresh logic.
 * Implements race condition prevention for concurrent refresh attempts.
 */
let isRefreshing = false;
const refreshTokenSubject = new BehaviorSubject<string | null>(null);

function handle401Error(
  request: HttpRequest<unknown>,
  next: HttpHandlerFn,
  authService: AuthService,
  router: Router
): Observable<any> {
  // If already refreshing, queue this request
  if (isRefreshing) {
    return refreshTokenSubject.pipe(
      filter((token) => token !== null),
      take(1),
      switchMap((token) => {
        return next(addAuthHeader(request, token!));
      })
    );
  }

  // Start refresh process
  isRefreshing = true;
  refreshTokenSubject.next(null);

  return authService.refreshToken().pipe(
    switchMap((response: { accessToken: string }) => {
      isRefreshing = false;
      const newToken = response.accessToken;

      // Notify all waiting requests of new token
      refreshTokenSubject.next(newToken);

      // Retry original request with new token
      return next(addAuthHeader(request, newToken));
    }),
    catchError((error: HttpErrorResponse) => {
      isRefreshing = false;
      refreshTokenSubject.next(null);

      // Refresh failed - clear tokens and redirect to login
      authService.clearTokens();
      router.navigate(['/login']);

      return throwError(() => error);
    })
  );
}
