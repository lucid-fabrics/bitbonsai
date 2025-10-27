import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { FontAwesomeModule } from '@fortawesome/angular-fontawesome';
import { AuthService } from '../../../core/auth/auth.service';

/**
 * Login Page Component
 *
 * Provides user authentication interface with reactive form handling.
 *
 * Features:
 * - Reactive form with validation
 * - Password visibility toggle
 * - Loading state management
 * - Error handling with user-friendly messages
 * - Automatic navigation on successful login
 */
@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, FontAwesomeModule],
  templateUrl: './login.page.html',
  styleUrls: ['./login.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LoginComponent implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly authService = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);
  private readonly http = inject(HttpClient);

  // Signals for reactive state management
  readonly isLoading = signal(false);
  readonly showPassword = signal(false);
  readonly errorMessage = signal<string | null>(null);
  readonly successMessage = signal<string | null>(null);

  // Reactive form
  readonly loginForm = this.fb.nonNullable.group({
    username: ['', [Validators.required]],
    password: ['', [Validators.required]],
  });

  /**
   * Check if local network bypass is enabled and redirect to main app
   */
  ngOnInit(): void {
    this.http
      .get<{ allowLocalNetworkWithoutAuth: boolean }>('/api/v1/settings/security')
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (settings) => {
          if (settings.allowLocalNetworkWithoutAuth) {
            // Local network bypass is enabled, redirect to main app
            const returnUrl = this.route.snapshot.queryParamMap.get('returnUrl') || '/';
            this.router.navigate([returnUrl]);
          }
        },
        error: () => {
          // If security check fails, show login form (fail safe)
        },
      });
  }

  /**
   * Toggle password visibility
   */
  togglePasswordVisibility(): void {
    this.showPassword.update((value) => !value);
  }

  /**
   * Handle form submission
   */
  onSubmit(): void {
    if (this.loginForm.invalid) {
      this.loginForm.markAllAsTouched();
      return;
    }

    this.isLoading.set(true);
    this.errorMessage.set(null);
    this.successMessage.set(null);

    const { username, password } = this.loginForm.getRawValue();

    this.authService
      .login(username, password)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          this.successMessage.set('Login successful! Redirecting...');
          this.isLoading.set(false);

          // Get returnUrl from query params or default to overview
          const returnUrl = this.route.snapshot.queryParamMap.get('returnUrl') || '/overview';

          // Navigate after short delay
          setTimeout(() => {
            this.router.navigateByUrl(returnUrl);
          }, 500);
        },
        error: (error) => {
          this.isLoading.set(false);

          // Provide user-friendly error messages
          if (error.status === 401) {
            this.errorMessage.set('Invalid username or password. Please try again.');
          } else if (error.status === 0) {
            this.errorMessage.set('Unable to connect to server. Please check your connection.');
          } else if (error.status >= 500) {
            this.errorMessage.set('Server error. Please try again later.');
          } else {
            this.errorMessage.set('An unexpected error occurred. Please try again.');
          }
        },
      });
  }

  /**
   * Check if a form field has an error and has been touched
   */
  hasError(fieldName: string): boolean {
    const field = this.loginForm.get(fieldName);
    return !!(field && field.invalid && field.touched);
  }

  /**
   * Get error message for a specific field
   */
  getErrorMessage(fieldName: string): string {
    const field = this.loginForm.get(fieldName);

    if (!field || !field.errors) {
      return '';
    }

    if (field.errors['required']) {
      return `${fieldName.charAt(0).toUpperCase() + fieldName.slice(1)} is required`;
    }

    return 'Invalid input';
  }
}
