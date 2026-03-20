import { Dialog } from '@angular/cdk/dialog';
import { Component, DestroyRef, inject, type OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  FormBuilder,
  type FormControl,
  type FormGroup,
  FormsModule,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { TranslocoModule } from '@ngneat/transloco';
import { Store } from '@ngrx/store';
import { SettingsClient } from '../../../core/clients/settings.client';
import {
  ConfirmationDialogComponent,
  type ConfirmationDialogData,
} from '../../../shared/components/confirmation-dialog/confirmation-dialog.component';
import { SettingsActions } from '../+state/settings.actions';
import { SettingsSelectors } from '../+state/settings.selectors';
import { LogLevel } from '../models/log-level.enum';
import type { SystemSettings } from '../models/system-settings.model';
import { SettingsService } from '../services/settings.service';

@Component({
  selector: 'app-advanced-tab',
  standalone: true,
  imports: [FormsModule, ReactiveFormsModule, TranslocoModule],
  template: `
    <div class="tab-panel">
      <h2>Advanced Settings</h2>
      <p class="tab-description">
        Configure security, caching, logging, and API integration settings
      </p>

      @if (systemSettings()) {
        <!-- Settings Grid - 2 columns -->
        <div class="advanced-grid">
          <!-- Advanced Mode Toggle Card (UI Simplification) -->
          <div class="info-card setting-card">
            <div class="setting-card-header">
              <div class="setting-icon advanced-mode-icon">
                <i class="fa fa-sliders-h"></i>
              </div>
              <div class="setting-header-text">
                <h3>Advanced Mode</h3>
                <p>Show power user controls</p>
              </div>
              <label class="switch">
                <input
                  type="checkbox"
                  id="advancedMode"
                  [ngModel]="advancedModeEnabled()"
                  (ngModelChange)="onAdvancedModeToggle($event)"
                  [ngModelOptions]="{ standalone: true }"
                />
                <span class="slider"></span>
              </label>
            </div>
            <div class="setting-note">
              <i class="fa fa-info-circle"></i>
              @if (advancedModeEnabled()) {
                Showing bulk actions, node filters, debug info, and technical
                details
              } @else {
                Minimal interface with essential controls only
              }
            </div>
          </div>

          <!-- Quality Metrics Toggle Card -->
          <div class="info-card setting-card">
            <div class="setting-card-header">
              <div class="setting-icon analytics-icon">
                <i class="fa fa-chart-bar"></i>
              </div>
              <div class="setting-header-text">
                <h3>Quality Metrics</h3>
                <p>VMAF / PSNR / SSIM after encoding</p>
              </div>
              <label class="switch">
                <input
                  type="checkbox"
                  id="qualityMetrics"
                  [ngModel]="qualityMetricsEnabled()"
                  (ngModelChange)="onQualityMetricsToggle($event)"
                  [ngModelOptions]="{ standalone: true }"
                />
                <span class="slider"></span>
              </label>
            </div>
            <div class="setting-note">
              <i class="fa fa-info-circle"></i>
              @if (qualityMetricsEnabled()) {
                Calculating quality metrics after each encode (adds CPU overhead)
              } @else {
                Enable to measure encoding quality with industry-standard metrics
              }
            </div>
          </div>

          <!-- Security Toggle Card -->
          <div class="info-card setting-card">
            <div class="setting-card-header">
              <div class="setting-icon security-icon">
                <i class="fa fa-shield-alt"></i>
              </div>
              <div class="setting-header-text">
                <h3>Local Network Auth Bypass</h3>
                <p>Skip login for local network users</p>
              </div>
              <label class="switch">
                <input
                  type="checkbox"
                  id="localNetworkBypass"
                  [ngModel]="localNetworkBypassEnabled()"
                  (ngModelChange)="
                    localNetworkBypassEnabled.set($event);
                    onLocalNetworkBypassToggle()
                  "
                  [ngModelOptions]="{ standalone: true }"
                />
                <span class="slider"></span>
              </label>
            </div>
            @if (localNetworkBypassEnabled()) {
              <div class="setting-note warning-note">
                <i class="fa fa-exclamation-triangle"></i>
                Anyone on local network can access without authentication
              </div>
            }
          </div>

          <!-- Cache Settings Card -->
          <div class="info-card setting-card">
            <div class="setting-card-header">
              <div class="setting-icon cache-icon">
                <i class="fa fa-database"></i>
              </div>
              <div class="setting-header-text">
                <h3>Library Cache TTL</h3>
                <p>Cache duration for library scans (min)</p>
              </div>
              <input
                type="number"
                class="form-control setting-input-inline"
                [ngModel]="readyFilesCacheTtl()"
                (ngModelChange)="readyFilesCacheTtl.set($event)"
                [ngModelOptions]="{ standalone: true }"
                min="5"
                (change)="saveReadyFilesCacheTtl()"
              />
            </div>
            <div class="setting-note">
              <i class="fa fa-info-circle"></i>
              Higher values reduce disk I/O but may delay showing new files
            </div>
          </div>

          <!-- Auto-Heal Settings Card -->
          <div class="info-card setting-card">
            <div class="setting-card-header">
              <div class="setting-icon heal-icon">
                <i class="fa fa-heartbeat"></i>
              </div>
              <div class="setting-header-text">
                <h3>Auto-Heal Retry Limit</h3>
                <p>Max retry attempts for failed jobs</p>
              </div>
              <input
                type="number"
                class="form-control setting-input-inline"
                [ngModel]="maxAutoHealRetries()"
                (ngModelChange)="maxAutoHealRetries.set($event)"
                [ngModelOptions]="{ standalone: true }"
                min="3"
                (change)="saveAutoHealRetryLimit()"
              />
            </div>
            <div class="setting-note">
              <i class="fa fa-info-circle"></i>
              Recommended: 10-20 for high-load systems
            </div>
          </div>

          <!-- Analytics Toggle Card -->
          <div class="info-card setting-card">
            <div class="setting-card-header">
              <div class="setting-icon analytics-icon">
                <i class="fa fa-chart-line"></i>
              </div>
              <div class="setting-header-text">
                <h3>Anonymous Analytics</h3>
                <p>Help improve BitBonsai</p>
              </div>
              <label class="switch">
                <input
                  type="checkbox"
                  [checked]="settingsForm.value.analyticsEnabled ?? true"
                  (change)="onAnalyticsToggle($event)"
                />
                <span class="slider"></span>
              </label>
            </div>
            <div class="setting-note">
              <i class="fa fa-info-circle"></i>
              No personal data, filenames, or media content collected
            </div>
          </div>
        </div>

        <!-- System Configuration Form (Full Width) -->
        <form [formGroup]="settingsForm" (ngSubmit)="updateSystemSettings()">
          <div class="info-card">
            <h3>System Configuration</h3>
            <div class="form-row-grid">
              <!-- FFmpeg Path -->
              <div class="form-group">
                <label for="ffmpegPath">FFmpeg Path</label>
                <input
                  id="ffmpegPath"
                  type="text"
                  class="form-control"
                  formControlName="ffmpegPath"
                  placeholder="/usr/bin/ffmpeg"
                  [class.invalid]="
                    ffmpegPathControl?.invalid && ffmpegPathControl?.touched
                  "
                />
                @if (ffmpegPathControl?.invalid && ffmpegPathControl?.touched) {
                  <span class="error-message"
                    >Path must be absolute (start with /)</span
                  >
                }
              </div>

              <!-- Log Level -->
              <div class="form-group">
                <label for="logLevel">Log Level</label>
                <select
                  id="logLevel"
                  class="form-control"
                  formControlName="logLevel"
                >
                  <option [value]="LogLevel.DEBUG">Debug</option>
                  <option [value]="LogLevel.INFO">Info</option>
                  <option [value]="LogLevel.WARN">Warning</option>
                  <option [value]="LogLevel.ERROR">Error</option>
                </select>
              </div>

              <!-- Webhook URL -->
              <div class="form-group full-width">
                <label for="webhookUrl">Webhook URL (Optional)</label>
                <input
                  id="webhookUrl"
                  type="text"
                  class="form-control"
                  formControlName="webhookUrl"
                  placeholder="https://example.com/webhook"
                  [class.invalid]="
                    webhookUrlControl?.invalid && webhookUrlControl?.touched
                  "
                />
                @if (webhookUrlControl?.invalid && webhookUrlControl?.touched) {
                  <span class="error-message">Webhook URL must use HTTPS</span>
                }
                <p class="help-text">
                  Receive notifications for job completions and errors
                </p>
              </div>
            </div>

            <button
              type="submit"
              class="btn-primary"
              [disabled]="settingsForm.invalid || loading()"
            >
              <i class="fa fa-save"></i>
              Save Configuration
            </button>
          </div>
        </form>

        <!-- API Key Management (Full Width) -->
        <div class="info-card">
          <div class="api-key-header">
            <div>
              <h3>API Key</h3>
              <p class="description">
                Use this key for external integrations and API access
              </p>
            </div>
            <button
              type="button"
              class="btn-secondary btn-sm"
              (click)="regenerateApiKey()"
              [disabled]="loading()"
            >
              <i class="fa fa-refresh"></i>
              Regenerate
            </button>
          </div>
          <div class="api-key-display">
            <code class="api-key-value">
              {{
                apiKeyRevealed()
                  ? systemSettings()!.apiKey
                  : '**********************'
              }}
            </code>
            <button
              type="button"
              class="btn-icon"
              (click)="toggleApiKeyVisibility()"
              [title]="apiKeyRevealed() ? 'Hide' : 'Reveal'"
            >
              <i
                [class]="apiKeyRevealed() ? 'fa fa-eye-slash' : 'fa fa-eye'"
              ></i>
            </button>
            <button
              type="button"
              class="btn-icon"
              (click)="copyToClipboard(systemSettings()!.apiKey, 'API key')"
              title="Copy"
            >
              <i class="fa fa-copy"></i>
            </button>
          </div>
        </div>
      }
    </div>
  `,
})
export class AdvancedTabComponent implements OnInit {
  private readonly settingsService = inject(SettingsService);
  private readonly settingsClient = inject(SettingsClient);
  private readonly fb = inject(FormBuilder);
  private readonly destroyRef = inject(DestroyRef);
  private readonly dialog = inject(Dialog);
  private readonly store = inject(Store);

  systemSettings = signal<SystemSettings | null>(null);
  loading = signal(false);
  error = signal<string | null>(null);
  successMessage = signal<string | null>(null);
  apiKeyRevealed = signal(false);
  localNetworkBypassEnabled = signal(false);
  readyFilesCacheTtl = signal(5);
  maxAutoHealRetries = signal(15);
  advancedModeEnabled = signal(false);
  qualityMetricsEnabled = signal(false);

  settingsForm!: FormGroup<{
    ffmpegPath: FormControl<string | null>;
    logLevel: FormControl<string | null>;
    analyticsEnabled: FormControl<boolean | null>;
    webhookUrl: FormControl<string | null>;
  }>;

  LogLevel = LogLevel;

  ngOnInit(): void {
    this.initializeForm();
    this.loadSystemSettings();
    this.loadSecuritySettings();
    this.loadReadyFilesCacheTtl();
    this.loadAutoHealRetryLimit();
    this.loadAdvancedMode();
    this.loadQualityMetrics();
  }

  private initializeForm(): void {
    this.settingsForm = this.fb.group({
      ffmpegPath: ['', [Validators.required, Validators.pattern(/^\/.*/)]],
      logLevel: ['INFO', Validators.required],
      analyticsEnabled: [true],
      webhookUrl: ['', [Validators.pattern(/^https:\/\/.+/)]],
    });
  }

  private loadSystemSettings(): void {
    this.settingsService
      .getSystemSettings()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (settings) => {
          this.systemSettings.set(settings);
          this.settingsForm.patchValue({
            ffmpegPath: settings.ffmpegPath,
            logLevel: settings.logLevel,
            analyticsEnabled: settings.analyticsEnabled,
            webhookUrl: settings.webhookUrl || '',
          });
        },
        error: () => {
          this.error.set('Failed to load system settings');
        },
      });
  }

  private loadSecuritySettings(): void {
    this.settingsService
      .getSecuritySettings()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (settings) => {
          this.localNetworkBypassEnabled.set(settings.allowLocalNetworkWithoutAuth);
        },
        error: () => {
          // Silent fail - security settings have safe defaults
        },
      });
  }

  private loadReadyFilesCacheTtl(): void {
    this.settingsClient
      .getReadyFilesCacheTtl()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (settings) => {
          this.readyFilesCacheTtl.set(settings.readyFilesCacheTtlMinutes);
        },
        error: () => {
          // Silent fail - uses default value from signal (5)
        },
      });
  }

  private loadAutoHealRetryLimit(): void {
    this.settingsClient
      .getAutoHealRetryLimit()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (settings) => {
          this.maxAutoHealRetries.set(settings.maxAutoHealRetries);
        },
        error: () => {
          // Silent fail - uses default value from signal (15)
        },
      });
  }

  private loadAdvancedMode(): void {
    // Dispatch action to load from API (effect handles HTTP call)
    this.store.dispatch(SettingsActions.loadAdvancedMode());

    // Subscribe to store to sync local signal with NgRx state
    this.store
      .select(SettingsSelectors.selectAdvancedMode)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((enabled) => {
        this.advancedModeEnabled.set(enabled);
      });
  }

  private loadQualityMetrics(): void {
    this.settingsClient
      .getQualityMetrics()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (settings) => {
          this.qualityMetricsEnabled.set(settings.qualityMetricsEnabled);
        },
        error: () => {
          // Silent fail - uses default value from signal (false)
        },
      });
  }

  onQualityMetricsToggle(enabled: boolean): void {
    this.qualityMetricsEnabled.set(enabled);
    this.loading.set(true);
    this.error.set(null);
    this.successMessage.set(null);

    this.settingsClient
      .updateQualityMetrics(enabled)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.loading.set(false);
          this.successMessage.set(enabled ? 'Quality metrics enabled' : 'Quality metrics disabled');
        },
        error: () => {
          this.loading.set(false);
          this.error.set('Failed to update quality metrics setting');
          this.qualityMetricsEnabled.set(!enabled);
        },
      });
  }

  onAdvancedModeToggle(enabled: boolean): void {
    this.advancedModeEnabled.set(enabled);
    this.loading.set(true);
    this.error.set(null);
    this.successMessage.set(null);

    this.settingsClient
      .updateAdvancedMode(enabled)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.loading.set(false);
          this.successMessage.set(enabled ? 'Advanced mode enabled' : 'Minimal mode enabled');
          // Sync to NgRx store so Queue page and other components get the update
          this.store.dispatch(SettingsActions.updateAdvancedModeSuccess({ enabled }));
        },
        error: () => {
          this.loading.set(false);
          this.error.set('Failed to update interface mode');
          this.advancedModeEnabled.set(!enabled);
        },
      });
  }

  onLocalNetworkBypassToggle(): void {
    this.loading.set(true);
    this.error.set(null);
    this.successMessage.set(null);

    this.settingsService
      .updateSecuritySettings({
        allowLocalNetworkWithoutAuth: this.localNetworkBypassEnabled(),
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.loading.set(false);
          this.successMessage.set(
            `Local network auth bypass ${this.localNetworkBypassEnabled() ? 'enabled' : 'disabled'} successfully`
          );
        },
        error: () => {
          this.loading.set(false);
          this.error.set('Failed to update security settings');
          this.localNetworkBypassEnabled.set(!this.localNetworkBypassEnabled());
        },
      });
  }

  onAnalyticsToggle(event: Event): void {
    const target = event.target as HTMLInputElement;
    this.settingsForm.patchValue({ analyticsEnabled: target.checked });
  }

  saveReadyFilesCacheTtl(): void {
    // Validate minimum value
    if (this.readyFilesCacheTtl() < 5) {
      this.error.set('Cache TTL must be at least 5 minutes');
      this.readyFilesCacheTtl.set(5);
      return;
    }

    this.loading.set(true);
    this.error.set(null);
    this.successMessage.set(null);

    this.settingsClient
      .updateReadyFilesCacheTtl(this.readyFilesCacheTtl())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.loading.set(false);
          this.successMessage.set('Cache TTL updated successfully');
        },
        error: () => {
          this.loading.set(false);
          this.error.set('Failed to update cache TTL');
        },
      });
  }

  saveAutoHealRetryLimit(): void {
    // Validate minimum value
    if (this.maxAutoHealRetries() < 3) {
      this.error.set('Auto-heal retry limit must be at least 3');
      this.maxAutoHealRetries.set(3);
      return;
    }

    this.loading.set(true);
    this.error.set(null);
    this.successMessage.set(null);

    this.settingsClient
      .updateAutoHealRetryLimit(this.maxAutoHealRetries())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.loading.set(false);
          this.successMessage.set('Auto-heal retry limit updated successfully');
        },
        error: () => {
          this.loading.set(false);
          this.error.set('Failed to update auto-heal retry limit');
        },
      });
  }

  updateSystemSettings(): void {
    if (this.settingsForm.valid) {
      this.loading.set(true);
      this.error.set(null);
      this.successMessage.set(null);

      const formValue = this.settingsForm.value;
      const updates = {
        ...(formValue.ffmpegPath && { ffmpegPath: formValue.ffmpegPath }),
        ...(formValue.logLevel && { logLevel: formValue.logLevel as LogLevel }),
        ...(formValue.analyticsEnabled !== null && {
          analyticsEnabled: formValue.analyticsEnabled,
        }),
        ...(formValue.webhookUrl && { webhookUrl: formValue.webhookUrl }),
      };

      this.settingsService
        .updateSystemSettings(updates)
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (settings) => {
            this.systemSettings.set(settings);
            this.loading.set(false);
            this.successMessage.set('Settings updated successfully!');
          },
          error: () => {
            this.error.set('Failed to update settings');
            this.loading.set(false);
          },
        });
    }
  }

  regenerateApiKey(): void {
    const dialogData: ConfirmationDialogData = {
      title: 'Regenerate API Key?',
      itemName: 'API Key',
      itemType: 'system credential',
      willHappen: [
        'Generate a new API key immediately',
        'Invalidate the current API key',
        'Display the new key for copying',
      ],
      wontHappen: [
        'Affect existing authenticated sessions',
        'Delete any system data or settings',
        'Require system restart',
      ],
      irreversible: true,
      confirmButtonText: 'Regenerate Key',
      cancelButtonText: 'Keep Current Key',
    };

    const dialogRef = this.dialog.open(ConfirmationDialogComponent, {
      data: dialogData,
      disableClose: false,
    });

    dialogRef.closed.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((confirmed) => {
      if (confirmed === true) {
        this.loading.set(true);
        this.error.set(null);
        this.successMessage.set(null);

        this.settingsService
          .regenerateApiKey()
          .pipe(takeUntilDestroyed(this.destroyRef))
          .subscribe({
            next: (result: { apiKey: string }) => {
              const currentSettings = this.systemSettings();
              if (currentSettings) {
                this.systemSettings.set({
                  ...currentSettings,
                  apiKey: result.apiKey,
                });
              }
              this.loading.set(false);
              this.successMessage.set('API key regenerated successfully!');
            },
            error: () => {
              this.error.set('Failed to regenerate API key');
              this.loading.set(false);
            },
          });
      }
    });
  }

  toggleApiKeyVisibility(): void {
    this.apiKeyRevealed.set(!this.apiKeyRevealed());
  }

  copyToClipboard(text: string, label: string): void {
    navigator.clipboard.writeText(text).then(() => {
      this.successMessage.set(`${label} copied to clipboard`);
      setTimeout(() => {
        this.successMessage.set(null);
      }, 3000);
    });
  }

  get ffmpegPathControl() {
    return this.settingsForm.get('ffmpegPath');
  }

  get webhookUrlControl() {
    return this.settingsForm.get('webhookUrl');
  }
}
