import { CommonModule } from '@angular/common';
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
import { SettingsClient } from '../../core/clients/settings.client';
import { CpuCapacityPanelComponent } from './components/cpu-capacity-panel/cpu-capacity-panel.component';
import type { EnvironmentInfo } from './models/environment-info.model';
import type { ActivateLicense, License } from './models/license.model';
import { LicenseTier } from './models/license.model';
import { LogLevel } from './models/log-level.enum';
import { SettingsTab } from './models/settings-tab.enum';
import type { SystemSettings } from './models/system-settings.model';
import { LicenseService } from './services/license.service';
import { SettingsService } from './services/settings.service';

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule, CpuCapacityPanelComponent],
  templateUrl: './settings.page.html',
  styleUrls: ['./settings.page.scss'],
})
export class SettingsComponent implements OnInit {
  private readonly licenseService = inject(LicenseService);
  private readonly settingsService = inject(SettingsService);
  private readonly settingsClient = inject(SettingsClient);
  private readonly fb = inject(FormBuilder);
  private readonly destroyRef = inject(DestroyRef);

  // Expose enum for template
  protected readonly SettingsTab = SettingsTab;

  // State
  activeTab: SettingsTab = SettingsTab.LICENSE;
  license = signal<License | null>(null);
  environmentInfo: EnvironmentInfo | null = null;
  systemSettings: SystemSettings | null = null;
  loading = signal(false);
  error: string | null = null;
  successMessage: string | null = null;
  licenseKeyRevealed = false;
  apiKeyRevealed = false;
  localNetworkBypassEnabled = false;
  readyFilesCacheTtl = 5;
  maxAutoHealRetries = 15;

  // Forms
  licenseForm!: FormGroup<{
    licenseKey: FormControl<string | null>;
    email: FormControl<string | null>;
  }>;
  settingsForm!: FormGroup<{
    ffmpegPath: FormControl<string | null>;
    logLevel: FormControl<string | null>;
    analyticsEnabled: FormControl<boolean | null>;
    webhookUrl: FormControl<string | null>;
  }>;

  // Enums for template
  LicenseTier = LicenseTier;
  LogLevel = LogLevel;

  ngOnInit(): void {
    this.initializeForms();
    this.loadData();
  }

  private initializeForms(): void {
    // License activation form
    this.licenseForm = this.fb.group({
      licenseKey: [
        '',
        [
          Validators.required,
          Validators.pattern(/^[A-Z0-9]{3}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/),
        ],
      ],
      email: ['', [Validators.required, Validators.email]],
    });

    // System settings form
    this.settingsForm = this.fb.group({
      ffmpegPath: ['', [Validators.required, Validators.pattern(/^\/.*/)]],
      logLevel: ['INFO', Validators.required],
      analyticsEnabled: [true],
      webhookUrl: ['', [Validators.pattern(/^https:\/\/.+/)]],
    });
  }

  private loadData(): void {
    this.loadLicense();
    this.loadEnvironmentInfo();
    this.loadSystemSettings();
    this.loadSecuritySettings();
    this.loadReadyFilesCacheTtl();
    this.loadAutoHealRetryLimit();
  }

  private loadLicense(): void {
    this.loading.set(true);
    this.licenseService
      .getCurrentLicense()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (license) => {
          this.license.set(license);
          this.loading.set(false);
        },
        error: (_err) => {
          this.error = 'Failed to load license information';
          this.loading.set(false);
        },
      });
  }

  private loadEnvironmentInfo(): void {
    this.settingsService
      .getEnvironmentInfo()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (info) => {
          this.environmentInfo = info;
        },
        error: () => {
          // Failed to load environment info
        },
      });
  }

  private loadSystemSettings(): void {
    this.settingsService
      .getSystemSettings()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (settings) => {
          this.systemSettings = settings;
          this.settingsForm.patchValue({
            ffmpegPath: settings.ffmpegPath,
            logLevel: settings.logLevel,
            analyticsEnabled: settings.analyticsEnabled,
            webhookUrl: settings.webhookUrl || '',
          });
        },
        error: () => {
          // Failed to load system settings
        },
      });
  }

  private loadSecuritySettings(): void {
    this.settingsService
      .getSecuritySettings()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (settings) => {
          this.localNetworkBypassEnabled = settings.allowLocalNetworkWithoutAuth;
        },
        error: () => {
          // Failed to load security settings
        },
      });
  }

  onLocalNetworkBypassToggle(): void {
    this.loading.set(true);
    this.clearMessages();

    this.settingsService
      .updateSecuritySettings({
        allowLocalNetworkWithoutAuth: this.localNetworkBypassEnabled,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.loading.set(false);
          this.successMessage = `Local network auth bypass ${this.localNetworkBypassEnabled ? 'enabled' : 'disabled'} successfully`;
        },
        error: (_err) => {
          this.loading.set(false);
          this.error = 'Failed to update security settings';
          // Revert toggle on error
          this.localNetworkBypassEnabled = !this.localNetworkBypassEnabled;
        },
      });
  }

  setActiveTab(tab: SettingsTab): void {
    this.activeTab = tab;
    this.clearMessages();
  }

  getTierBadgeClass(tier: LicenseTier): string {
    switch (tier) {
      case LicenseTier.FREE:
        return 'tier-badge tier-free';
      case LicenseTier.PATREON:
        return 'tier-badge tier-patreon';
      case LicenseTier.COMMERCIAL_PRO:
        return 'tier-badge tier-commercial';
      default:
        return 'tier-badge';
    }
  }

  getTierDisplayName(tier: LicenseTier): string {
    switch (tier) {
      case LicenseTier.FREE:
        return 'Free';
      case LicenseTier.PATREON:
        return 'Patreon Supporter';
      case LicenseTier.COMMERCIAL_PRO:
        return 'Commercial Pro';
      default:
        return tier;
    }
  }

  toggleLicenseKeyVisibility(): void {
    this.licenseKeyRevealed = !this.licenseKeyRevealed;
  }

  toggleApiKeyVisibility(): void {
    this.apiKeyRevealed = !this.apiKeyRevealed;
  }

  copyToClipboard(text: string, label: string): void {
    navigator.clipboard.writeText(text).then(() => {
      this.successMessage = `${label} copied to clipboard`;
      setTimeout(() => {
        this.successMessage = null;
      }, 3000);
    });
  }

  activateLicense(): void {
    if (this.licenseForm.valid) {
      this.loading.set(true);
      this.clearMessages();

      const formValue = this.licenseForm.value;
      const request: ActivateLicense = {
        licenseKey: formValue.licenseKey ?? '',
        email: formValue.email ?? '',
      };

      this.licenseService
        .activateLicense(request)
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (license) => {
            this.license.set(license);
            this.loading.set(false);
            this.successMessage = 'License activated successfully!';
            this.licenseForm.reset();
          },
          error: (_err) => {
            this.error = 'Failed to activate license. Please check your key and try again.';
            this.loading.set(false);
          },
        });
    }
  }

  updateSystemSettings(): void {
    if (this.settingsForm.valid) {
      this.loading.set(true);
      this.clearMessages();

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
            this.systemSettings = settings;
            this.loading.set(false);
            this.successMessage = 'Settings updated successfully!';
          },
          error: (_err) => {
            this.error = 'Failed to update settings';
            this.loading.set(false);
          },
        });
    }
  }

  backupDatabase(): void {
    this.loading.set(true);
    this.clearMessages();

    this.settingsService
      .backupDatabase()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result: { backupPath: string }) => {
          this.loading.set(false);
          this.successMessage = `Database backed up to: ${result.backupPath}`;
        },
        error: (_err: Error) => {
          this.error = 'Failed to backup database';
          this.loading.set(false);
        },
      });
  }

  resetToDefaults(): void {
    if (
      confirm(
        'Are you sure you want to reset all settings to defaults? This action cannot be undone.'
      )
    ) {
      this.loading.set(true);
      this.clearMessages();

      this.settingsService
        .resetToDefaults()
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (result: { message: string }) => {
            this.loading.set(false);
            this.successMessage = result.message;
            this.loadSystemSettings();
          },
          error: (_err: Error) => {
            this.error = 'Failed to reset settings';
            this.loading.set(false);
          },
        });
    }
  }

  regenerateApiKey(): void {
    if (
      confirm(
        'Are you sure you want to regenerate the API key? The old key will be invalidated immediately.'
      )
    ) {
      this.loading.set(true);
      this.clearMessages();

      this.settingsService
        .regenerateApiKey()
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (result: { apiKey: string }) => {
            const currentSettings = this.systemSettings;
            if (currentSettings) {
              this.systemSettings = { ...currentSettings, apiKey: result.apiKey };
            }
            this.loading.set(false);
            this.successMessage = 'API key regenerated successfully!';
          },
          error: (_err: Error) => {
            this.error = 'Failed to regenerate API key';
            this.loading.set(false);
          },
        });
    }
  }

  private loadReadyFilesCacheTtl(): void {
    this.settingsClient
      .getReadyFilesCacheTtl()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (settings) => {
          this.readyFilesCacheTtl = settings.readyFilesCacheTtlMinutes;
        },
        error: () => {
          // Failed to load cache TTL
        },
      });
  }

  saveReadyFilesCacheTtl(): void {
    // Validate minimum value
    if (this.readyFilesCacheTtl < 5) {
      this.error = 'Cache TTL must be at least 5 minutes';
      this.readyFilesCacheTtl = 5;
      return;
    }

    this.loading.set(true);
    this.clearMessages();

    this.settingsClient
      .updateReadyFilesCacheTtl(this.readyFilesCacheTtl)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.loading.set(false);
          this.successMessage = 'Cache TTL updated successfully';
        },
        error: (_err) => {
          this.loading.set(false);
          this.error = 'Failed to update cache TTL';
        },
      });
  }

  private loadAutoHealRetryLimit(): void {
    this.settingsClient
      .getAutoHealRetryLimit()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (settings) => {
          this.maxAutoHealRetries = settings.maxAutoHealRetries;
        },
        error: () => {
          // Failed to load auto-heal retry limit
        },
      });
  }

  saveAutoHealRetryLimit(): void {
    // Validate minimum value
    if (this.maxAutoHealRetries < 3) {
      this.error = 'Auto-heal retry limit must be at least 3';
      this.maxAutoHealRetries = 3;
      return;
    }

    this.loading.set(true);
    this.clearMessages();

    this.settingsClient
      .updateAutoHealRetryLimit(this.maxAutoHealRetries)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.loading.set(false);
          this.successMessage = 'Auto-heal retry limit updated successfully';
        },
        error: (_err) => {
          this.loading.set(false);
          this.error = 'Failed to update auto-heal retry limit';
        },
      });
  }

  private clearMessages(): void {
    this.error = null;
    this.successMessage = null;
  }

  get licenseKeyControl() {
    return this.licenseForm.get('licenseKey');
  }

  get emailControl() {
    return this.licenseForm.get('email');
  }

  get ffmpegPathControl() {
    return this.settingsForm.get('ffmpegPath');
  }

  get webhookUrlControl() {
    return this.settingsForm.get('webhookUrl');
  }
}
