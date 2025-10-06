import { inject } from '@angular/core';
import type { CanActivateFn } from '@angular/router';
import { Router } from '@angular/router';
import { NodeService } from '../services/node.service';

/**
 * Main Node Route Guard
 *
 * Restricts routes to MAIN nodes only.
 * LINKED (child) nodes will be redirected to /queue page.
 *
 * Usage:
 * ```typescript
 * {
 *   path: 'libraries',
 *   component: LibrariesPage,
 *   canActivate: [mainNodeGuard],
 * }
 * ```
 */
export const mainNodeGuard: CanActivateFn = () => {
  const nodeService = inject(NodeService);
  const router = inject(Router);

  // If node is MAIN, allow access
  if (nodeService.isMainNode()) {
    return true;
  }

  // If node is LINKED, redirect to queue page (child nodes can only view queue)
  if (nodeService.isLinkedNode()) {
    return router.createUrlTree(['/queue']);
  }

  // If node info not loaded yet, allow access (will be checked after node info loads)
  // This prevents blocking during app initialization
  return true;
};
