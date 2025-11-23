import { HttpHandlerFn, HttpInterceptorFn, HttpRequest } from '@angular/common/http';
import { inject } from '@angular/core';
import { environment } from '../../../environments/environment';
import { NodeConfigService } from '../services/node-config.service';

/**
 * Get the API base URL at runtime
 *
 * Priority:
 * 1. NodeConfigService mainApiUrl (for LINKED nodes, loaded from database)
 * 2. MAIN_API_URL from index.html meta tag (for LINKED nodes pointing to MAIN node)
 * 3. Environment configuration (auto-detected based on port)
 */
function getApiBaseUrl(nodeConfigService: NodeConfigService): string {
  // Priority 1: Check NodeConfigService for dynamically loaded main API URL
  const configuredMainUrl = nodeConfigService.getMainApiUrl();
  if (configuredMainUrl) {
    return configuredMainUrl;
  }

  // Priority 2: Check for main-api-url meta tag (for LINKED nodes)
  const mainApiMeta = document.querySelector('meta[name="main-api-url"]');
  if (mainApiMeta) {
    const mainApiUrl = mainApiMeta.getAttribute('content');
    if (mainApiUrl) {
      return mainApiUrl;
    }
  }

  // Priority 3: Fall back to environment configuration
  return environment.apiUrl;
}

/**
 * API Base URL Interceptor
 *
 * Transforms relative API URLs to absolute URLs based on runtime configuration.
 *
 * This is necessary for LXC deployments where:
 * - Frontend runs on port 3000 (http-server)
 * - Backend runs on port 3100 (NestJS)
 *
 * For LINKED nodes, the meta tag main-api-url can override the API URL to point
 * to the MAIN node's centralized database.
 *
 * For requests starting with '/api/', this interceptor prepends the full backend URL
 * from either the meta tag or environment.apiUrl.
 *
 * Example:
 * - Request: GET /api/v1/discovery/scan
 * - Transforms to: GET http://192.168.1.100:3100/api/v1/discovery/scan
 */
export const apiBaseUrlInterceptor: HttpInterceptorFn = (
  req: HttpRequest<unknown>,
  next: HttpHandlerFn
) => {
  // Only transform requests that start with /api/
  if (req.url.startsWith('/api/')) {
    // Inject NodeConfigService
    const nodeConfigService = inject(NodeConfigService);

    // Endpoints that should ALWAYS use the local backend (never proxied to main node)
    const localOnlyEndpoints = [
      '/api/v1/setup', // Setup and initialization must be done locally on each node
      '/api/v1/nodes/unregister-self',
      '/api/v1/nodes/register',
      '/api/v1/nodes/environment',
      '/api/v1/settings/security',
      '/api/v1/storage-shares/node',
    ];

    // Check if this request should always go to local backend
    const isLocalOnly = localOnlyEndpoints.some((endpoint) => req.url.startsWith(endpoint));

    // Get base URL - use environment.apiUrl for local-only endpoints
    const baseUrl = isLocalOnly ? environment.apiUrl : getApiBaseUrl(nodeConfigService);

    // Construct absolute URL
    // If baseUrl already includes /api/v1, don't duplicate it
    const absoluteUrl = baseUrl.endsWith('/api/v1')
      ? `${baseUrl}${req.url.replace('/api/v1', '')}`
      : `${baseUrl}${req.url}`;

    // Clone request with absolute URL
    const modifiedReq = req.clone({
      url: absoluteUrl,
    });

    return next(modifiedReq);
  }

  // Pass through all other requests unchanged
  return next(req);
};
