import { Component, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { EndUserAuthService } from '../../services/end-user-auth.service';

@Component({
  selector: 'app-signup',
  standalone: true,
  imports: [FormsModule, RouterLink],
  templateUrl: './signup.component.html',
  styleUrls: ['./signup.component.scss'],
})
export class SignupComponent implements OnInit {
  private readonly authService = inject(EndUserAuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  email = signal('');
  password = signal('');
  name = signal('');
  error = signal<string | null>(null);
  loading = signal(false);

  ngOnInit(): void {
    this.authService.handleOAuthFragment();
    if (this.authService.isLoggedIn()) {
      this.navigateAfterAuth();
    }
  }

  async onSubmit(): Promise<void> {
    this.error.set(null);
    this.loading.set(true);

    const nameVal = this.name().trim() || undefined;

    this.authService.register(this.email(), this.password(), nameVal).subscribe({
      next: () => {
        this.loading.set(false);
        this.navigateAfterAuth();
      },
      error: (err: { error?: { message?: string } }) => {
        this.loading.set(false);
        this.error.set(err.error?.message ?? 'Registration failed. Please try again.');
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
    if (returnParam === 'device') {
      this.router.navigate(['/device']);
    } else {
      this.router.navigate(['/account']);
    }
  }
}
