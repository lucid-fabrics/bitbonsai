import type { Routes } from '@angular/router';
import { authGuard } from './core/auth/auth.guard';
import { mainNodeGuard } from './core/guards/main-node.guard';
import { setupGuard } from './core/guards/setup.guard';

/**
 * Application Routes
 *
 * Route Access Control:
 * - Setup: Public (no guards) - first-time setup flow
 * - Login: Public (setupGuard only) - requires setup to be complete
 * - All other routes: Require setup completion + authentication (setupGuard + authGuard)
 * - MAIN nodes: Can access all authenticated pages
 * - LINKED nodes (child nodes): Can access overview, queue, and settings pages
 *
 * Guard Order:
 * 1. setupGuard - ensures setup is complete before allowing access
 * 2. authGuard - ensures user is authenticated
 * 3. mainNodeGuard - ensures MAIN node for restricted routes
 *
 * Protected Routes (MAIN node only):
 * - libraries, policies, nodes, insights
 *
 * Accessible to Both MAIN and LINKED nodes:
 * - overview, queue, settings
 */
export const routes: Routes = [
  {
    path: '',
    redirectTo: 'overview',
    pathMatch: 'full',
  },
  {
    path: 'setup',
    loadComponent: () => import('./features/setup/setup.page').then((m) => m.SetupComponent),
    canActivate: [setupGuard],
    // Setup guard will redirect away if setup is already complete
  },
  {
    path: 'node-setup',
    loadComponent: () =>
      import('./features/node-setup/node-setup-wizard.component').then(
        (m) => m.NodeSetupWizardComponent
      ),
    // Child node setup wizard - no guards (public access for initial setup)
  },
  {
    path: 'login',
    loadComponent: () => import('./features/auth/login/login.page').then((m) => m.LoginComponent),
    canActivate: [setupGuard],
    // Login requires setup to be complete but no authentication
  },
  {
    path: 'overview',
    loadComponent: () =>
      import('./features/overview/overview.page').then((m) => m.OverviewComponent),
    canActivate: [setupGuard, authGuard],
    // Overview is accessible to both MAIN and LINKED nodes
  },
  {
    path: 'queue',
    loadComponent: () => import('./features/queue/queue.page').then((m) => m.QueueComponent),
    canActivate: [setupGuard, authGuard],
    // Queue is accessible to both MAIN and LINKED nodes (but requires setup + auth)
  },
  {
    path: 'libraries',
    loadComponent: () =>
      import('./features/libraries/libraries.page').then((m) => m.LibrariesComponent),
    canActivate: [setupGuard, authGuard, mainNodeGuard],
  },
  {
    path: 'policies',
    loadComponent: () =>
      import('./features/policies/policies.page').then((m) => m.PoliciesComponent),
    canActivate: [setupGuard, authGuard, mainNodeGuard],
  },
  {
    path: 'nodes',
    loadComponent: () => import('./features/nodes/nodes.page').then((m) => m.NodesComponent),
    canActivate: [setupGuard, authGuard, mainNodeGuard],
  },
  {
    path: 'pending-requests',
    loadComponent: () =>
      import('./features/pending-requests/pending-requests.page').then(
        (m) => m.PendingRequestsPage
      ),
    canActivate: [setupGuard, authGuard, mainNodeGuard],
  },
  {
    path: 'discovery',
    loadComponent: () =>
      import('./features/discovery/discovery.page').then((m) => m.DiscoveryComponent),
    canActivate: [authGuard], // No setupGuard or mainNodeGuard - accessible during setup and for CHILD nodes
  },
  {
    path: 'insights',
    loadComponent: () =>
      import('./features/insights/insights.page').then((m) => m.InsightsComponent),
    canActivate: [setupGuard, authGuard, mainNodeGuard],
  },
  {
    path: 'settings',
    loadComponent: () =>
      import('./features/settings/settings.page').then((m) => m.SettingsComponent),
    canActivate: [setupGuard, authGuard],
    // Settings is accessible to both MAIN and LINKED nodes (but requires setup + auth)
  },
  {
    path: 'settings/:tab',
    loadComponent: () =>
      import('./features/settings/settings.page').then((m) => m.SettingsComponent),
    canActivate: [setupGuard, authGuard],
    // Settings with tab parameter (e.g., /settings/license)
  },
  {
    path: '**',
    redirectTo: 'queue', // Redirect to queue (accessible by all authenticated nodes)
  },
];
