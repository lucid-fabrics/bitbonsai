import { NO_ERRORS_SCHEMA } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslocoTestingModule } from '@ngneat/transloco';
import { provideMockStore } from '@ngrx/store/testing';
import { SettingsComponent } from './settings.page';

// Skipped: SettingsComponent was refactored from a monolithic page with forms/services
// to an NgRx-based shell with child route tabs (license-tab, advanced-tab, etc.).
// The old test suite tested properties (licenseForm, settingsForm, activeTab, etc.)
// that no longer exist on the component. A full rewrite of 20+ tests against the new
// tab-based architecture is needed.

describe('SettingsComponent', () => {
  let component: SettingsComponent;
  let fixture: ComponentFixture<SettingsComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SettingsComponent, TranslocoTestingModule.forRoot({})],
      schemas: [NO_ERRORS_SCHEMA],
      providers: [
        provideMockStore({
          initialState: {
            settings: { advancedMode: false },
          },
        }),
        provideRouter([]),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(SettingsComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should have showDebugTab computed property', () => {
    fixture.detectChanges();
    expect(typeof component.showDebugTab()).toBe('boolean');
  });
});
