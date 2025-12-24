import { Component } from '@angular/core';
import { RouterModule } from '@angular/router';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'bb-layout',
  standalone: true,
  imports: [RouterModule],
  template: `
    <div class="bb-layout">
      <aside class="bb-sidebar">
        <div class="bb-sidebar__logo">
          <h1>BitBonsai Admin</h1>
        </div>
        <nav class="bb-sidebar__nav">
          <a routerLink="/dashboard" routerLinkActive="active" class="bb-nav-item">
            <span class="material-icons">dashboard</span>
            Dashboard
          </a>
          <a routerLink="/licenses" routerLinkActive="active" class="bb-nav-item">
            <span class="material-icons">vpn_key</span>
            Licenses
          </a>
          <a routerLink="/pricing" routerLinkActive="active" class="bb-nav-item">
            <span class="material-icons">attach_money</span>
            Pricing Tiers
          </a>
          <a routerLink="/promo-codes" routerLinkActive="active" class="bb-nav-item">
            <span class="material-icons">local_offer</span>
            Promo Codes
          </a>
          <a routerLink="/donations" routerLinkActive="active" class="bb-nav-item">
            <span class="material-icons">volunteer_activism</span>
            Donations
          </a>
          <a routerLink="/analytics" routerLinkActive="active" class="bb-nav-item">
            <span class="material-icons">analytics</span>
            Analytics
          </a>
          <a routerLink="/webhooks" routerLinkActive="active" class="bb-nav-item">
            <span class="material-icons">webhook</span>
            Webhooks
          </a>
          <a routerLink="/config" routerLinkActive="active" class="bb-nav-item">
            <span class="material-icons">settings</span>
            Config
          </a>
          <a routerLink="/audit-log" routerLinkActive="active" class="bb-nav-item">
            <span class="material-icons">history</span>
            Audit Log
          </a>
          <button (click)="logout()" class="bb-nav-item bb-logout-btn">
            <span class="material-icons">logout</span>
            Logout
          </button>
        </nav>
      </aside>
      <main class="bb-main">
        <router-outlet />
      </main>
    </div>
  `,
  styleUrls: ['./layout.component.scss'],
})
export class LayoutComponent {
  constructor(private auth: AuthService) {}

  logout(): void {
    this.auth.logout();
  }
}
