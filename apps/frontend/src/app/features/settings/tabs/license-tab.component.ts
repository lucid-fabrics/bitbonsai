import { DatePipe } from '@angular/common';
import { Component, DestroyRef, inject, type OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { interval, Subscription } from 'rxjs';
import { switchMap, takeWhile } from 'rxjs/operators';
import type { CloudAuthStatus, DeviceFlowResponse } from '../services/cloud-account.service';
import { CloudAccountService } from '../services/cloud-account.service';

@Component({
  selector: 'app-license-tab',
  standalone: true,
  imports: [DatePipe],
  template: `
    <div class="tab-panel account-tab">
      <h2>Account & Subscription</h2>

      @if (loading()) {
        <div class="skeleton-container">
          <div class="skeleton-card">
            <div class="skeleton-header">
              <div class="skeleton-icon"></div>
              <div class="skeleton-text-group">
                <div class="skeleton-badge"></div>
                <div class="skeleton-price"></div>
              </div>
            </div>
            <div class="skeleton-stats">
              <div class="skeleton-stat"></div>
              <div class="skeleton-stat"></div>
            </div>
          </div>
        </div>
      } @else if (status()?.linked) {
        <!-- Linked Account Card -->
        <div class="account-card linked">
          <div class="account-header">
            <div class="account-info">
              <i class="fa fa-cloud"></i>
              <div>
                <span class="account-email">{{ status()?.email }}</span>
                <span class="tier-badge tier-{{ status()?.tier?.toLowerCase() }}">
                  {{ status()?.tier || 'Free' }}
                </span>
              </div>
            </div>
            <div class="account-actions">
              <button
                type="button"
                class="btn-revalidate"
                (click)="revalidate()"
                [disabled]="actionLoading()"
              >
                {{ actionLoading() ? 'Validating...' : 'Re-validate' }}
              </button>
              <button
                type="button"
                class="btn-signout"
                (click)="signOut()"
                [disabled]="actionLoading()"
              >
                Sign out
              </button>
            </div>
          </div>

          @if (status()?.gracePeriodExpired) {
            <div class="grace-period-warning">
              <i class="fa fa-exclamation-triangle"></i>
              <span>
                Your grace period has expired. Some features may be restricted.
                Re-validate to restore access.
              </span>
            </div>
          } @else if (status()?.gracePeriodExpiresAt) {
            <div class="grace-period-notice">
              <i class="fa fa-clock-o"></i>
              <span>
                Grace period expires:
                {{ status()?.gracePeriodExpiresAt | date: 'mediumDate' }}
              </span>
            </div>
          }

          <div class="usage-stats">
            <div class="stat-item">
              <span class="stat-label">Max Nodes</span>
              <span class="stat-value">{{ status()?.maxNodes ?? '—' }}</span>
            </div>
            <div class="stat-item">
              <span class="stat-label">Max Concurrent Jobs</span>
              <span class="stat-value">{{ status()?.maxConcurrentJobs ?? '—' }}</span>
            </div>
            <div class="stat-item">
              <span class="stat-label">Last Validated</span>
              <span class="stat-value">
                {{ status()?.validatedAt ? (status()?.validatedAt | date: 'medium') : 'Never' }}
              </span>
            </div>
          </div>
        </div>

        @if (actionError()) {
          <p class="error-message">{{ actionError() }}</p>
        }
        @if (actionSuccess()) {
          <p class="success-message">{{ actionSuccess() }}</p>
        }
      } @else {
        <!-- Not Linked - Device Flow Section -->
        <div class="link-section">
          <div class="link-header">
            <i class="fa fa-chain-broken"></i>
            <div>
              <h3>Link Your Account</h3>
              <p>Connect your bitbonsai.app account to unlock your subscription tier.</p>
            </div>
          </div>

          @if (!deviceFlow()) {
            <button
              type="button"
              class="btn-primary"
              (click)="startLinking()"
              [disabled]="linkLoading()"
            >
              {{ linkLoading() ? 'Starting...' : 'Link Account' }}
            </button>
          } @else {
            <div class="device-flow-card">
              <p class="flow-instruction">
                Visit <strong>bitbonsai.app/device</strong> and enter this code:
              </p>
              <div class="user-code-display">{{ deviceFlow()!.userCode }}</div>
              <a
                [href]="deviceFlow()!.verificationUri"
                target="_blank"
                rel="noopener noreferrer"
                class="btn-primary btn-open"
              >
                <i class="fa fa-external-link"></i>
                Open bitbonsai.app/device
              </a>
              @if (isPolling()) {
                <div class="polling-status">
                  <span class="spinner-sm"></span>
                  <span>Waiting for authorization...</span>
                </div>
              }
            </div>
          }

          @if (linkError()) {
            <p class="error-message">{{ linkError() }}</p>
          }
        </div>
      }
    </div>
  `,
  styles: [
    `
      .account-tab {
        max-width: 700px;
      }

      .skeleton-container {
        animation: pulse 1.5s ease-in-out infinite;
      }

      .skeleton-card {
        background: var(--surface-card);
        border-radius: 12px;
        padding: 24px;
        border: 1px solid var(--surface-border);
      }

      .skeleton-header {
        display: flex;
        align-items: center;
        gap: 12px;
        margin-bottom: 20px;
      }

      .skeleton-icon {
        width: 40px;
        height: 40px;
        border-radius: 8px;
        background: var(--surface-hover);
      }

      .skeleton-text-group {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }

      .skeleton-badge {
        width: 80px;
        height: 24px;
        border-radius: 12px;
        background: var(--surface-hover);
      }

      .skeleton-price {
        width: 50px;
        height: 14px;
        border-radius: 4px;
        background: var(--surface-hover);
      }

      .skeleton-stats {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 20px;
      }

      .skeleton-stat {
        height: 60px;
        border-radius: 8px;
        background: var(--surface-hover);
      }

      @keyframes pulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.5; }
      }

      .account-card {
        background: var(--surface-card);
        border-radius: 12px;
        padding: 24px;
        margin-bottom: 24px;
        border: 1px solid var(--surface-border);
      }

      .account-card.linked {
        border-left: 4px solid var(--primary-color);
      }

      .account-header {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        margin-bottom: 20px;
        gap: 16px;
      }

      .account-info {
        display: flex;
        align-items: center;
        gap: 12px;
      }

      .account-info i {
        font-size: 28px;
        color: var(--primary-color);
      }

      .account-email {
        display: block;
        font-weight: 600;
        font-size: 15px;
        margin-bottom: 4px;
      }

      .tier-badge {
        display: inline-block;
        padding: 2px 10px;
        border-radius: 12px;
        font-size: 12px;
        font-weight: 600;
        background: var(--primary-color);
        color: white;
      }

      .account-actions {
        display: flex;
        gap: 8px;
        flex-shrink: 0;
      }

      .btn-revalidate {
        background: var(--surface-ground);
        border: 1px solid var(--surface-border);
        color: var(--text-color);
        padding: 7px 14px;
        border-radius: 6px;
        font-size: 13px;
        cursor: pointer;
        transition: all 0.2s;
      }

      .btn-revalidate:hover:not(:disabled) {
        border-color: var(--primary-color);
        color: var(--primary-color);
      }

      .btn-revalidate:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      .btn-signout {
        background: transparent;
        border: 1px solid var(--danger-color);
        color: var(--danger-color);
        padding: 7px 14px;
        border-radius: 6px;
        font-size: 13px;
        cursor: pointer;
        transition: all 0.2s;
      }

      .btn-signout:hover:not(:disabled) {
        background: rgba(239, 68, 68, 0.1);
      }

      .btn-signout:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      .grace-period-warning {
        display: flex;
        align-items: flex-start;
        gap: 10px;
        padding: 12px 16px;
        background: rgba(239, 68, 68, 0.1);
        border: 1px solid var(--danger-color);
        border-radius: 8px;
        color: var(--danger-color);
        font-size: 13px;
        margin-bottom: 16px;
      }

      .grace-period-notice {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 10px 14px;
        background: rgba(245, 158, 11, 0.1);
        border: 1px solid #f59e0b;
        border-radius: 8px;
        color: #f59e0b;
        font-size: 13px;
        margin-bottom: 16px;
      }

      .usage-stats {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 16px;
      }

      .stat-item {
        background: var(--surface-ground);
        border-radius: 8px;
        padding: 12px;
      }

      .stat-label {
        display: block;
        color: var(--text-muted);
        font-size: 12px;
        margin-bottom: 4px;
      }

      .stat-value {
        display: block;
        font-weight: 600;
        font-size: 15px;
      }

      .link-section {
        background: var(--surface-card);
        border-radius: 12px;
        padding: 24px;
        border: 1px solid var(--surface-border);
      }

      .link-header {
        display: flex;
        align-items: flex-start;
        gap: 16px;
        margin-bottom: 20px;
      }

      .link-header i {
        font-size: 24px;
        color: var(--text-muted);
        margin-top: 2px;
      }

      .link-header h3 {
        margin: 0 0 4px 0;
        font-size: 16px;
      }

      .link-header p {
        margin: 0;
        font-size: 13px;
        color: var(--text-muted);
      }

      .btn-primary {
        background: var(--primary-color);
        color: white;
        border: none;
        padding: 10px 20px;
        border-radius: 8px;
        font-weight: 600;
        cursor: pointer;
        transition: background 0.2s;
        display: inline-flex;
        align-items: center;
        gap: 8px;
        text-decoration: none;
        font-size: 14px;
      }

      .btn-primary:hover:not(:disabled) {
        background: var(--primary-color-dark, #5a5fcf);
      }

      .btn-primary:disabled {
        opacity: 0.6;
        cursor: not-allowed;
      }

      .btn-open {
        width: 100%;
        justify-content: center;
      }

      .device-flow-card {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 16px;
        padding: 24px;
        background: var(--surface-ground);
        border-radius: 10px;
        border: 1px solid rgba(var(--primary-color-rgb, 99 102 241), 0.2);
      }

      .flow-instruction {
        margin: 0;
        font-size: 14px;
        color: var(--text-muted);
        text-align: center;
      }

      .user-code-display {
        font-family: monospace;
        font-size: 2rem;
        font-weight: 700;
        color: var(--primary-color);
        letter-spacing: 0.25em;
        padding: 12px 24px;
        background: rgba(var(--primary-color-rgb, 99 102 241), 0.08);
        border: 1px solid rgba(var(--primary-color-rgb, 99 102 241), 0.25);
        border-radius: 8px;
        user-select: all;
      }

      .polling-status {
        display: flex;
        align-items: center;
        gap: 8px;
        color: var(--text-muted);
        font-size: 13px;
      }

      .spinner-sm {
        display: inline-block;
        width: 14px;
        height: 14px;
        border: 2px solid var(--surface-border);
        border-top-color: var(--primary-color);
        border-radius: 50%;
        animation: spin 0.8s linear infinite;
      }

      @keyframes spin {
        to { transform: rotate(360deg); }
      }

      .error-message {
        color: var(--danger-color);
        margin-top: 12px;
        font-size: 13px;
      }

      .success-message {
        color: var(--success-color);
        margin-top: 12px;
        font-size: 13px;
      }

      @media (max-width: 600px) {
        .account-header {
          flex-direction: column;
        }

        .usage-stats {
          grid-template-columns: 1fr;
        }
      }
    `,
  ],
})
export class LicenseTabComponent implements OnInit {
  private readonly cloudAccountService = inject(CloudAccountService);
  private readonly destroyRef = inject(DestroyRef);

  readonly status = signal<CloudAuthStatus | null>(null);
  readonly loading = signal(false);
  readonly actionLoading = signal(false);
  readonly actionError = signal<string | null>(null);
  readonly actionSuccess = signal<string | null>(null);

  readonly deviceFlow = signal<DeviceFlowResponse | null>(null);
  readonly linkLoading = signal(false);
  readonly linkError = signal<string | null>(null);
  readonly isPolling = signal(false);

  private pollSubscription: Subscription | null = null;

  ngOnInit(): void {
    this.loadStatus();
  }

  private loadStatus(): void {
    this.loading.set(true);
    this.cloudAccountService
      .getStatus()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (s) => {
          this.status.set(s);
          this.loading.set(false);
        },
        error: () => {
          this.loading.set(false);
        },
      });
  }

  startLinking(): void {
    this.linkLoading.set(true);
    this.linkError.set(null);
    this.cloudAccountService
      .startDeviceFlow()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (flow) => {
          this.deviceFlow.set(flow);
          this.linkLoading.set(false);
          this.startPolling();
        },
        error: () => {
          this.linkError.set('Failed to start device flow. Please try again.');
          this.linkLoading.set(false);
        },
      });
  }

  private startPolling(): void {
    this.isPolling.set(true);
    const deadline = Date.now() + 10 * 60 * 1000;

    this.pollSubscription = interval(3000)
      .pipe(
        takeWhile(() => Date.now() < deadline && this.isPolling()),
        switchMap(() => this.cloudAccountService.getStatus()),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe({
        next: (s) => {
          if (s.linked) {
            this.stopPolling();
            this.deviceFlow.set(null);
            this.status.set(s);
          }
        },
        error: () => {
          this.stopPolling();
          this.linkError.set('Polling failed. Please try again.');
        },
      });
  }

  private stopPolling(): void {
    this.isPolling.set(false);
    this.pollSubscription?.unsubscribe();
    this.pollSubscription = null;
  }

  revalidate(): void {
    this.actionLoading.set(true);
    this.actionError.set(null);
    this.actionSuccess.set(null);
    this.cloudAccountService
      .validateNow()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.actionSuccess.set('Validation successful.');
          this.actionLoading.set(false);
          this.loadStatus();
        },
        error: () => {
          this.actionError.set('Validation failed. Please try again.');
          this.actionLoading.set(false);
        },
      });
  }

  signOut(): void {
    this.actionLoading.set(true);
    this.actionError.set(null);
    this.actionSuccess.set(null);
    this.cloudAccountService
      .logout()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.actionLoading.set(false);
          this.loadStatus();
        },
        error: () => {
          this.actionError.set('Sign out failed. Please try again.');
          this.actionLoading.set(false);
        },
      });
  }
}
