import { Component, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { EndUserAuthService } from '../../services/end-user-auth.service';

@Component({
  selector: 'app-device',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './device.component.html',
  styleUrls: ['./device.component.scss'],
})
export class DeviceComponent implements OnInit {
  private readonly authService = inject(EndUserAuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  userCode = signal('');
  error = signal<string | null>(null);
  loading = signal(false);
  authorized = signal(false);

  ngOnInit(): void {
    this.authService.handleOAuthFragment();

    if (!this.authService.isLoggedIn()) {
      const code = this.route.snapshot.queryParamMap.get('code');
      const extras = code
        ? { queryParams: { return: 'device', code } }
        : { queryParams: { return: 'device' } };
      this.router.navigate(['/login'], extras);
      return;
    }

    const code = this.route.snapshot.queryParamMap.get('code');
    if (code) {
      this.userCode.set(this.formatCode(code));
    }
  }

  onCodeInput(raw: string): void {
    const digits = raw
      .replace(/[^A-Za-z0-9]/g, '')
      .toUpperCase()
      .slice(0, 8);
    const formatted = digits.length > 4 ? `${digits.slice(0, 4)}-${digits.slice(4)}` : digits;
    this.userCode.set(formatted);
  }

  onSubmit(): void {
    this.error.set(null);
    this.loading.set(true);

    const code = this.userCode().replace(/-/g, '');

    this.authService.authorizeDevice(code).subscribe({
      next: () => {
        this.loading.set(false);
        this.authorized.set(true);
      },
      error: (err: { error?: { message?: string } }) => {
        this.loading.set(false);
        this.error.set(
          err.error?.message ?? 'Authorization failed. Please check the code and try again.'
        );
      },
    });
  }

  private formatCode(raw: string): string {
    const digits = raw
      .replace(/[^A-Za-z0-9]/g, '')
      .toUpperCase()
      .slice(0, 8);
    return digits.length > 4 ? `${digits.slice(0, 4)}-${digits.slice(4)}` : digits;
  }
}
