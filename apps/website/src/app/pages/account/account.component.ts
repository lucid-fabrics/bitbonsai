import { CommonModule } from '@angular/common';
import { Component, inject, OnInit, signal } from '@angular/core';
import { RouterModule } from '@angular/router';
import { EndUser, EndUserAuthService, LinkedDevice } from '../../services/end-user-auth.service';

@Component({
  selector: 'app-account',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './account.component.html',
})
export class AccountComponent implements OnInit {
  private readonly auth = inject(EndUserAuthService);

  user = signal<EndUser | null>(null);
  devices = signal<LinkedDevice[]>([]);
  loading = signal(true);
  error = signal<string | null>(null);
  revokingId = signal<string | null>(null);
  portalLoading = signal(false);

  ngOnInit(): void {
    this.auth.handleOAuthFragment();
    this.auth.getMe().subscribe({
      next: (u) => {
        this.user.set(u);
        this.loadDevices();
      },
      error: () => {
        this.error.set('Failed to load account. Please sign in again.');
        this.loading.set(false);
      },
    });
  }

  private loadDevices(): void {
    this.auth.listDevices().subscribe({
      next: (devices) => {
        this.devices.set(devices);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  revokeDevice(deviceId: string): void {
    this.revokingId.set(deviceId);
    this.auth.revokeDevice(deviceId).subscribe({
      next: () => {
        this.devices.update((list) =>
          list.map((d) => (d.id === deviceId ? { ...d, revokedAt: new Date().toISOString() } : d))
        );
        this.revokingId.set(null);
      },
      error: () => this.revokingId.set(null),
    });
  }

  openStripePortal(): void {
    this.portalLoading.set(true);
    this.auth.getStripePortalUrl().subscribe({
      next: ({ url }) => {
        this.portalLoading.set(false);
        window.location.href = url;
      },
      error: () => this.portalLoading.set(false),
    });
  }

  signOut(): void {
    this.auth.logout();
    window.location.href = '/login';
  }
}
