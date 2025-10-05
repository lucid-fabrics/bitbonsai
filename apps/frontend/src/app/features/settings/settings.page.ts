import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, type OnInit } from '@angular/core';
import {
  FormBuilder,
  type FormControl,
  type FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import type { ActivateLicense, License } from './models/license.model';
import { LicenseTier } from './models/license.model';
import type { EnvironmentInfo, SystemSettings } from './models/settings.model';
import { LogLevel } from './models/settings.model';
import { LicenseService } from './services/license.service';
import { SettingsService } from './services/settings.service';

type SettingsTab = 'license' | 'environment' | 'system' | 'advanced';

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './settings.page.html',
  styleUrls: ['./settings.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SettingsComponent implements OnInit {
  private readonly licenseService = inject(LicenseService);
  private readonly settingsService = inject(SettingsService);
  private readonly fb = inject(FormBuilder);

  // State signals
  activeTab: SettingsTab = 'license';
  license: License | null = null;
  environmentInfo: EnvironmentInfo | null = null;
  systemSettings: SystemSettings | null = null;
  loading = false;
  error: string | null = null;
  successMessage: string | null = null;
  licenseKeyRevealed = false;
  apiKeyRevealed = false;

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
  }

  private loadLicense(): void {
    this.loading = true;
    this.licenseService.getCurrentLicense().subscribe({
      next: (license) => {
        this.license = license;
        this.loading = false;
      },
      error: (_err) => {
        this.error = 'Failed to load license information';
        this.loading = false;
      },
    });
  }

  private loadEnvironmentInfo(): void {
    this.settingsService.getEnvironmentInfo().subscribe({
      next: (info) => {
        this.environmentInfo = info;
      },
      error: (err) => {
        console.error('Failed to load environment info:', err);
      },
    });
  }

  private loadSystemSettings(): void {
    this.settingsService.getSystemSettings().subscribe({
      next: (settings) => {
        this.systemSettings = settings;
        this.settingsForm.patchValue({
          ffmpegPath: settings.ffmpegPath,
          logLevel: settings.logLevel,
          analyticsEnabled: settings.analyticsEnabled,
          webhookUrl: settings.webhookUrl || '',
        });
      },
      error: (err) => {
        console.error('Failed to load system settings:', err);
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
      setTimeout(() => (this.successMessage = null), 3000);
    });
  }

  activateLicense(): void {
    if (this.licenseForm.valid) {
      this.loading = true;
      this.clearMessages();

      const formValue = this.licenseForm.value;
      const request: ActivateLicense = {
        licenseKey: formValue.licenseKey ?? '',
        email: formValue.email ?? '',
      };

      this.licenseService.activateLicense(request).subscribe({
        next: (license) => {
          this.license = license;
          this.loading = false;
          this.successMessage = 'License activated successfully!';
          this.licenseForm.reset();
        },
        error: (_err) => {
          this.error = 'Failed to activate license. Please check your key and try again.';
          this.loading = false;
        },
      });
    }
  }

  updateSystemSettings(): void {
    if (this.settingsForm.valid) {
      this.loading = true;
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

      this.settingsService.updateSystemSettings(updates).subscribe({
        next: (settings) => {
          this.systemSettings = settings;
          this.loading = false;
          this.successMessage = 'Settings updated successfully!';
        },
        error: (_err) => {
          this.error = 'Failed to update settings';
          this.loading = false;
        },
      });
    }
  }

  backupDatabase(): void {
    this.loading = true;
    this.clearMessages();

    this.settingsService.backupDatabase().subscribe({
      next: (result: { backupPath: string }) => {
        this.loading = false;
        this.successMessage = `Database backed up to: ${result.backupPath}`;
      },
      error: (_err: Error) => {
        this.error = 'Failed to backup database';
        this.loading = false;
      },
    });
  }

  resetToDefaults(): void {
    if (
      confirm(
        'Are you sure you want to reset all settings to defaults? This action cannot be undone.'
      )
    ) {
      this.loading = true;
      this.clearMessages();

      this.settingsService.resetToDefaults().subscribe({
        next: (result: { message: string }) => {
          this.loading = false;
          this.successMessage = result.message;
          this.loadSystemSettings();
        },
        error: (_err: Error) => {
          this.error = 'Failed to reset settings';
          this.loading = false;
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
      this.loading = true;
      this.clearMessages();

      this.settingsService.regenerateApiKey().subscribe({
        next: (result: { apiKey: string }) => {
          const currentSettings = this.systemSettings;
          if (currentSettings) {
            this.systemSettings = { ...currentSettings, apiKey: result.apiKey };
          }
          this.loading = false;
          this.successMessage = 'API key regenerated successfully!';
        },
        error: (_err: Error) => {
          this.error = 'Failed to regenerate API key';
          this.loading = false;
        },
      });
    }
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
