import { HttpClient } from '@angular/common/http';
import { Component, inject, OnInit, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { environment } from '../../../environments/environment';

@Component({
  selector: 'app-verify-email',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './verify-email.component.html',
})
export class VerifyEmailComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly http = inject(HttpClient);

  loading = signal(true);
  success = signal(false);
  error = signal<string | null>(null);

  ngOnInit(): void {
    const token = this.route.snapshot.queryParamMap.get('token') ?? '';
    if (!token) {
      this.loading.set(false);
      this.error.set('Invalid or missing verification token.');
      return;
    }

    this.http
      .post<{ message: string }>(`${environment.licenseApiUrl}/end-users/verify-email`, { token })
      .subscribe({
        next: () => {
          this.loading.set(false);
          this.success.set(true);
        },
        error: (err: { error?: { message?: string } }) => {
          this.loading.set(false);
          this.error.set(err.error?.message ?? 'Verification failed. The link may have expired.');
        },
      });
  }
}
