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
        this.error.set(err.error?.message ?? 'Login failed. Please try again.');
      },
    });
  }

  googleLogin(): void {
    this.authService.googleLogin();
  }

  githubLogin(): void {
    this.authService.githubLogin();
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
