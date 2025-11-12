import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { FaIconLibrary } from '@fortawesome/angular-fontawesome';
import { Store } from '@ngrx/store';
import { filter, switchMap } from 'rxjs/operators';
import { selectIsMainNode } from './core/+state/current-node.selectors';
import { AuthService } from './core/auth/auth.service';
import { configureFontAwesome } from './core/config/font-awesome.config';
import { SidebarComponent } from './core/layout/sidebar/sidebar.component';
import { NodeService } from './core/services/node.service';
import { ApiConnectionErrorComponent } from './shared/components/api-connection-error/api-connection-error.component';
import { NotificationBellComponent } from './shared/components/notification-bell/notification-bell.component';
import { NotificationContainerComponent } from './shared/components/notification-container/notification-container.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    CommonModule,
    RouterOutlet,
    SidebarComponent,
    ApiConnectionErrorComponent,
    NotificationBellComponent,
    NotificationContainerComponent,
  ],
  template: `
    @if (showLayout()) {
      <div class="app-layout">
        <app-sidebar />
        <div class="content-wrapper">
          @if ((isMainNode$ | async) !== false) {
            <header class="app-header">
              <div class="header-spacer"></div>
              <app-notification-bell />
            </header>
          }
          <main class="main-content">
            <router-outlet />
          </main>
        </div>
      </div>
    } @else {
      <router-outlet />
    }
    <app-api-connection-error />
    @if ((isMainNode$ | async) !== false) {
      <app-notification-container />
    }
  `,
  styles: [
    `
    .app-layout {
      min-height: 100vh;
      display: flex;
    }

    .content-wrapper {
      flex: 1;
      margin-left: 240px;
      display: flex;
      flex-direction: column;
    }

    .app-header {
      position: sticky;
      top: 0;
      z-index: 100;
      background: var(--surface-color);
      border-bottom: 1px solid var(--border-color);
      padding: 0.75rem 1.5rem;
      display: flex;
      align-items: center;
      justify-content: space-between;
      min-height: 56px;
    }

    .header-spacer {
      flex: 1;
    }

    .main-content {
      flex: 1;
      background: #1a1a1a;
    }

    @media (max-width: 768px) {
      .content-wrapper {
        margin-left: 60px;
      }

      .app-header {
        padding: 0.5rem 1rem;
      }
    }
  `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppComponent implements OnInit {
  title = 'BitBonsai';

  private readonly router = inject(Router);
  private readonly authService = inject(AuthService);
  private readonly nodeService = inject(NodeService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly store = inject(Store);

  // Track if we should show the app layout (sidebar + main content)
  // Hide layout on login and setup pages - using signal for reactivity with OnPush
  // Initialize to false to prevent flash of content during initial route check
  readonly showLayout = signal(false);

  // Only show notifications for MAIN nodes (child nodes don't need real-time notifications)
  readonly isMainNode$ = this.store.select(selectIsMainNode);

  constructor() {
    const library = inject(FaIconLibrary);
    configureFontAwesome(library);
  }

  ngOnInit(): void {
    // Update showLayout signal on route changes
    this.router.events
      .pipe(
        filter((event): event is NavigationEnd => event instanceof NavigationEnd),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((event: NavigationEnd) => {
        const url = event.urlAfterRedirects;
        this.showLayout.set(url !== '/login' && url !== '/setup' && url !== '/node-setup');
      });

    // Set initial value based on current route
    const currentUrl = this.router.url;
    this.showLayout.set(
      currentUrl !== '/login' && currentUrl !== '/setup' && currentUrl !== '/node-setup'
    );

    // Fetch current node information only when authenticated AND not on setup/node-setup routes
    // This is used for route guards and UI restrictions based on node role
    this.authService.isAuthenticated$
      .pipe(
        filter((isAuthenticated) => {
          const currentUrl = this.router.url;
          const isSetupRoute = currentUrl === '/setup' || currentUrl === '/node-setup';
          return isAuthenticated && !isSetupRoute;
        }),
        switchMap(() => this.nodeService.getCurrentNode()),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe({
        error: (err) => {
          console.error('Failed to fetch current node information:', err);
          // If no nodes are registered, the app will still work
          // The user will need to register a node first
        },
      });
  }
}
