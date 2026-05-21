import { inject } from '@angular/core';
import type { CanActivateFn } from '@angular/router';
import { Router } from '@angular/router';
import { Store } from '@ngrx/store';
import { map } from 'rxjs/operators';
import { NodeRole } from '../../features/nodes/models/node.model';
import { selectCurrentNode } from '../+state/current-node.selectors';

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
  const store = inject(Store);
  const router = inject(Router);

  return store.select(selectCurrentNode).pipe(
    map((node) => {
      // If node info not loaded yet, allow access (will be checked after node info loads)
      if (!node) {
        return true;
      }

      // If node is MAIN, allow access
      if (node.role === NodeRole.MAIN) {
        return true;
      }

      // If node is LINKED, redirect to queue page (child nodes can only view queue)
      return router.createUrlTree(['/queue']);
    })
  );
};
