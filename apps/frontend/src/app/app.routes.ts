import type { Routes } from '@angular/router';

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
  },
  {
    path: 'queue',
    loadComponent: () => import('./features/queue/queue.page').then((m) => m.QueueComponent),
  },
  {
    path: 'libraries',
    loadComponent: () =>
      import('./features/libraries/libraries.page').then((m) => m.LibrariesComponent),
  },
  {
    path: 'policies',
    loadComponent: () =>
      import('./features/policies/policies.page').then((m) => m.PoliciesComponent),
  },
  {
    path: 'nodes',
    loadComponent: () => import('./features/nodes/nodes.page').then((m) => m.NodesComponent),
  },
  {
    path: 'insights',
    loadComponent: () =>
      import('./features/insights/insights.page').then((m) => m.InsightsComponent),
  },
  {
    path: 'settings',
    loadComponent: () =>
      import('./features/settings/settings.page').then((m) => m.SettingsComponent),
  },
  {
    path: '**',
    redirectTo: 'overview',
  },
];
