import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { ReactiveFormsModule } from '@angular/forms';
import { of, throwError } from 'rxjs';
import type { ActivateLicense, License } from './models/license.model';
import { LicenseTier } from './models/license.model';
import type { EnvironmentInfo, SystemSettings } from './models/settings.model';
import { LogLevel } from './models/settings.model';
import { LicenseService } from './services/license.service';
import { SettingsService } from './services/settings.service';
import { SettingsComponent } from './settings.page';

describe('SettingsComponent', () => {
  let component: SettingsComponent;
  let fixture: ComponentFixture<SettingsComponent>;
  let licenseService: jasmine.SpyObj<LicenseService>;
  let settingsService: jasmine.SpyObj<SettingsService>;

  const mockLicense: License = {
    tier: LicenseTier.PATREON,
    licenseKey: 'ABC-1234-5678-9012',
    email: 'test@example.com',
    validUntil: '2025-12-31T23:59:59Z',
    maxNodes: 5,
    usedNodes: 2,
    maxConcurrentJobs: 10,
    features: [
      { name: 'Hardware Acceleration', enabled: true },
      { name: 'Multi-Node Support', enabled: true },
    ],
  };

  const mockEnvironmentInfo: EnvironmentInfo = {
    version: '0.1.0',
    nodeVersion: 'v20.19.9',
    platform: 'linux',
    arch: 'x64',
    ffmpegVersion: '5.1.2',
    databasePath: '/app/data/bitbonsai.db',
  };

  const mockSystemSettings: SystemSettings = {
    ffmpegPath: '/usr/bin/ffmpeg',
    logLevel: 'INFO',
    analyticsEnabled: true,
    webhookUrl: 'https://example.com/webhook',
    apiKey: 'secret-api-key-12345',
  };

  beforeEach(async () => {
    const licenseServiceSpy = jasmine.createSpyObj('LicenseService', [
      'getCurrentLicense',
      'activateLicense',
    ]);
    const settingsServiceSpy = jasmine.createSpyObj('SettingsService', [
      'getEnvironmentInfo',
      'getSystemSettings',
      'updateSystemSettings',
      'backupDatabase',
      'resetToDefaults',
      'regenerateApiKey',
    ]);

    await TestBed.configureTestingModule({
      imports: [SettingsComponent, ReactiveFormsModule],
      providers: [
        { provide: LicenseService, useValue: licenseServiceSpy },
        { provide: SettingsService, useValue: settingsServiceSpy },
      ],
    }).compileComponents();

    licenseService = TestBed.inject(LicenseService) as jasmine.SpyObj<LicenseService>;
    settingsService = TestBed.inject(SettingsService) as jasmine.SpyObj<SettingsService>;

    // Setup default mock returns
    licenseService.getCurrentLicense.and.returnValue(of(mockLicense));
    settingsService.getEnvironmentInfo.and.returnValue(of(mockEnvironmentInfo));
    settingsService.getSystemSettings.and.returnValue(of(mockSystemSettings));

    fixture = TestBed.createComponent(SettingsComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('component initialization', () => {
    it('should initialize forms with correct validators', () => {
      fixture.detectChanges();

      expect(component.licenseForm).toBeDefined();
      expect(component.settingsForm).toBeDefined();

      // License form validators
      const licenseKeyControl = component.licenseForm.get('licenseKey');
      const emailControl = component.licenseForm.get('email');

      expect(licenseKeyControl?.hasError('required')).toBe(true);
      licenseKeyControl?.setValue('invalid-key');
      expect(licenseKeyControl?.hasError('pattern')).toBe(true);
      licenseKeyControl?.setValue('ABC-1234-5678-9012');
      expect(licenseKeyControl?.valid).toBe(true);

      expect(emailControl?.hasError('required')).toBe(true);
      emailControl?.setValue('invalid-email');
      expect(emailControl?.hasError('email')).toBe(true);
      emailControl?.setValue('valid@email.com');
      expect(emailControl?.valid).toBe(true);

      // Settings form validators
      const ffmpegPathControl = component.settingsForm.get('ffmpegPath');
      const webhookUrlControl = component.settingsForm.get('webhookUrl');

      expect(ffmpegPathControl?.hasError('required')).toBe(true);
      ffmpegPathControl?.setValue('invalid-path');
      expect(ffmpegPathControl?.hasError('pattern')).toBe(true);
      ffmpegPathControl?.setValue('/usr/bin/ffmpeg');
      expect(ffmpegPathControl?.valid).toBe(true);

      webhookUrlControl?.setValue('http://insecure.com');
      expect(webhookUrlControl?.hasError('pattern')).toBe(true);
      webhookUrlControl?.setValue('https://secure.com');
      expect(webhookUrlControl?.valid).toBe(true);
    });

    it('should load license, environment, and settings on init', () => {
      fixture.detectChanges();

      expect(licenseService.getCurrentLicense).toHaveBeenCalled();
      expect(settingsService.getEnvironmentInfo).toHaveBeenCalled();
      expect(settingsService.getSystemSettings).toHaveBeenCalled();
      expect(component.license()).toEqual(mockLicense);
      expect(component.environmentInfo()).toEqual(mockEnvironmentInfo);
      expect(component.systemSettings()).toEqual(mockSystemSettings);
    });

    it('should populate settings form with loaded values', () => {
      fixture.detectChanges();

      expect(component.settingsForm.value).toEqual({
        ffmpegPath: mockSystemSettings.ffmpegPath,
        logLevel: mockSystemSettings.logLevel,
        analyticsEnabled: mockSystemSettings.analyticsEnabled,
        webhookUrl: mockSystemSettings.webhookUrl,
      });
    });

    it('should handle license loading error', () => {
      licenseService.getCurrentLicense.and.returnValue(
        throwError(() => new Error('License load failed'))
      );

      fixture.detectChanges();

      expect(component.error()).toBe('Failed to load license information');
      expect(component.loading()).toBe(false);
    });

    it('should handle environment info loading error', () => {
      const consoleErrorSpy = spyOn(console, 'error');
      settingsService.getEnvironmentInfo.and.returnValue(
        throwError(() => new Error('Environment load failed'))
      );

      fixture.detectChanges();

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Failed to load environment info:',
        jasmine.any(Error)
      );
    });

    it('should handle system settings loading error', () => {
      const consoleErrorSpy = spyOn(console, 'error');
      settingsService.getSystemSettings.and.returnValue(
        throwError(() => new Error('Settings load failed'))
      );

      fixture.detectChanges();

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Failed to load system settings:',
        jasmine.any(Error)
      );
    });
  });

  describe('tab navigation', () => {
    it('should set active tab', () => {
      fixture.detectChanges();

      expect(component.activeTab()).toBe('license');

      component.setActiveTab('environment');
      expect(component.activeTab()).toBe('environment');

      component.setActiveTab('system');
      expect(component.activeTab()).toBe('system');

      component.setActiveTab('advanced');
      expect(component.activeTab()).toBe('advanced');
    });

    it('should clear messages when changing tabs', () => {
      fixture.detectChanges();

      component.error.set('Test error');
      component.successMessage.set('Test success');

      component.setActiveTab('environment');

      expect(component.error()).toBeNull();
      expect(component.successMessage()).toBeNull();
    });
  });

  describe('license tier display', () => {
    it('should return correct tier badge class', () => {
      expect(component.getTierBadgeClass(LicenseTier.FREE)).toBe('tier-badge tier-free');
      expect(component.getTierBadgeClass(LicenseTier.PATREON)).toBe('tier-badge tier-patreon');
      expect(component.getTierBadgeClass(LicenseTier.COMMERCIAL_PRO)).toBe(
        'tier-badge tier-commercial'
      );
    });

    it('should return correct tier display name', () => {
      expect(component.getTierDisplayName(LicenseTier.FREE)).toBe('Free');
      expect(component.getTierDisplayName(LicenseTier.PATREON)).toBe('Patreon Supporter');
      expect(component.getTierDisplayName(LicenseTier.COMMERCIAL_PRO)).toBe('Commercial Pro');
    });
  });

  describe('visibility toggles', () => {
    it('should toggle license key visibility', () => {
      fixture.detectChanges();

      expect(component.licenseKeyRevealed()).toBe(false);

      component.toggleLicenseKeyVisibility();
      expect(component.licenseKeyRevealed()).toBe(true);

      component.toggleLicenseKeyVisibility();
      expect(component.licenseKeyRevealed()).toBe(false);
    });

    it('should toggle API key visibility', () => {
      fixture.detectChanges();

      expect(component.apiKeyRevealed()).toBe(false);

      component.toggleApiKeyVisibility();
      expect(component.apiKeyRevealed()).toBe(true);

      component.toggleApiKeyVisibility();
      expect(component.apiKeyRevealed()).toBe(false);
    });
  });

  describe('clipboard operations', () => {
    it('should copy text to clipboard', async () => {
      const clipboardSpy = spyOn(navigator.clipboard, 'writeText').and.returnValue(
        Promise.resolve()
      );

      fixture.detectChanges();

      await component.copyToClipboard('test-value', 'Test Label');

      expect(clipboardSpy).toHaveBeenCalledWith('test-value');
      expect(component.successMessage()).toBe('Test Label copied to clipboard');
    });

    it('should clear success message after 3 seconds', (done) => {
      spyOn(navigator.clipboard, 'writeText').and.returnValue(Promise.resolve());

      fixture.detectChanges();

      component.copyToClipboard('test-value', 'Test Label').then(() => {
        expect(component.successMessage()).toBe('Test Label copied to clipboard');

        setTimeout(() => {
          expect(component.successMessage()).toBeNull();
          done();
        }, 3100);
      });
    });
  });

  describe('license activation', () => {
    it('should activate license successfully', () => {
      const activationRequest: ActivateLicense = {
        licenseKey: 'ABC-1234-5678-9012',
        email: 'test@example.com',
      };

      licenseService.activateLicense.and.returnValue(of(mockLicense));

      fixture.detectChanges();

      component.licenseForm.setValue({
        licenseKey: activationRequest.licenseKey,
        email: activationRequest.email,
      });

      component.activateLicense();

      expect(licenseService.activateLicense).toHaveBeenCalledWith(activationRequest);
      expect(component.license()).toEqual(mockLicense);
      expect(component.successMessage()).toBe('License activated successfully!');
      expect(component.loading()).toBe(false);
      expect(component.licenseForm.value).toEqual({ licenseKey: null, email: null });
    });

    it('should handle license activation failure', () => {
      licenseService.activateLicense.and.returnValue(
        throwError(() => new Error('Activation failed'))
      );

      fixture.detectChanges();

      component.licenseForm.setValue({
        licenseKey: 'ABC-1234-5678-9012',
        email: 'test@example.com',
      });

      component.activateLicense();

      expect(component.error()).toBe(
        'Failed to activate license. Please check your key and try again.'
      );
      expect(component.loading()).toBe(false);
    });

    it('should not activate license if form is invalid', () => {
      fixture.detectChanges();

      component.licenseForm.setValue({
        licenseKey: '',
        email: '',
      });

      component.activateLicense();

      expect(licenseService.activateLicense).not.toHaveBeenCalled();
    });
  });

  describe('system settings update', () => {
    it('should update system settings successfully', () => {
      const updatedSettings = { ...mockSystemSettings, logLevel: 'DEBUG' };
      settingsService.updateSystemSettings.and.returnValue(of(updatedSettings));

      fixture.detectChanges();

      component.settingsForm.patchValue({ logLevel: 'DEBUG' });
      component.updateSystemSettings();

      expect(settingsService.updateSystemSettings).toHaveBeenCalled();
      expect(component.systemSettings()).toEqual(updatedSettings);
      expect(component.successMessage()).toBe('Settings updated successfully!');
      expect(component.loading()).toBe(false);
    });

    it('should handle system settings update failure', () => {
      settingsService.updateSystemSettings.and.returnValue(
        throwError(() => new Error('Update failed'))
      );

      fixture.detectChanges();

      component.updateSystemSettings();

      expect(component.error()).toBe('Failed to update settings');
      expect(component.loading()).toBe(false);
    });

    it('should not update settings if form is invalid', () => {
      fixture.detectChanges();

      component.settingsForm.patchValue({ ffmpegPath: '' });
      component.updateSystemSettings();

      expect(settingsService.updateSystemSettings).not.toHaveBeenCalled();
    });
  });

  describe('database backup', () => {
    it('should backup database successfully', () => {
      settingsService.backupDatabase.and.returnValue(
        of({ backupPath: '/backups/db-2025-10-03.sqlite' })
      );

      fixture.detectChanges();

      component.backupDatabase();

      expect(settingsService.backupDatabase).toHaveBeenCalled();
      expect(component.successMessage()).toBe(
        'Database backed up to: /backups/db-2025-10-03.sqlite'
      );
      expect(component.loading()).toBe(false);
    });

    it('should handle database backup failure', () => {
      settingsService.backupDatabase.and.returnValue(throwError(() => new Error('Backup failed')));

      fixture.detectChanges();

      component.backupDatabase();

      expect(component.error()).toBe('Failed to backup database');
      expect(component.loading()).toBe(false);
    });
  });

  describe('reset to defaults', () => {
    it('should reset to defaults successfully', () => {
      settingsService.resetToDefaults.and.returnValue(
        of({ message: 'Settings reset successfully' })
      );
      settingsService.getSystemSettings.and.returnValue(of(mockSystemSettings));
      spyOn(window, 'confirm').and.returnValue(true);

      fixture.detectChanges();

      component.resetToDefaults();

      expect(settingsService.resetToDefaults).toHaveBeenCalled();
      expect(settingsService.getSystemSettings).toHaveBeenCalledTimes(2); // Initial load + reload after reset
      expect(component.successMessage()).toBe('Settings reset successfully');
      expect(component.loading()).toBe(false);
    });

    it('should handle reset to defaults failure', () => {
      settingsService.resetToDefaults.and.returnValue(throwError(() => new Error('Reset failed')));
      spyOn(window, 'confirm').and.returnValue(true);

      fixture.detectChanges();

      component.resetToDefaults();

      expect(component.error()).toBe('Failed to reset settings');
      expect(component.loading()).toBe(false);
    });

    it('should not reset if user cancels confirmation', () => {
      spyOn(window, 'confirm').and.returnValue(false);

      fixture.detectChanges();

      component.resetToDefaults();

      expect(settingsService.resetToDefaults).not.toHaveBeenCalled();
    });
  });

  describe('API key regeneration', () => {
    it('should regenerate API key successfully', () => {
      settingsService.regenerateApiKey.and.returnValue(of({ apiKey: 'new-api-key-67890' }));
      spyOn(window, 'confirm').and.returnValue(true);

      fixture.detectChanges();

      component.regenerateApiKey();

      expect(settingsService.regenerateApiKey).toHaveBeenCalled();
      expect(component.systemSettings()?.apiKey).toBe('new-api-key-67890');
      expect(component.successMessage()).toBe('API key regenerated successfully!');
      expect(component.loading()).toBe(false);
    });

    it('should handle API key regeneration failure', () => {
      settingsService.regenerateApiKey.and.returnValue(
        throwError(() => new Error('Regeneration failed'))
      );
      spyOn(window, 'confirm').and.returnValue(true);

      fixture.detectChanges();

      component.regenerateApiKey();

      expect(component.error()).toBe('Failed to regenerate API key');
      expect(component.loading()).toBe(false);
    });

    it('should not regenerate if user cancels confirmation', () => {
      spyOn(window, 'confirm').and.returnValue(false);

      fixture.detectChanges();

      component.regenerateApiKey();

      expect(settingsService.regenerateApiKey).not.toHaveBeenCalled();
    });
  });

  describe('form control getters', () => {
    it('should return correct form controls', () => {
      fixture.detectChanges();

      expect(component.licenseKeyControl).toBe(component.licenseForm.get('licenseKey'));
      expect(component.emailControl).toBe(component.licenseForm.get('email'));
      expect(component.ffmpegPathControl).toBe(component.settingsForm.get('ffmpegPath'));
      expect(component.webhookUrlControl).toBe(component.settingsForm.get('webhookUrl'));
    });
  });

  describe('enum exposure', () => {
    it('should expose LicenseTier enum', () => {
      expect(component.LicenseTier).toBe(LicenseTier);
    });

    it('should expose LogLevel enum', () => {
      expect(component.LogLevel).toBe(LogLevel);
    });
  });
});
