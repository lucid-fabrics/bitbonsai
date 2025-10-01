import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { FaIconLibrary } from '@fortawesome/angular-fontawesome';
import { configureFontAwesome } from './core/config/font-awesome.config';
import { SidebarComponent } from './core/layout/sidebar/sidebar.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, SidebarComponent],
  template: `
    <div class="app-layout">
      <app-sidebar />
      <main class="main-content">
        <router-outlet />
      </main>
    </div>
  `,
  styles: [
    `
    .app-layout {
      min-height: 100vh;
      display: flex;
    }

    .main-content {
      flex: 1;
      margin-left: 220px;
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
export class AppComponent {
  title = 'BitBonsai';

  constructor() {
    const library = inject(FaIconLibrary);
    configureFontAwesome(library);
  }
}
