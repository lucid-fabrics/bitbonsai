import { Component, ChangeDetectionStrategy } from '@angular/core';
import { RouterOutlet } from '@angular/router';
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
  styles: [`
    @import './styles/variables';

    .app-layout {
      min-height: 100vh;
      display: flex;
    }

    .main-content {
      flex: 1;
      margin-left: 220px;
      background: var(--bg-primary, #1a1a1a);
    }

    @media (max-width: 768px) {
      .main-content {
        margin-left: 60px;
      }
    }
  `],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class AppComponent {
  title = 'MediaInsight';
}
