import type { Routes } from '@angular/router';
import { mainNodeGuard } from './core/guards/main-node.guard';

/**
 * Application Routes
 *
 * Route Access Control:
 * - MAIN nodes: Can access all pages
 * - LINKED nodes (child nodes): Restricted to queue and settings pages only
 *
 * Protected Routes (MAIN node only):
 * - overview, libraries, policies, nodes, insights
 */
export const routes: Routes = [
  {
    path: '',
    redirectTo: 'overview',
    pathMatch: 'full',
  },
  {
    path: 'overview',
    loadComponent: () =>
      import('./features/overview/overview.page').then((m) => m.OverviewComponent),
    canActivate: [mainNodeGuard],
  },
  {
    path: 'queue',
    loadComponent: () => import('./features/queue/queue.page').then((m) => m.QueueComponent),
    // Queue is accessible to both MAIN and LINKED nodes
  },
  {
    path: 'libraries',
    loadComponent: () =>
      import('./features/libraries/libraries.page').then((m) => m.LibrariesComponent),
    canActivate: [mainNodeGuard],
  },
  {
    path: 'policies',
    loadComponent: () =>
      import('./features/policies/policies.page').then((m) => m.PoliciesComponent),
    canActivate: [mainNodeGuard],
  },
  {
    path: 'nodes',
    loadComponent: () => import('./features/nodes/nodes.page').then((m) => m.NodesComponent),
    canActivate: [mainNodeGuard],
  },
  {
    path: 'insights',
    loadComponent: () =>
      import('./features/insights/insights.page').then((m) => m.InsightsComponent),
    canActivate: [mainNodeGuard],
  },
  {
    path: 'settings',
    loadComponent: () =>
      import('./features/settings/settings.page').then((m) => m.SettingsComponent),
    // Settings is accessible to both MAIN and LINKED nodes
  },
  {
    path: '**',
    redirectTo: 'queue', // Redirect to queue (accessible by all nodes)
  },
];
