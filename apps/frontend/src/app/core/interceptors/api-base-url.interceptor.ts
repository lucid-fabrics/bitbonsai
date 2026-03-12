import { HttpHandlerFn, HttpInterceptorFn, HttpRequest } from '@angular/common/http';
import { inject } from '@angular/core';
import { environment } from '../../../environments/environment';
import { NodeConfigService } from '../services/node-config.service';

/**
 * DEEP AUDIT P1: Validate API URL to prevent XSS injection attacks
 * DEEP AUDIT FIX: Added proper octet range validation (0-255)
 *
 * Only allows:
 * - http:// or https:// protocols
 * - localhost or 127.0.0.1
 * - Private IP ranges with valid octets (0-255):
 *   - 192.168.x.x
 *   - 10.x.x.x
 *   - 172.16-31.x.x
 *
 * @param url - URL to validate
 * @returns true if URL is safe to use
 */
function isValidApiUrl(url: string): boolean {
  try {
    const parsed = new URL(url);

    // Only allow http/https protocols
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return false;
    }

    const hostname = parsed.hostname;

    // Allow localhost
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
      return true;
    }

    // DEEP AUDIT FIX: Parse and validate IP octets properly
    const ipParts = hostname.split('.');
    if (ipParts.length !== 4) {
      return false;
    }

    const octets = ipParts.map((s) => parseInt(s, 10));

    // Validate all octets are numbers in range 0-255
    if (octets.some((n) => Number.isNaN(n) || n < 0 || n > 255)) {
      return false;
    }

    // 192.168.x.x (Private Class C)
    if (octets[0] === 192 && octets[1] === 168) {
      return true;
    }

    // 10.x.x.x (Private Class A)
    if (octets[0] === 10) {
      return true;
    }

    // 172.16.0.0 - 172.31.255.255 (Private Class B)
    if (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) {
      return true;
    }

    // Reject all other URLs (public IPs, domains, etc.)
    return false;
  } catch {
    // Invalid URL format
    return false;
  }
}

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
  if (configuredMainUrl && isValidApiUrl(configuredMainUrl)) {
    return configuredMainUrl;
  }

  // Priority 2: Check for main-api-url meta tag (for LINKED nodes)
  // DEEP AUDIT P1: Validate URL from meta tag to prevent XSS injection
  const mainApiMeta = document.querySelector('meta[name="main-api-url"]');
  if (mainApiMeta) {
    const mainApiUrl = mainApiMeta.getAttribute('content');
    if (mainApiUrl && isValidApiUrl(mainApiUrl)) {
      return mainApiUrl;
    }
  }

  // Priority 3: Fall back to environment configuration
  // DEEP AUDIT FIX: Validate environment fallback too (defense in depth)
  // Note: In production builds served from the same origin (port 8108), apiUrl is '/api/v1'
  // which is a relative URL and is always valid for same-origin requests.
  const envApiUrl = environment.apiUrl;

  // Relative URLs (starting with /) are valid for same-origin requests
  if (envApiUrl.startsWith('/')) {
    return envApiUrl;
  }

  // Absolute URLs must be validated
  if (isValidApiUrl(envApiUrl)) {
    return envApiUrl;
  }

  // Absolute fallback - should never reach here in normal operation
  return 'http://localhost:3100';
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
