import { HttpClient } from '@angular/common/http';
import { Component, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { environment } from '../../../environments/environment';

@Component({
  selector: 'app-reset-password',
  standalone: true,
  imports: [FormsModule, RouterLink],
  templateUrl: './reset-password.component.html',
})
export class ResetPasswordComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly http = inject(HttpClient);

  token = signal('');
  password = signal('');
  confirm = signal('');
  loading = signal(false);
  success = signal(false);
  error = signal<string | null>(null);

  ngOnInit(): void {
    const t = this.route.snapshot.queryParamMap.get('token') ?? '';
    this.token.set(t);
    if (!t) this.error.set('Invalid or missing reset token.');
  }

  onSubmit(): void {
    if (this.password() !== this.confirm()) {
      this.error.set('Passwords do not match.');
      return;
    }
    if (this.password().length < 8) {
      this.error.set('Password must be at least 8 characters.');
      return;
    }

    this.loading.set(true);
    this.error.set(null);

    this.http
      .post<{ message: string }>(`${environment.licenseApiUrl}/end-users/reset-password`, {
        token: this.token(),
        password: this.password(),
      })
      .subscribe({
        next: () => {
          this.loading.set(false);
          this.success.set(true);
          setTimeout(() => this.router.navigate(['/login']), 2000);
        },
        error: (err: { error?: { message?: string } }) => {
          this.loading.set(false);
          this.error.set(err.error?.message ?? 'Reset failed. The link may have expired.');
        },
      });
  }
}
