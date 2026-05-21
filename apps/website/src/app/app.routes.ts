import { Route } from '@angular/router';
import { authGuard } from './guards/auth.guard';
import { endUserAuthGuard } from './guards/end-user-auth.guard';

export const appRoutes: Route[] = [
  {
    path: '',
    loadComponent: () => import('./pages/home/home.component').then((m) => m.HomeComponent),
  },
  {
    path: 'pricing',
    loadComponent: () =>
      import('./pages/pricing/pricing.component').then((m) => m.PricingComponent),
  },
  {
    path: 'download',
    loadComponent: () =>
      import('./pages/download/download.component').then((m) => m.DownloadComponent),
  },
  {
    path: 'docs',
    loadComponent: () => import('./pages/docs/docs.component').then((m) => m.DocsComponent),
  },
  {
    path: 'compare',
    loadComponent: () =>
      import('./pages/compare/compare.component').then((m) => m.CompareComponent),
  },
  {
    path: 'checkout',
    loadComponent: () =>
      import('./pages/checkout/checkout.component').then((m) => m.CheckoutComponent),
  },
  {
    path: 'success',
    loadComponent: () =>
      import('./pages/success/success.component').then((m) => m.SuccessComponent),
  },
  {
    path: 'privacy',
    loadComponent: () =>
      import('./pages/privacy/privacy.component').then((m) => m.PrivacyComponent),
  },
  {
    path: 'terms',
    loadComponent: () => import('./pages/terms/terms.component').then((m) => m.TermsComponent),
  },
  {
    path: 'signup',
    loadComponent: () => import('./pages/signup/signup.component').then((m) => m.SignupComponent),
  },
  {
    path: 'login',
    loadComponent: () =>
      import('./pages/user-login/user-login.component').then((m) => m.UserLoginComponent),
  },
  {
    path: 'device',
    loadComponent: () => import('./pages/device/device.component').then((m) => m.DeviceComponent),
  },
  {
    path: 'account',
    loadComponent: () =>
      import('./pages/account/account.component').then((m) => m.AccountComponent),
    canActivate: [endUserAuthGuard],
  },
  {
    path: 'reset-password',
    loadComponent: () =>
      import('./pages/reset-password/reset-password.component').then(
        (m) => m.ResetPasswordComponent
      ),
  },
  {
    path: 'verify-email',
    loadComponent: () =>
      import('./pages/verify-email/verify-email.component').then((m) => m.VerifyEmailComponent),
  },
  {
    path: 'admin/login',
    loadComponent: () =>
      import('./pages/admin/login/login.component').then((m) => m.LoginComponent),
  },
  {
    path: 'admin/dashboard',
    loadComponent: () =>
      import('./pages/admin/dashboard/dashboard.component').then((m) => m.DashboardComponent),
    canActivate: [authGuard],
  },
];
