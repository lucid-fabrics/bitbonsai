import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, type OnInit, signal } from '@angular/core';
import {
  FormBuilder,
  type FormControl,
  type FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import type { License } from './models/license.model';
import { LicenseTier } from './models/license.model';
import type { EnvironmentInfo, SystemSettings } from './models/settings.model';
import { LogLevel } from './models/settings.model';
import { LicenseService } from './services/license.service';
import { SettingsService } from './services/settings.service';

type SettingsTab = 'license' | 'environment' | 'system' | 'advanced';

interface LicenseFormControls {
  licenseKey: FormControl<string>;
  email: FormControl<string>;
}

interface SystemSettingsFormControls {
  ffmpegPath: FormControl<string>;
  logLevel: FormControl<string>;
  analyticsEnabled: FormControl<boolean>;
  webhookUrl: FormControl<string>;
}

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
  activeTab = signal<SettingsTab>('license');
  license = signal<License | null>(null);
  environmentInfo = signal<EnvironmentInfo | null>(null);
  systemSettings = signal<SystemSettings | null>(null);
  loading = signal(false);
  error = signal<string | null>(null);
  successMessage = signal<string | null>(null);
  licenseKeyRevealed = signal(false);
  apiKeyRevealed = signal(false);

  // Forms
  licenseForm!: FormGroup<LicenseFormControls>;
  settingsForm!: FormGroup<SystemSettingsFormControls>;

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
    this.loading.set(true);
    this.licenseService.getCurrentLicense().subscribe({
      next: (license) => {
        this.license.set(license);
        this.loading.set(false);
      },
      error: (_err) => {
        this.error.set('Failed to load license information');
        this.loading.set(false);
      },
    });
  }

  private loadEnvironmentInfo(): void {
    this.settingsService.getEnvironmentInfo().subscribe({
      next: (info) => {
        this.environmentInfo.set(info);
      },
      error: (err) => {
        console.error('Failed to load environment info:', err);
      },
    });
  }

  private loadSystemSettings(): void {
    this.settingsService.getSystemSettings().subscribe({
      next: (settings) => {
        this.systemSettings.set(settings);
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
    this.activeTab.set(tab);
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
    this.licenseKeyRevealed.set(!this.licenseKeyRevealed());
  }

  toggleApiKeyVisibility(): void {
    this.apiKeyRevealed.set(!this.apiKeyRevealed());
  }

  copyToClipboard(text: string, label: string): void {
    navigator.clipboard.writeText(text).then(() => {
      this.successMessage.set(`${label} copied to clipboard`);
      setTimeout(() => this.successMessage.set(null), 3000);
    });
  }

  activateLicense(): void {
    if (this.licenseForm.valid) {
      this.loading.set(true);
      this.clearMessages();

      this.licenseService.activateLicense(this.licenseForm.value).subscribe({
        next: (license) => {
          this.license.set(license);
          this.loading.set(false);
          this.successMessage.set('License activated successfully!');
          this.licenseForm.reset();
        },
        error: (_err) => {
          this.error.set('Failed to activate license. Please check your key and try again.');
          this.loading.set(false);
        },
      });
    }
  }

  updateSystemSettings(): void {
    if (this.settingsForm.valid) {
      this.loading.set(true);
      this.clearMessages();

      const updates = this.settingsForm.value;
      this.settingsService.updateSystemSettings(updates).subscribe({
        next: (settings) => {
          this.systemSettings.set(settings);
          this.loading.set(false);
          this.successMessage.set('Settings updated successfully!');
        },
        error: (_err) => {
          this.error.set('Failed to update settings');
          this.loading.set(false);
        },
      });
    }
  }

  backupDatabase(): void {
    this.loading.set(true);
    this.clearMessages();

    this.settingsService.backupDatabase().subscribe({
      next: (result: { backupPath: string }) => {
        this.loading.set(false);
        this.successMessage.set(`Database backed up to: ${result.backupPath}`);
      },
      error: (_err: Error) => {
        this.error.set('Failed to backup database');
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

      this.settingsService.resetToDefaults().subscribe({
        next: (result: { message: string }) => {
          this.loading.set(false);
          this.successMessage.set(result.message);
          this.loadSystemSettings();
        },
        error: (_err: Error) => {
          this.error.set('Failed to reset settings');
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

      this.settingsService.regenerateApiKey().subscribe({
        next: (result: { apiKey: string }) => {
          const currentSettings = this.systemSettings();
          if (currentSettings) {
            this.systemSettings.set({ ...currentSettings, apiKey: result.apiKey });
          }
          this.loading.set(false);
          this.successMessage.set('API key regenerated successfully!');
        },
        error: (_err: Error) => {
          this.error.set('Failed to regenerate API key');
          this.loading.set(false);
        },
      });
    }
  }

  private clearMessages(): void {
    this.error.set(null);
    this.successMessage.set(null);
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
