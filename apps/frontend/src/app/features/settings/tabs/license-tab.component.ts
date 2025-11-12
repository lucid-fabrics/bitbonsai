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
import { LicenseBo } from '../bos/license.bo';
import type { ActivateLicense, License } from '../models/license.model';
import { LicenseTier } from '../models/license.model';
import { LicenseService } from '../services/license.service';

@Component({
  selector: 'app-license-tab',
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule],
  template: `
    <div class="tab-panel">
      <h2>License Information</h2>

      @if (loading()) {
        <!-- Loading State -->
        <div class="loading-state">
          <div class="spinner"></div>
          <p>Loading license information...</p>
        </div>
      } @else if (license()) {
        <!-- Current License Card -->
        <div class="license-card">
          <div class="license-header">
            <span [class]="LicenseBo.getTierBadgeClass(license()!.tier)">
              {{ LicenseBo.getTierDisplayName(license()!.tier) }}
            </span>
          </div>

          <div class="license-details">
            <div class="detail-row">
              <span class="label">License Key:</span>
              <div class="value-with-action">
                <span class="key-value">
                  {{ licenseKeyRevealed() ? license()!.licenseKey : '****-****-****-****' }}
                </span>
                <button
                  type="button"
                  class="btn-icon"
                  (click)="toggleLicenseKeyVisibility()"
                  [title]="licenseKeyRevealed() ? 'Hide' : 'Reveal'"
                >
                  <i [class]="licenseKeyRevealed() ? 'fa fa-eye-slash' : 'fa fa-eye'"></i>
                </button>
              </div>
            </div>

            <div class="detail-row">
              <span class="label">Email:</span>
              <span class="value">{{ license()!.email }}</span>
            </div>

            <div class="detail-row">
              <span class="label">Valid Until:</span>
              <span class="value">{{ license()!.validUntil }}</span>
            </div>

            <div class="detail-row">
              <span class="label">Nodes:</span>
              <span class="value">{{ license()!.usedNodes }} of {{ license()!.maxNodes }} used</span>
            </div>

            <div class="detail-row">
              <span class="label">Concurrent Jobs:</span>
              <span class="value">{{ license()!.maxConcurrentJobs }} max</span>
            </div>
          </div>

          <!-- Features List -->
          <div class="features-section">
            <h3>Features</h3>
            <div class="features-list">
              @for (feature of license()!.features; track feature.name) {
                <div class="feature-item" [class.disabled]="!feature.enabled">
                  <i [class]="feature.enabled ? 'fa fa-check-circle' : 'fa fa-times-circle'"></i>
                  <span>{{ feature.name }}</span>
                </div>
              }
            </div>
          </div>

          @if (license()!.tier !== LicenseTier.COMMERCIAL_PRO) {
            <button type="button" class="btn-primary btn-upgrade">
              <i class="fa fa-arrow-up"></i>
              Upgrade License
            </button>
          }
        </div>

        <!-- Activate New License -->
        <div class="section-divider"></div>
        <div class="license-activation">
          <h3>Activate License Key</h3>
          <form [formGroup]="licenseForm" (ngSubmit)="activateLicense()">
            <div class="form-group">
              <label for="licenseKey">License Key</label>
              <input
                id="licenseKey"
                type="text"
                class="form-control"
                formControlName="licenseKey"
                placeholder="XXX-XXXX-XXXX-XXXX"
                [class.invalid]="licenseKeyControl?.invalid && licenseKeyControl?.touched"
              />
              @if (licenseKeyControl?.invalid && licenseKeyControl?.touched) {
                <span class="error-message">Invalid license key format</span>
              }
            </div>

            <div class="form-group">
              <label for="email">Email</label>
              <input
                id="email"
                type="email"
                class="form-control"
                formControlName="email"
                placeholder="your@email.com"
                [class.invalid]="emailControl?.invalid && emailControl?.touched"
              />
              @if (emailControl?.invalid && emailControl?.touched) {
                <span class="error-message">Invalid email address</span>
              }
            </div>

            <button
              type="submit"
              class="btn-primary"
              [disabled]="licenseForm.invalid || loading()"
            >
              <i class="fa fa-key"></i>
              Activate License
            </button>
          </form>
        </div>
      } @else {
        <!-- No License Activated -->
        <div class="no-license-state">
          <div class="icon-placeholder">
            <i class="fa fa-key fa-3x"></i>
          </div>
          <h3>No License Activated</h3>
          <p>You're currently using the free tier. Activate a license to unlock additional features.</p>

          <!-- Activate License Form -->
          <div class="license-activation">
            <form [formGroup]="licenseForm" (ngSubmit)="activateLicense()">
              <div class="form-group">
                <label for="licenseKey">License Key</label>
                <input
                  id="licenseKey"
                  type="text"
                  class="form-control"
                  formControlName="licenseKey"
                  placeholder="XXX-XXXX-XXXX-XXXX"
                  [class.invalid]="licenseKeyControl?.invalid && licenseKeyControl?.touched"
                />
                @if (licenseKeyControl?.invalid && licenseKeyControl?.touched) {
                  <span class="error-message">Invalid license key format</span>
                }
              </div>

              <div class="form-group">
                <label for="email">Email</label>
                <input
                  id="email"
                  type="email"
                  class="form-control"
                  formControlName="email"
                  placeholder="your@email.com"
                  [class.invalid]="emailControl?.invalid && emailControl?.touched"
                />
                @if (emailControl?.invalid && emailControl?.touched) {
                  <span class="error-message">Invalid email address</span>
                }
              </div>

              <button
                type="submit"
                class="btn-primary"
                [disabled]="licenseForm.invalid || loading()"
              >
                <i class="fa fa-key"></i>
                Activate License
              </button>
            </form>
          </div>
        </div>
      }
    </div>
  `,
})
export class LicenseTabComponent implements OnInit {
  private readonly licenseService = inject(LicenseService);
  private readonly fb = inject(FormBuilder);
  private readonly destroyRef = inject(DestroyRef);

  license = signal<License | null>(null);
  loading = signal(false);
  error = signal<string | null>(null);
  successMessage = signal<string | null>(null);
  licenseKeyRevealed = signal(false);

  licenseForm!: FormGroup<{
    licenseKey: FormControl<string | null>;
    email: FormControl<string | null>;
  }>;

  LicenseTier = LicenseTier;
  readonly LicenseBo = LicenseBo;

  ngOnInit(): void {
    this.initializeForm();
    this.loadLicense();
  }

  private initializeForm(): void {
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
        error: () => {
          this.error.set('Failed to load license information');
          this.loading.set(false);
        },
      });
  }

  activateLicense(): void {
    if (this.licenseForm.valid) {
      this.loading.set(true);
      this.error.set(null);
      this.successMessage.set(null);

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
            this.successMessage.set('License activated successfully!');
            this.licenseForm.reset();
          },
          error: () => {
            this.error.set('Failed to activate license. Please check your key and try again.');
            this.loading.set(false);
          },
        });
    }
  }

  toggleLicenseKeyVisibility(): void {
    this.licenseKeyRevealed.set(!this.licenseKeyRevealed());
  }

  get licenseKeyControl() {
    return this.licenseForm.get('licenseKey');
  }

  get emailControl() {
    return this.licenseForm.get('email');
  }
}
