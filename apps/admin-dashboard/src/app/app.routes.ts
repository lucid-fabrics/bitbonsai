import { Route } from '@angular/router';
import { AuthGuard } from './guards/auth.guard';

export const appRoutes: Route[] = [
  {
    path: 'login',
    loadComponent: () => import('./pages/login/login.component').then((m) => m.LoginComponent),
  },
  {
    path: '',
    canActivate: [AuthGuard],
    children: [
      {
        path: '',
        redirectTo: 'dashboard',
        pathMatch: 'full',
      },
      {
        path: 'dashboard',
        loadComponent: () =>
          import('./pages/dashboard/dashboard.component').then((m) => m.DashboardComponent),
      },
      {
        path: 'licenses',
        loadComponent: () =>
          import('./pages/licenses/licenses.component').then((m) => m.LicensesComponent),
      },
      {
        path: 'pricing',
        loadComponent: () =>
          import('./pages/pricing/pricing.component').then((m) => m.PricingComponent),
      },
      {
        path: 'promo-codes',
        loadComponent: () =>
          import('./pages/promo-codes/promo-codes.component').then((m) => m.PromoCodesComponent),
      },
      {
        path: 'donations',
        loadComponent: () =>
          import('./pages/donations/donations.component').then((m) => m.DonationsComponent),
      },
      {
        path: 'config',
        loadComponent: () =>
          import('./pages/config/config.component').then((m) => m.ConfigComponent),
      },
      {
        path: 'analytics',
        loadComponent: () =>
          import('./pages/analytics/analytics.component').then((m) => m.AnalyticsComponent),
      },
      {
        path: 'audit-log',
        loadComponent: () =>
          import('./pages/audit-log/audit-log.component').then((m) => m.AuditLogComponent),
      },
      {
        path: 'webhooks',
        loadComponent: () =>
          import('./pages/webhooks/webhooks.component').then((m) => m.WebhooksComponent),
      },
    ],
  },
  {
    path: '**',
    redirectTo: 'login',
  },
];
