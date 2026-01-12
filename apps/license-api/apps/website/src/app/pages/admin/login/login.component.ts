import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../../services/auth.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './login.component.html',
  styleUrls: ['./login.component.scss'],
})
export class LoginComponent {
  private readonly authService = inject(AuthService);
  private readonly router = inject(Router);

  email = signal('');
  password = signal('');
  error = signal<string | null>(null);
  loading = signal(false);

  async onSubmit(): Promise<void> {
    this.error.set(null);
    this.loading.set(true);

    this.authService
      .login({
        email: this.email(),
        password: this.password(),
      })
      .subscribe({
        next: () => {
          this.router.navigate(['/admin/dashboard']);
        },
        error: (err) => {
          this.error.set(err.error?.message || 'Login failed. Please check your credentials.');
          this.loading.set(false);
        },
      });
  }
}
