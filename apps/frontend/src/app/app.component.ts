import { ChangeDetectionStrategy, Component, inject, OnInit } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { FaIconLibrary } from '@fortawesome/angular-fontawesome';
import { configureFontAwesome } from './core/config/font-awesome.config';
import { SidebarComponent } from './core/layout/sidebar/sidebar.component';
import { NodeService } from './core/services/node.service';
import { ApiConnectionErrorComponent } from './shared/components/api-connection-error/api-connection-error.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, SidebarComponent, ApiConnectionErrorComponent],
  template: `
    <div class="app-layout">
      <app-sidebar />
      <main class="main-content">
        <router-outlet />
      </main>
    </div>
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

  private readonly nodeService = inject(NodeService);

  constructor() {
    const library = inject(FaIconLibrary);
    configureFontAwesome(library);
  }

  ngOnInit(): void {
    // Fetch current node information on app startup
    // This is used for route guards and UI restrictions based on node role
    this.nodeService.getCurrentNode().subscribe({
      error: (err) => {
        console.error('Failed to fetch current node information:', err);
        // If no nodes are registered, the app will still work
        // The user will need to register a node first
      },
    });
  }
}
