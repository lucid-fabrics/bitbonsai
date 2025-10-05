import 'zone.js';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { bootstrapApplication } from '@angular/platform-browser';
import { provideAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { provideEffects } from '@ngrx/effects';
import { provideStore } from '@ngrx/store';
import { provideStoreDevtools } from '@ngrx/store-devtools';
import { AppComponent } from './app/app.component';
import { routes } from './app/app.routes';
import { apiErrorInterceptor } from './app/core/interceptors/api-error.interceptor';
import { MediaStatsEffects } from './app/features/dashboard/+state/dashboard.effects';
import { mediaStatsReducer } from './app/features/dashboard/+state/dashboard.reducer';
import { InsightsEffects } from './app/features/insights/+state/insights.effects';
import { insightsReducer } from './app/features/insights/+state/insights.reducer';
import { LibrariesEffects } from './app/features/libraries/+state/libraries.effects';
import { librariesReducer } from './app/features/libraries/+state/libraries.reducer';
import { NodesEffects } from './app/features/nodes/+state/nodes.effects';
import { nodesReducer } from './app/features/nodes/+state/nodes.reducer';
import { OverviewEffects } from './app/features/overview/+state/overview.effects';
import { overviewReducer } from './app/features/overview/+state/overview.reducer';
import { PoliciesEffects } from './app/features/policies/+state/policies.effects';
import { policiesReducer } from './app/features/policies/+state/policies.reducer';
import { QueueEffects } from './app/features/queue/+state/queue.effects';
import { queueReducer } from './app/features/queue/+state/queue.reducer';
import { SettingsEffects } from './app/features/settings/+state/settings.effects';
import { settingsReducer } from './app/features/settings/+state/settings.reducer';

bootstrapApplication(AppComponent, {
  providers: [
    provideRouter(routes),
    provideHttpClient(withInterceptors([apiErrorInterceptor])),
    provideAnimations(),
    provideStore({
      mediaStats: mediaStatsReducer,
      policies: policiesReducer,
      libraries: librariesReducer,
      nodes: nodesReducer,
      queue: queueReducer,
      overview: overviewReducer,
      insights: insightsReducer,
      settings: settingsReducer,
    }),
    provideEffects([
      MediaStatsEffects,
      PoliciesEffects,
      LibrariesEffects,
      NodesEffects,
      QueueEffects,
      OverviewEffects,
      InsightsEffects,
      SettingsEffects,
    ]),
    provideStoreDevtools({
      maxAge: 25,
      logOnly: false,
    }),
  ],
}).catch((err) => console.error(err));
