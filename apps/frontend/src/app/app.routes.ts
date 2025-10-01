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
      import('./features/overview/overview.component').then((m) => m.OverviewComponent),
  },
  {
    path: 'queue',
    loadComponent: () => import('./features/queue/queue.component').then((m) => m.QueueComponent),
  },
  {
    path: 'libraries',
    loadComponent: () =>
      import('./features/libraries/libraries.component').then((m) => m.LibrariesComponent),
  },
  {
    path: 'policies',
    loadComponent: () =>
      import('./features/policies/policies.component').then((m) => m.PoliciesComponent),
  },
  {
    path: 'nodes',
    loadComponent: () => import('./features/nodes/nodes.component').then((m) => m.NodesComponent),
  },
  {
    path: 'insights',
    loadComponent: () =>
      import('./features/insights/insights.component').then((m) => m.InsightsComponent),
  },
  {
    path: 'settings',
    loadComponent: () =>
      import('./features/settings/settings.component').then((m) => m.SettingsComponent),
  },
  {
    path: '**',
    redirectTo: 'overview',
  },
];
