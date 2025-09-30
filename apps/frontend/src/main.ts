import { bootstrapApplication } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideStore } from '@ngrx/store';
import { provideEffects } from '@ngrx/effects';
import { provideStoreDevtools } from '@ngrx/store-devtools';
import { AppComponent } from './app/app.component';
import { routes } from './app/app.routes';
import { provideAnimations } from '@angular/platform-browser/animations';
import { mediaStatsReducer } from './app/features/dashboard/+state/dashboard.reducer';
import { MediaStatsEffects } from './app/features/dashboard/+state/dashboard.effects';

bootstrapApplication(AppComponent, {
  providers: [
    provideRouter(routes),
    provideHttpClient(),
    provideAnimations(),
    provideStore({
      mediaStats: mediaStatsReducer
    }),
    provideEffects([MediaStatsEffects]),
    provideStoreDevtools({
      maxAge: 25,
      logOnly: false
    })
  ]
}).catch((err) => console.error(err));
