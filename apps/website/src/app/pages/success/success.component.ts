import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { RouterModule } from '@angular/router';
import { FontAwesomeModule } from '@fortawesome/angular-fontawesome';
import { faCheckCircle, faDownload, faEnvelope } from '@fortawesome/free-solid-svg-icons';

@Component({
  selector: 'bb-success',
  standalone: true,
  imports: [CommonModule, RouterModule, FontAwesomeModule],
  template: `
    <div class="success">
      <div class="success__container">
        <div class="success__icon">
          <fa-icon [icon]="faCheckCircle"></fa-icon>
        </div>

        <h1 class="success__title">Payment Successful!</h1>
        <p class="success__message">
          Thank you for subscribing to BitBonsai. Your license key has been sent to your email.
        </p>

        <div class="success__steps">
          <div class="success__step">
            <div class="success__step-icon">
              <fa-icon [icon]="faEnvelope"></fa-icon>
            </div>
            <h3>Check Your Email</h3>
            <p>Your license key should arrive within a few minutes</p>
          </div>

          <div class="success__step">
            <div class="success__step-icon">
              <fa-icon [icon]="faDownload"></fa-icon>
            </div>
            <h3>Download BitBonsai</h3>
            <p>Get the desktop app and activate your license</p>
          </div>
        </div>

        <div class="success__actions">
          <a routerLink="/download" class="success__button success__button--primary">
            Download App
          </a>
          <a routerLink="/docs" class="success__button success__button--secondary">
            View Documentation
          </a>
        </div>

        <div class="success__help">
          <p>Need help? Check our <a routerLink="/docs">documentation</a> or contact support.</p>
        </div>
      </div>
    </div>
  `,
  styleUrls: ['./success.component.scss'],
})
export class SuccessComponent {
  faCheckCircle = faCheckCircle;
  faEnvelope = faEnvelope;
  faDownload = faDownload;
}
