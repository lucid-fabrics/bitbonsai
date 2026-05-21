import 'zone.js';
import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { bootstrapApplication } from '@angular/platform-browser';
import { provideAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { provideTransloco, TranslocoLoader } from '@ngneat/transloco';
import { provideEffects } from '@ngrx/effects';
import { provideStore } from '@ngrx/store';
import { provideStoreDevtools } from '@ngrx/store-devtools';
import { Observable } from 'rxjs';
import { AppComponent } from './app/app.component';
import { routes } from './app/app.routes';
import { CurrentNodeEffects } from './app/core/+state/current-node.effects';
import { currentNodeReducer } from './app/core/+state/current-node.reducer';
import { authInterceptor } from './app/core/auth/auth.interceptor';
import { apiBaseUrlInterceptor } from './app/core/interceptors/api-base-url.interceptor';
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
import { environment } from './environments/environment';

class TranslocoHttpLoader implements TranslocoLoader {
  constructor(private http: HttpClient) {}
  getTranslation(lang: string): Observable<Record<string, unknown>> {
    return this.http.get<Record<string, unknown>>(`/assets/i18n/${lang}.json`);
  }
}

bootstrapApplication(AppComponent, {
  providers: [
    provideRouter(routes),
    provideHttpClient(
      withInterceptors([apiBaseUrlInterceptor, authInterceptor, apiErrorInterceptor])
    ),
    provideAnimations(),
    provideTransloco({
      config: {
        availableLangs: ['en'],
        defaultLang: 'en',
        reRenderOnLangChange: true,
        prodMode: environment.production,
      },
      loader: TranslocoHttpLoader,
    }),
    provideStore({
      // Core state
      currentNode: currentNodeReducer,
      // Feature states
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
      // Core effects
      CurrentNodeEffects,
      // Feature effects
      MediaStatsEffects,
      PoliciesEffects,
      LibrariesEffects,
      NodesEffects,
      QueueEffects,
      OverviewEffects,
      InsightsEffects,
      SettingsEffects,
    ]),
    // NgRx DevTools: Only enable in development
    ...(environment.production
      ? []
      : [
          provideStoreDevtools({
            maxAge: 25,
            logOnly: false,
          }),
        ]),
  ],
}).catch((err) => console.error(err));
