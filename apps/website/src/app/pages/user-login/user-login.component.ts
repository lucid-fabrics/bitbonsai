import { Component, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { EndUserAuthService } from '../../services/end-user-auth.service';

@Component({
  selector: 'app-user-login',
  standalone: true,
  imports: [FormsModule, RouterLink],
  templateUrl: './user-login.component.html',
  styleUrls: ['./user-login.component.scss'],
})
export class UserLoginComponent implements OnInit {
  private readonly authService = inject(EndUserAuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  email = signal('');
  password = signal('');
  error = signal<string | null>(null);
  loading = signal(false);
  showResendVerification = signal(false);
  resendLoading = signal(false);
  resendSuccess = signal(false);

  ngOnInit(): void {
    this.authService.handleOAuthFragment();
    if (this.authService.isLoggedIn()) {
      this.navigateAfterAuth();
    }
  }

  onSubmit(): void {
    this.error.set(null);
    this.loading.set(true);

    this.authService.login(this.email(), this.password()).subscribe({
      next: () => {
        this.loading.set(false);
        this.navigateAfterAuth();
      },
      error: (err: { error?: { message?: string } }) => {
        this.loading.set(false);
        const msg = err.error?.message ?? 'Login failed. Please try again.';
        this.error.set(msg);
        this.showResendVerification.set(msg.toLowerCase().includes('verify'));
      },
    });
  }

  resendVerification(): void {
    this.resendLoading.set(true);
    this.authService.resendVerificationByEmail(this.email()).subscribe({
      next: () => {
        this.resendLoading.set(false);
        this.resendSuccess.set(true);
        this.showResendVerification.set(false);
      },
      error: () => this.resendLoading.set(false),
    });
  }

  googleLogin(): void {
    this.saveDeviceCodeForOAuth();
    const next =
      this.route.snapshot.queryParamMap.get('return') === 'device' ? 'device' : 'account';
    this.authService.googleLogin(next);
  }

  githubLogin(): void {
    this.saveDeviceCodeForOAuth();
    const next =
      this.route.snapshot.queryParamMap.get('return') === 'device' ? 'device' : 'account';
    this.authService.githubLogin(next);
  }

  private saveDeviceCodeForOAuth(): void {
    const code = this.route.snapshot.queryParamMap.get('code');
    if (code) {
      sessionStorage.setItem('oauth_device_code', code);
    }
  }

  private navigateAfterAuth(): void {
    const returnParam = this.route.snapshot.queryParamMap.get('return');
    const code = this.route.snapshot.queryParamMap.get('code');
    if (returnParam === 'device') {
      const extras = code ? { queryParams: { code } } : {};
      this.router.navigate(['/device'], extras);
    } else {
      this.router.navigate(['/account']);
    }
  }
}
