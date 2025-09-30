import { Component, ChangeDetectionStrategy } from '@angular/core';
import { RouterOutlet } from '@angular/router';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet],
  template: `
    <div class="app">
      <router-outlet />
    </div>
  `,
  styles: [`
    .app {
      min-height: 100vh;
      display: flex;
      flex-direction: column;
    }
  `],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class AppComponent {
  title = 'MediaInsight';
}
