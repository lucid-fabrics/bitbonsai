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
import { filter, switchMap } from 'rxjs/operators';
import { AuthService } from './core/auth/auth.service';
import { configureFontAwesome } from './core/config/font-awesome.config';
import { SidebarComponent } from './core/layout/sidebar/sidebar.component';
import { NodeService } from './core/services/node.service';
import { ApiConnectionErrorComponent } from './shared/components/api-connection-error/api-connection-error.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, RouterOutlet, SidebarComponent, ApiConnectionErrorComponent],
  template: `
    @if (showLayout()) {
      <div class="app-layout">
        <app-sidebar />
        <main class="main-content">
          <router-outlet />
        </main>
      </div>
    } @else {
      <router-outlet />
    }
    <app-api-connection-error />
  `,
  styles: [
    `
    .app-layout {
      min-height: 100vh;
      display: flex;
    }

    .main-content {
      flex: 1;
      margin-left: 240px;
      background: #1a1a1a;
    }

    @media (max-width: 768px) {
      .main-content {
        margin-left: 60px;
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

  // Track if we should show the app layout (sidebar + main content)
  // Hide layout on login and setup pages - using signal for reactivity with OnPush
  // Initialize to false to prevent flash of content during initial route check
  readonly showLayout = signal(false);

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
        this.showLayout.set(url !== '/login' && url !== '/setup');
      });

    // Set initial value based on current route
    const currentUrl = this.router.url;
    this.showLayout.set(currentUrl !== '/login' && currentUrl !== '/setup');

    // Fetch current node information only when authenticated
    // This is used for route guards and UI restrictions based on node role
    this.authService.isAuthenticated$
      .pipe(
        filter((isAuthenticated) => isAuthenticated),
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
