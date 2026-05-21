import { Component, HostListener, inject } from '@angular/core';
import { RouterModule } from '@angular/router';
import { FontAwesomeModule } from '@fortawesome/angular-fontawesome';
import { faSeedling } from '@fortawesome/free-solid-svg-icons';
import { EndUserAuthService } from '../../services/end-user-auth.service';

@Component({
  selector: 'bb-header',
  standalone: true,
  imports: [RouterModule, FontAwesomeModule],
  template: `
    <header class="header" [class.scrolled]="isScrolled">
      <div class="header__container">
        <a routerLink="/" class="header__logo">
          <fa-icon [icon]="faSeedling" class="header__logo-icon"></fa-icon>
          <span class="header__logo-text">BitBonsai</span>
        </a>

        <nav class="header__nav">
          <a
            routerLink="/"
            routerLinkActive="active"
            [routerLinkActiveOptions]="{ exact: true }"
          >
            Home
          </a>
          <a routerLink="/pricing" routerLinkActive="active">Pricing</a>
          <a routerLink="/download" routerLinkActive="active">Download</a>
          <a routerLink="/docs" routerLinkActive="active">Docs</a>
        </nav>

        <div class="header__actions">
          @if (auth.isLoggedIn()) {
            <a routerLink="/account" class="header__account">My Account</a>
          } @else {
            <a routerLink="/login" class="header__signin">Sign in</a>
          }
          <a routerLink="/download" class="header__cta">Get Started</a>
        </div>
      </div>
    </header>
  `,
  styleUrls: ['./header.component.scss'],
})
export class HeaderComponent {
  faSeedling = faSeedling;
  isScrolled = false;
  readonly auth = inject(EndUserAuthService);

  @HostListener('window:scroll')
  onWindowScroll() {
    this.isScrolled = window.scrollY > 50;
  }
}
