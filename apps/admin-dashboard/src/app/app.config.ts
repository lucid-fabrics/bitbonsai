import { provideHttpClient, withInterceptorsFromDi } from '@angular/common/http';
import {
  ApplicationConfig,
  isDevMode,
  provideBrowserGlobalErrorListeners,
  provideZoneChangeDetection,
} from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideEffects } from '@ngrx/effects';
import { provideStore } from '@ngrx/store';
import { provideStoreDevtools } from '@ngrx/store-devtools';
import { appRoutes } from './app.routes';
import { DashboardEffects } from './pages/dashboard/+state/dashboard.effects';
import { dashboardReducer } from './pages/dashboard/+state/dashboard.reducer';
import { LicensesEffects } from './pages/licenses/+state/licenses.effects';
import { licensesReducer } from './pages/licenses/+state/licenses.reducer';
import { LoginEffects } from './pages/login/+state/login.effects';
import { loginReducer } from './pages/login/+state/login.reducer';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(appRoutes),
    provideHttpClient(withInterceptorsFromDi()),
    provideStore({
      login: loginReducer,
      dashboard: dashboardReducer,
      licenses: licensesReducer,
    }),
    provideEffects([LoginEffects, DashboardEffects, LicensesEffects]),
    provideStoreDevtools({ maxAge: 25, logOnly: !isDevMode() }),
  ],
};
