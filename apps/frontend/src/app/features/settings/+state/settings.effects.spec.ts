import { provideHttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { provideMockActions } from '@ngrx/effects/testing';
import type { Action } from '@ngrx/store';
import { type Observable, of, throwError } from 'rxjs';
import { LicenseService } from '../services/license.service';
import { SettingsService } from '../services/settings.service';
import { SettingsActions } from './settings.actions';
import { SettingsEffects } from './settings.effects';

describe('SettingsEffects', () => {
  let actions$: Observable<Action>;
  let effects: SettingsEffects;
  let service: jest.Mocked<SettingsService>;
  let licenseService: jest.Mocked<LicenseService>;

  beforeEach(() => {
    const serviceMock = {
      getEnvironmentInfo: jest.fn(),
      getSystemSettings: jest.fn(),
      updateSystemSettings: jest.fn(),
      backupDatabase: jest.fn(),
      resetToDefaults: jest.fn(),
      regenerateApiKey: jest.fn(),
    } as unknown as jest.Mocked<SettingsService>;

    const licenseServiceMock = {
      getCurrentLicense: jest.fn(),
      activateLicense: jest.fn(),
    } as unknown as jest.Mocked<LicenseService>;

    TestBed.configureTestingModule({
      providers: [
        SettingsEffects,
        provideMockActions(() => actions$),
        { provide: SettingsService, useValue: serviceMock },
        { provide: LicenseService, useValue: licenseServiceMock },
        provideHttpClient(),
      ],
    });

    effects = TestBed.inject(SettingsEffects);
    service = TestBed.inject(SettingsService) as jest.Mocked<SettingsService>;
    licenseService = TestBed.inject(LicenseService) as jest.Mocked<LicenseService>;
  });

  it('should be created', () => {
    expect(effects).toBeTruthy();
  });

  describe('load license effect', () => {
    it('should return loadLicenseSuccess action on success', (done) => {
      const mockData = { key: 'test-key', status: 'active', expiresAt: '2025-12-31' } as never;
      licenseService.getCurrentLicense.mockReturnValue(of(mockData));

      actions$ = of(SettingsActions.loadLicense());

      effects.loadLicense$.subscribe((action) => {
        expect(action.type).toBe(SettingsActions.loadLicenseSuccess.type);
        expect(licenseService.getCurrentLicense).toHaveBeenCalled();
        done();
      });
    });

    it('should return loadLicenseFailure action on error', (done) => {
      const error = new Error('Load failed');
      licenseService.getCurrentLicense.mockReturnValue(throwError(() => error));

      actions$ = of(SettingsActions.loadLicense());

      effects.loadLicense$.subscribe((action) => {
        expect(action.type).toBe(SettingsActions.loadLicenseFailure.type);
        done();
      });
    });
  });

  // TODO: Add tests for other effects (create, update, delete)
});
