import { HttpHandlerFn, HttpInterceptorFn, HttpRequest } from '@angular/common/http';
import { environment } from '../../../environments/environment';

/**
 * API Base URL Interceptor
 *
 * Transforms relative API URLs to absolute URLs based on environment configuration.
 *
 * This is necessary for LXC deployments where:
 * - Frontend runs on port 3000 (http-server)
 * - Backend runs on port 3100 (NestJS)
 *
 * For requests starting with '/api/', this interceptor prepends the full backend URL
 * from environment.apiUrl instead of using relative paths.
 *
 * Example:
 * - Request: GET /api/v1/discovery/scan
 * - Transforms to: GET http://192.168.1.198:3100/api/v1/discovery/scan
 */
export const apiBaseUrlInterceptor: HttpInterceptorFn = (
  req: HttpRequest<unknown>,
  next: HttpHandlerFn
) => {
  // Only transform requests that start with /api/
  if (req.url.startsWith('/api/')) {
    // Get base URL from environment (e.g., http://192.168.1.198:3100/api/v1)
    const baseUrl = environment.apiUrl;

    // Remove /api/v1 from the request URL and append to baseUrl
    const apiPath = req.url.replace('/api/v1', '');
    const absoluteUrl = `${baseUrl}${apiPath}`;

    // Clone request with absolute URL
    const modifiedReq = req.clone({
      url: absoluteUrl,
    });

    return next(modifiedReq);
  }

  // Pass through all other requests unchanged
  return next(req);
};
