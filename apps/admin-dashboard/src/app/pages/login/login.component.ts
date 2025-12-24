import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Store } from '@ngrx/store';
import * as LoginActions from './+state/login.actions';
import { selectError, selectLoading } from './+state/login.selectors';
import { LoginBo } from './login.bo';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="login-container">
      <div class="login-card">
        <h1>BitBonsai Admin Dashboard</h1>
        <p>Enter your admin API key to continue</p>

        <form (ngSubmit)="login()">
          <input
            type="password"
            [(ngModel)]="apiKey"
            name="apiKey"
            placeholder="Admin API Key"
            class="api-key-input"
            required
            autocomplete="off"
          />
          <button type="submit" [disabled]="LoginBo.isFormDisabled(apiKey, loading$ | async)">
            {{ LoginBo.getButtonText(loading$ | async) }}
          </button>
        </form>

        @if (error$ | async; as error) {
          <p class="error">{{ error }}</p>
        }
      </div>
    </div>
  `,
  styles: [
    `
    .login-container {
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
      background: #1a1a1a;
    }
    .login-card {
      background: #2a2a2a;
      border: 1px solid #f9be03;
      border-radius: 8px;
      padding: 2rem;
      width: 400px;
      max-width: 90%;
    }
    h1 {
      color: #f9be03;
      margin-bottom: 0.5rem;
      font-size: 1.5rem;
    }
    p {
      color: #ccc;
      margin-bottom: 1.5rem;
      font-size: 0.9rem;
    }
    .api-key-input {
      width: 100%;
      padding: 0.75rem;
      border: 1px solid #444;
      border-radius: 4px;
      background: #1a1a1a;
      color: #fff;
      font-size: 1rem;
      margin-bottom: 1rem;
      box-sizing: border-box;
    }
    .api-key-input:focus {
      outline: none;
      border-color: #f9be03;
    }
    button {
      width: 100%;
      padding: 0.75rem;
      background: #f9be03;
      color: #1a1a1a;
      border: none;
      border-radius: 4px;
      font-weight: bold;
      cursor: pointer;
      font-size: 1rem;
    }
    button:hover:not(:disabled) {
      background: #e0ab02;
    }
    button:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    .error {
      color: #ff4444;
      margin-top: 1rem;
      margin-bottom: 0;
    }
  `,
  ],
})
export class LoginComponent {
  private readonly store = inject(Store);

  // Expose BO to template (convention requirement)
  readonly LoginBo = LoginBo;

  // Component state
  apiKey = '';

  // Selectors (NgRx state)
  loading$ = this.store.select(selectLoading);
  error$ = this.store.select(selectError);

  /**
   * Handle login form submission
   * Delegates to NgRx effect (NO logic in component!)
   */
  login(): void {
    if (LoginBo.isValidApiKeyFormat(this.apiKey)) {
      this.store.dispatch(LoginActions.login({ apiKey: this.apiKey }));
    }
  }
}
