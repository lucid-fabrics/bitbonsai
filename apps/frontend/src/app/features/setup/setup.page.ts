import { animate, style, transition, trigger } from '@angular/animations';
import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  AbstractControl,
  FormBuilder,
  ReactiveFormsModule,
  ValidationErrors,
  Validators,
} from '@angular/forms';
import { Router } from '@angular/router';
import { FontAwesomeModule } from '@fortawesome/angular-fontawesome';
import { SetupService } from '../../core/services/setup.service';

/**
 * Custom validator to ensure password confirmation matches
 */
function passwordMatchValidator(control: AbstractControl): ValidationErrors | null {
  const password = control.get('password');
  const confirmPassword = control.get('confirmPassword');

  if (!password || !confirmPassword) {
    return null;
  }

  return password.value === confirmPassword.value ? null : { passwordMismatch: true };
}

/**
 * Setup Wizard Steps
 */
enum SetupStep {
  Welcome = 0,
  LocalNetworkAccess = 1,
  AdminAccount = 2,
}

/**
 * Setup Page Component
 *
 * Multi-step wizard for first-time BitBonsai setup.
 *
 * Features:
 * - Three-step wizard flow
 * - Progress indicator
 * - Local network access configuration
 * - Admin account creation with validation
 * - Smooth step transitions
 * - Loading and error states
 */
@Component({
  selector: 'app-setup',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, FontAwesomeModule],
  templateUrl: './setup.page.html',
  styleUrls: ['./setup.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  animations: [
    trigger('stepTransition', [
      transition(':enter', [
        style({ opacity: 0, transform: 'translateX(20px)' }),
        animate('300ms ease-out', style({ opacity: 1, transform: 'translateX(0)' })),
      ]),
    ]),
  ],
})
export class SetupComponent {
  private readonly fb = inject(FormBuilder);
  private readonly setupService = inject(SetupService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  // Expose enum to template
  readonly SetupStep = SetupStep;

  // Signals for reactive state management
  readonly currentStep = signal<SetupStep>(SetupStep.Welcome);
  readonly isLoading = signal(false);
  readonly showPassword = signal(false);
  readonly showConfirmPassword = signal(false);
  readonly errorMessage = signal<string | null>(null);
  readonly successMessage = signal<string | null>(null);

  // Local network access form
  readonly networkForm = this.fb.nonNullable.group({
    allowLocalNetworkWithoutAuth: [false],
  });

  // Admin account form
  readonly adminForm = this.fb.nonNullable.group(
    {
      username: ['', [Validators.required, Validators.minLength(3)]],
      password: ['', [Validators.required, Validators.minLength(8)]],
      confirmPassword: ['', [Validators.required]],
    },
    { validators: passwordMatchValidator }
  );

  /**
   * Get total number of steps
   */
  get totalSteps(): number {
    return 3;
  }

  /**
   * Get current step number (1-indexed for display)
   */
  get currentStepNumber(): number {
    return this.currentStep() + 1;
  }

  /**
   * Get progress percentage
   */
  get progressPercentage(): number {
    return (this.currentStepNumber / this.totalSteps) * 100;
  }

  /**
   * Navigate to next step
   */
  nextStep(): void {
    this.errorMessage.set(null);

    // Validate current step before proceeding
    if (this.currentStep() === SetupStep.AdminAccount) {
      if (this.adminForm.invalid) {
        this.adminForm.markAllAsTouched();
        return;
      }
      // This is the last step, submit the form
      this.submitSetup();
      return;
    }

    // Move to next step
    this.currentStep.update((step) => Math.min(step + 1, SetupStep.AdminAccount));
  }

  /**
   * Navigate to previous step
   */
  previousStep(): void {
    this.errorMessage.set(null);
    this.currentStep.update((step) => Math.max(step - 1, SetupStep.Welcome));
  }

  /**
   * Toggle password visibility
   */
  togglePasswordVisibility(): void {
    this.showPassword.update((value) => !value);
  }

  /**
   * Toggle confirm password visibility
   */
  toggleConfirmPasswordVisibility(): void {
    this.showConfirmPassword.update((value) => !value);
  }

  /**
   * Submit the setup form
   */
  submitSetup(): void {
    if (this.adminForm.invalid) {
      this.adminForm.markAllAsTouched();
      return;
    }

    this.isLoading.set(true);
    this.errorMessage.set(null);
    this.successMessage.set(null);

    const { username, password } = this.adminForm.getRawValue();
    const { allowLocalNetworkWithoutAuth } = this.networkForm.getRawValue();

    this.setupService
      .initializeSetup({
        username,
        password,
        allowLocalNetworkWithoutAuth,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          this.isLoading.set(false);

          // If local network bypass is enabled, redirect to main app
          // Otherwise redirect to login
          const redirectUrl = allowLocalNetworkWithoutAuth ? '/' : '/login';
          const message = allowLocalNetworkWithoutAuth
            ? 'Setup completed successfully! Redirecting to app...'
            : 'Setup completed successfully! Redirecting to login...';

          this.successMessage.set(message);

          // Navigate after 1 second
          setTimeout(() => {
            this.router.navigate([redirectUrl]);
          }, 1000);
        },
        error: (error) => {
          this.isLoading.set(false);

          // Provide user-friendly error messages
          if (error.status === 400) {
            this.errorMessage.set(
              error.error?.message || 'Invalid setup data. Please check your inputs.'
            );
          } else if (error.status === 409) {
            this.errorMessage.set('Setup has already been completed.');
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
    const field = this.adminForm.get(fieldName);
    return !!(field && field.invalid && field.touched);
  }

  /**
   * Get error message for a specific field
   */
  getErrorMessage(fieldName: string): string {
    const field = this.adminForm.get(fieldName);

    if (!field || !field.errors) {
      return '';
    }

    if (field.errors['required']) {
      const displayName =
        fieldName === 'confirmPassword'
          ? 'Password confirmation'
          : fieldName.charAt(0).toUpperCase() + fieldName.slice(1);
      return `${displayName} is required`;
    }

    if (field.errors['minlength']) {
      const minLength = field.errors['minlength'].requiredLength;
      return `Must be at least ${minLength} characters`;
    }

    if (fieldName === 'confirmPassword' && this.adminForm.errors?.['passwordMismatch']) {
      return 'Passwords do not match';
    }

    return 'Invalid input';
  }

  /**
   * Check if passwords match
   */
  get passwordsMatch(): boolean {
    const password = this.adminForm.get('password')?.value;
    const confirmPassword = this.adminForm.get('confirmPassword')?.value;
    return password === confirmPassword;
  }
}
