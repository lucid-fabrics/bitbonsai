import { CommonModule } from '@angular/common';
import { Component, DestroyRef, inject, type OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import {
  JellyfinSettings,
  JellyfinTestResult,
  SettingsClient,
} from '../../../core/clients/settings.client';

@Component({
  selector: 'app-integrations-tab',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="tab-panel">
      <h2>Integrations</h2>
      <p class="tab-description">Connect BitBonsai with external services for enhanced automation</p>

      <!-- Jellyfin Integration Card -->
      <div class="info-card">
        <div class="integration-header">
          <div class="integration-icon jellyfin-icon">
            <i class="fa fa-play-circle"></i>
          </div>
          <div class="integration-title">
            <h3>Jellyfin</h3>
            <p>Auto-relocate renamed files and refresh library after encoding</p>
          </div>
          @if (connectionStatus() === 'connected') {
            <span class="status-badge success">
              <i class="fa fa-check-circle"></i>
              Connected
            </span>
          } @else if (connectionStatus() === 'error') {
            <span class="status-badge error">
              <i class="fa fa-times-circle"></i>
              Error
            </span>
          }
        </div>

        <div class="form-group">
          <label for="jellyfinUrl">Server URL</label>
          <input
            id="jellyfinUrl"
            type="text"
            class="form-control"
            [(ngModel)]="jellyfinUrl"
            placeholder="http://192.168.1.100:8096"
          />
          <p class="help-text">Full URL including port (e.g., http://192.168.1.100:8096)</p>
        </div>

        <div class="form-group">
          <label for="jellyfinApiKey">API Key</label>
          <div class="input-group">
            <input
              id="jellyfinApiKey"
              [type]="apiKeyVisible() ? 'text' : 'password'"
              class="form-control"
              [(ngModel)]="jellyfinApiKey"
              placeholder="Enter Jellyfin API key"
            />
            <button type="button" class="btn-icon" (click)="toggleApiKeyVisibility()">
              <i [class]="apiKeyVisible() ? 'fa fa-eye-slash' : 'fa fa-eye'"></i>
            </button>
          </div>
          <p class="help-text">
            Generate in Jellyfin: Dashboard → API Keys → Add
          </p>
        </div>

        <div class="setting-card-header compact">
          <div class="setting-header-text">
            <h4>Refresh Library on Complete</h4>
            <p>Trigger Jellyfin library scan after each encoding job</p>
          </div>
          <label class="switch">
            <input
              type="checkbox"
              [(ngModel)]="refreshOnComplete"
            />
            <span class="slider"></span>
          </label>
        </div>

        <div class="button-row">
          <button
            type="button"
            class="btn-secondary"
            (click)="testConnection()"
            [disabled]="testing() || !jellyfinUrl"
          >
            @if (testing()) {
              <i class="fa fa-spinner fa-spin"></i>
              Testing...
            } @else {
              <i class="fa fa-plug"></i>
              Test Connection
            }
          </button>

          <button
            type="button"
            class="btn-primary"
            (click)="saveSettings()"
            [disabled]="saving()"
          >
            @if (saving()) {
              <i class="fa fa-spinner fa-spin"></i>
              Saving...
            } @else {
              <i class="fa fa-save"></i>
              Save Settings
            }
          </button>
        </div>

        @if (testResult()) {
          <div
            class="test-result"
            [class.success]="testResult()!.success"
            [class.error]="!testResult()!.success"
          >
            @if (testResult()!.success) {
              <i class="fa fa-check-circle"></i>
              <div>
                <strong>Connected to {{ testResult()!.serverName }}</strong>
                <span>Version {{ testResult()!.version }}</span>
              </div>
            } @else {
              <i class="fa fa-times-circle"></i>
              <div>
                <strong>Connection Failed</strong>
                <span>{{ testResult()!.error }}</span>
              </div>
            }
          </div>
        }

        @if (successMessage()) {
          <div class="alert success">
            <i class="fa fa-check-circle"></i>
            {{ successMessage() }}
          </div>
        }

        @if (errorMessage()) {
          <div class="alert error">
            <i class="fa fa-exclamation-circle"></i>
            {{ errorMessage() }}
          </div>
        }
      </div>

      <!-- How It Works Section -->
      <div class="info-card help-card">
        <h3><i class="fa fa-info-circle"></i> How Jellyfin Integration Works</h3>
        <ul class="feature-list">
          <li>
            <i class="fa fa-search"></i>
            <span><strong>Auto-Relocate:</strong> When a file is not found, BitBonsai queries Jellyfin to find the renamed file</span>
          </li>
          <li>
            <i class="fa fa-sync"></i>
            <span><strong>Library Refresh:</strong> After encoding completes, triggers a Jellyfin library scan so new files appear immediately</span>
          </li>
          <li>
            <i class="fa fa-shield-alt"></i>
            <span><strong>Fallback:</strong> If Jellyfin is unavailable, falls back to filesystem-based file matching</span>
          </li>
        </ul>
      </div>
    </div>
  `,
  styles: [
    `
      .integration-header {
        display: flex;
        align-items: center;
        gap: 1rem;
        margin-bottom: 1.5rem;
        padding-bottom: 1rem;
        border-bottom: 1px solid var(--border-color);
      }

      .integration-icon {
        width: 48px;
        height: 48px;
        border-radius: 12px;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 1.5rem;
      }

      .jellyfin-icon {
        background: linear-gradient(135deg, #00a4dc, #aa5cc3);
        color: white;
      }

      .integration-title {
        flex: 1;
      }

      .integration-title h3 {
        margin: 0;
        font-size: 1.25rem;
      }

      .integration-title p {
        margin: 0.25rem 0 0;
        color: var(--text-secondary);
        font-size: 0.875rem;
      }

      .status-badge {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.5rem 1rem;
        border-radius: 9999px;
        font-size: 0.875rem;
        font-weight: 500;
      }

      .status-badge.success {
        background: var(--success-bg);
        color: var(--success);
      }

      .status-badge.error {
        background: var(--error-bg);
        color: var(--error);
      }

      .form-group {
        margin-bottom: 1.25rem;
      }

      .form-group label {
        display: block;
        margin-bottom: 0.5rem;
        font-weight: 500;
        color: var(--text-primary);
      }

      .form-control {
        width: 100%;
        padding: 0.75rem 1rem;
        border: 1px solid var(--border-color);
        border-radius: 8px;
        background: var(--input-bg);
        color: var(--text-primary);
        font-size: 1rem;
      }

      .form-control:focus {
        outline: none;
        border-color: var(--primary);
        box-shadow: 0 0 0 3px var(--primary-alpha);
      }

      .input-group {
        display: flex;
        gap: 0.5rem;
      }

      .input-group .form-control {
        flex: 1;
      }

      .help-text {
        margin: 0.5rem 0 0;
        font-size: 0.8rem;
        color: var(--text-secondary);
      }

      .setting-card-header.compact {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 1rem;
        background: var(--card-bg-alt);
        border-radius: 8px;
        margin-bottom: 1.5rem;
      }

      .setting-card-header.compact h4 {
        margin: 0;
        font-size: 1rem;
      }

      .setting-card-header.compact p {
        margin: 0.25rem 0 0;
        font-size: 0.8rem;
        color: var(--text-secondary);
      }

      .button-row {
        display: flex;
        gap: 1rem;
        margin-bottom: 1rem;
      }

      .test-result {
        display: flex;
        align-items: center;
        gap: 1rem;
        padding: 1rem;
        border-radius: 8px;
        margin-top: 1rem;
      }

      .test-result.success {
        background: var(--success-bg);
        color: var(--success);
      }

      .test-result.error {
        background: var(--error-bg);
        color: var(--error);
      }

      .test-result i {
        font-size: 1.5rem;
      }

      .test-result div {
        display: flex;
        flex-direction: column;
      }

      .test-result span {
        font-size: 0.875rem;
        opacity: 0.8;
      }

      .alert {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        padding: 1rem;
        border-radius: 8px;
        margin-top: 1rem;
      }

      .alert.success {
        background: var(--success-bg);
        color: var(--success);
      }

      .alert.error {
        background: var(--error-bg);
        color: var(--error);
      }

      .help-card {
        margin-top: 1.5rem;
        background: var(--card-bg-alt);
      }

      .help-card h3 {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        margin-bottom: 1rem;
        color: var(--primary);
      }

      .feature-list {
        list-style: none;
        padding: 0;
        margin: 0;
      }

      .feature-list li {
        display: flex;
        align-items: flex-start;
        gap: 1rem;
        padding: 0.75rem 0;
        border-bottom: 1px solid var(--border-color);
      }

      .feature-list li:last-child {
        border-bottom: none;
      }

      .feature-list i {
        color: var(--primary);
        margin-top: 0.25rem;
      }

      /* Toggle switch styles */
      .switch {
        position: relative;
        display: inline-block;
        width: 48px;
        height: 26px;
      }

      .switch input {
        opacity: 0;
        width: 0;
        height: 0;
      }

      .slider {
        position: absolute;
        cursor: pointer;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background-color: var(--border-color);
        transition: 0.3s;
        border-radius: 26px;
      }

      .slider:before {
        position: absolute;
        content: '';
        height: 20px;
        width: 20px;
        left: 3px;
        bottom: 3px;
        background-color: white;
        transition: 0.3s;
        border-radius: 50%;
      }

      input:checked + .slider {
        background-color: var(--primary);
      }

      input:checked + .slider:before {
        transform: translateX(22px);
      }

      .btn-icon {
        padding: 0.75rem;
        border: 1px solid var(--border-color);
        border-radius: 8px;
        background: var(--input-bg);
        color: var(--text-secondary);
        cursor: pointer;
        transition: all 0.2s;
      }

      .btn-icon:hover {
        color: var(--text-primary);
        border-color: var(--primary);
      }
    `,
  ],
})
export class IntegrationsTabComponent implements OnInit {
  private readonly settingsClient = inject(SettingsClient);
  private readonly destroyRef = inject(DestroyRef);

  // Form state
  jellyfinUrl = '';
  jellyfinApiKey = '';
  refreshOnComplete = true;

  // UI state
  testing = signal(false);
  saving = signal(false);
  apiKeyVisible = signal(false);
  connectionStatus = signal<'unknown' | 'connected' | 'error'>('unknown');
  testResult = signal<JellyfinTestResult | null>(null);
  successMessage = signal<string | null>(null);
  errorMessage = signal<string | null>(null);

  ngOnInit(): void {
    this.loadSettings();
  }

  private loadSettings(): void {
    this.settingsClient
      .getJellyfinSettings()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (settings: JellyfinSettings) => {
          this.jellyfinUrl = settings.jellyfinUrl || '';
          this.jellyfinApiKey = settings.jellyfinApiKey || '';
          this.refreshOnComplete = settings.jellyfinRefreshOnComplete ?? true;
        },
        error: () => {
          this.errorMessage.set('Failed to load Jellyfin settings');
        },
      });
  }

  toggleApiKeyVisibility(): void {
    this.apiKeyVisible.set(!this.apiKeyVisible());
  }

  testConnection(): void {
    this.testing.set(true);
    this.testResult.set(null);
    this.errorMessage.set(null);
    this.successMessage.set(null);

    const settings: JellyfinSettings = {
      jellyfinUrl: this.jellyfinUrl,
      jellyfinApiKey: this.jellyfinApiKey,
    };

    this.settingsClient
      .testJellyfinConnection(settings)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result: JellyfinTestResult) => {
          this.testing.set(false);
          this.testResult.set(result);
          this.connectionStatus.set(result.success ? 'connected' : 'error');
        },
        error: () => {
          this.testing.set(false);
          this.testResult.set({
            success: false,
            error: 'Failed to test connection',
          });
          this.connectionStatus.set('error');
        },
      });
  }

  saveSettings(): void {
    this.saving.set(true);
    this.errorMessage.set(null);
    this.successMessage.set(null);

    const settings: JellyfinSettings = {
      jellyfinUrl: this.jellyfinUrl || undefined,
      jellyfinApiKey: this.jellyfinApiKey || undefined,
      jellyfinRefreshOnComplete: this.refreshOnComplete,
    };

    this.settingsClient
      .updateJellyfinSettings(settings)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.saving.set(false);
          this.successMessage.set('Jellyfin settings saved successfully');
          setTimeout(() => this.successMessage.set(null), 3000);
        },
        error: () => {
          this.saving.set(false);
          this.errorMessage.set('Failed to save Jellyfin settings');
        },
      });
  }
}
