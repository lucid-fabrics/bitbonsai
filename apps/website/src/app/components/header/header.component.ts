import { Component } from '@angular/core';
import { RouterModule } from '@angular/router';

@Component({
  selector: 'bb-header',
  standalone: true,
  imports: [RouterModule],
  template: `
    <header class="header">
      <div class="header__container">
        <a routerLink="/" class="header__logo">
          <span class="header__logo-icon">🌱</span>
          <span class="header__logo-text">BitBonsai</span>
        </a>

        <nav class="header__nav">
          <a routerLink="/" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: true }">
            Home
          </a>
          <a routerLink="/pricing" routerLinkActive="active">Pricing</a>
          <a routerLink="/download" routerLinkActive="active">Download</a>
          <a routerLink="/docs" routerLinkActive="active">Docs</a>
        </nav>

        <a routerLink="/download" class="header__cta">Get Started</a>
      </div>
    </header>
  `,
  styleUrls: ['./header.component.scss'],
})
export class HeaderComponent {}
