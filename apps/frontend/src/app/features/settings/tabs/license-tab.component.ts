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
import { ActivatedRoute } from '@angular/router';
import { TranslocoModule } from '@ngneat/transloco';
import { catchError, forkJoin, of } from 'rxjs';
import {
  getTierBadgeClass,
  getTierDisplayName,
  getTierIcon,
  getTierPrice,
  isUpgrade,
} from '../bos/license.bo';
import type {
  ActivateLicense,
  License,
  LicenseCapabilities,
  LicenseTierInfo,
  StripePlan,
} from '../models/license.model';
import { LicenseTier } from '../models/license.model';
import { LicenseService } from '../services/license.service';

@Component({
  selector: 'app-license-tab',
  standalone: true,
  imports: [FormsModule, ReactiveFormsModule, TranslocoModule],
  template: `
    <div class="tab-panel license-tab">
      <h2>License & Subscription</h2>

      <!-- OAuth Callback Notification -->
      @if (callbackMessage()) {
        <div
          class="callback-notification"
          [class.success]="callbackSuccess()"
          [class.error]="!callbackSuccess()"
        >
          <i
            [class]="
              callbackSuccess()
                ? 'fa fa-check-circle'
                : 'fa fa-exclamation-circle'
            "
          ></i>
          <span>{{ callbackMessage() }}</span>
          <button
            type="button"
            class="btn-dismiss"
            (click)="dismissCallback()"
            aria-label="Dismiss"
          >
            <i class="fa fa-times"></i>
          </button>
        </div>
      }

      @if (loading()) {
        <!-- Loading Skeleton -->
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
            <div class="skeleton-features">
              <div class="skeleton-chip"></div>
              <div class="skeleton-chip"></div>
              <div class="skeleton-chip"></div>
              <div class="skeleton-chip"></div>
            </div>
          </div>
          <div class="skeleton-section"></div>
          <div class="skeleton-section"></div>
        </div>
      } @else {
        <!-- Current License Card -->
        <div
          class="license-card"
          [class]="'tier-' + (capabilities()?.tier?.toLowerCase() || 'free')"
        >
          <div class="license-header">
            <div class="tier-info">
              <i
                [class]="
                  getTierIcon(
                    capabilities()?.tier || LicenseTier.FREE
                  )
                "
              ></i>
              <div>
                <span
                  [class]="
                    getTierBadgeClass(
                      capabilities()?.tier || LicenseTier.FREE
                    )
                  "
                >
                  {{
                    getTierDisplayName(
                      capabilities()?.tier || LicenseTier.FREE
                    )
                  }}
                </span>
                <span class="price-tag">{{
                  getTierPrice(
                    capabilities()?.tier || LicenseTier.FREE
                  )
                }}</span>
              </div>
            </div>
          </div>

          <!-- Usage Stats -->
          <div class="usage-stats">
            <div class="stat-item">
              <div class="stat-header">
                <span class="stat-label" id="nodes-label">Nodes</span>
                <span class="stat-value"
                  >{{ capabilities()?.currentNodes || 0 }} /
                  {{ capabilities()?.maxNodes || 1 }}</span
                >
              </div>
              <div
                class="progress-bar"
                role="progressbar"
                [attr.aria-valuenow]="capabilities()?.currentNodes || 0"
                [attr.aria-valuemin]="0"
                [attr.aria-valuemax]="capabilities()?.maxNodes || 1"
                aria-labelledby="nodes-label"
              >
                <div
                  class="progress-fill"
                  [class.warning]="getNodeUsagePercent() >= 80"
                  [class.critical]="getNodeUsagePercent() >= 100"
                  [style.width.%]="getNodeUsagePercent()"
                ></div>
              </div>
            </div>
            <div class="stat-item">
              <div class="stat-header">
                <span class="stat-label" id="jobs-label">Concurrent Jobs</span>
                <span class="stat-value"
                  >{{ capabilities()?.currentConcurrentJobs || 0 }} /
                  {{ capabilities()?.maxConcurrentJobs || 2 }}</span
                >
              </div>
              <div
                class="progress-bar"
                role="progressbar"
                [attr.aria-valuenow]="
                  capabilities()?.currentConcurrentJobs || 0
                "
                [attr.aria-valuemin]="0"
                [attr.aria-valuemax]="capabilities()?.maxConcurrentJobs || 2"
                aria-labelledby="jobs-label"
              >
                <div
                  class="progress-fill"
                  [class.warning]="getJobUsagePercent() >= 80"
                  [class.critical]="getJobUsagePercent() >= 100"
                  [style.width.%]="getJobUsagePercent()"
                ></div>
              </div>
            </div>
          </div>

          <!-- Upgrade Recommendation -->
          @if (capabilities()?.shouldUpgrade) {
            <div class="upgrade-banner">
              <i class="fa fa-arrow-circle-up"></i>
              <span>{{ capabilities()?.reason }}</span>
              <button
                type="button"
                class="btn-upgrade-small"
                (click)="scrollToTiers()"
              >
                Upgrade Now
              </button>
            </div>
          }

          <!-- Features Grid -->
          <div class="features-grid">
            @for (feature of license()?.features || []; track feature.name) {
              <div
                class="feature-chip"
                [class.enabled]="feature.enabled"
                [class.disabled]="!feature.enabled"
              >
                <i [class]="feature.enabled ? 'fa fa-check' : 'fa fa-lock'"></i>
                <span>{{ feature.name }}</span>
              </div>
            }
          </div>
        </div>

        <!-- Stripe Success - Email Lookup Section -->
        @if (showStripeLookup()) {
          <section class="support-section stripe-lookup-section">
            <div class="section-header">
              <i
                class="fa fa-check-circle"
                style="color: var(--success-color)"
              ></i>
              <h3>Payment Successful!</h3>
            </div>
            <p class="section-desc">
              Enter your email to retrieve your license key.
            </p>
            <form (ngSubmit)="lookupLicenseByEmail()" class="email-form">
              <input
                type="email"
                class="form-control"
                [(ngModel)]="lookupEmail"
                name="lookupEmail"
                placeholder="your@email.com"
                required
                email
                #lookupEmailInput="ngModel"
                [class.invalid]="
                  lookupEmailInput.invalid && lookupEmailInput.touched
                "
              />
              <div class="email-actions">
                <button
                  type="button"
                  class="btn-cancel"
                  (click)="dismissStripeLookup()"
                >
                  Skip
                </button>
                <button
                  type="submit"
                  class="btn-primary"
                  [disabled]="lookupEmailInput.invalid || lookupLoading()"
                >
                  {{ lookupLoading() ? 'Looking up...' : 'Find My License' }}
                </button>
              </div>
            </form>
            @if (lookupResult()) {
              <div
                class="lookup-result"
                [class.success]="lookupResult()?.found"
                [class.error]="!lookupResult()?.found"
              >
                @if (lookupResult()?.found) {
                  <p><strong>License found!</strong></p>
                  <p>Tier: {{ lookupResult()?.license?.tier }}</p>
                  <p>Key: {{ lookupResult()?.license?.maskedKey }}</p>
                  <p class="lookup-hint">
                    Check your email for the full license key, then activate
                    below.
                  </p>
                } @else {
                  <p>
                    No license found for this email. Please check your email or
                    contact support.
                  </p>
                }
              </div>
            }
          </section>
        }

        <!-- Commercial Plans Section -->
        @if (stripeConfigured()) {
          <section class="support-section" id="commercial-section">
            <div class="section-header">
              <i class="fa fa-building"></i>
              <h3>Commercial Licenses</h3>
            </div>
            <p class="section-desc">
              For businesses and power users requiring higher limits and
              priority support.
            </p>

            <!-- Email Input for Checkout (shown when no license email) -->
            @if (showEmailInput()) {
              <div class="email-input-card">
                <p>Enter your email to proceed with checkout:</p>
                <form (ngSubmit)="confirmCheckout()" class="email-form">
                  <input
                    type="email"
                    class="form-control"
                    [(ngModel)]="checkoutEmail"
                    name="checkoutEmail"
                    placeholder="your@email.com"
                    required
                    email
                    #emailInput="ngModel"
                    [class.invalid]="emailInput.invalid && emailInput.touched"
                  />
                  <div class="email-actions">
                    <button
                      type="button"
                      class="btn-cancel"
                      (click)="cancelCheckout()"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      class="btn-primary"
                      [disabled]="emailInput.invalid"
                    >
                      Continue to Checkout
                    </button>
                  </div>
                </form>
              </div>
            }

            <div class="commercial-tiers">
              @for (tier of commercialTiers; track tier.id) {
                <div
                  class="tier-card commercial"
                  [class.current]="capabilities()?.tier === tier.id"
                  [class.recommended]="tier.badge === 'Popular'"
                >
                  @if (tier.badge) {
                    <span class="tier-badge-label">{{ tier.badge }}</span>
                  }
                  <div class="tier-card-header">
                    <span class="tier-name">{{ tier.name }}</span>
                    <span class="tier-price">
                      @if (tier.price === 0) {
                        Contact Us
                      } @else {
                        {{ '$' + tier.price }}<span class="period">/mo</span>
                      }
                    </span>
                  </div>
                  <ul class="tier-features">
                    <li>
                      {{ tier.maxNodes === 999 ? 'Unlimited' : tier.maxNodes }}
                      nodes
                    </li>
                    <li>
                      {{
                        tier.maxConcurrentJobs === 999
                          ? 'Unlimited'
                          : tier.maxConcurrentJobs
                      }}
                      concurrent jobs
                    </li>
                    @for (feat of tier.features; track feat) {
                      <li>{{ feat }}</li>
                    }
                  </ul>
                  @if (capabilities()?.tier === tier.id) {
                    <span class="current-badge">Current Plan</span>
                  } @else if (tier.price > 0) {
                    <button
                      type="button"
                      class="btn-subscribe"
                      (click)="startStripeCheckout(tier)"
                      [disabled]="stripeLoading()"
                    >
                      {{
                        isUpgrade(
                          capabilities()?.tier || LicenseTier.FREE,
                          tier.id
                        )
                          ? 'Upgrade'
                          : 'Subscribe'
                      }}
                    </button>
                  } @else {
                    <a href="mailto:enterprise@bitbonsai.io" class="btn-contact"
                      >Contact Sales</a
                    >
                  }
                </div>
              }
            </div>
          </section>
        }

        <!-- Manual License Activation -->
        <section class="support-section" id="manual-section">
          <div class="section-header">
            <i class="fa fa-key"></i>
            <h3>Activate License Key</h3>
          </div>
          <p class="section-desc">
            Already have a license key? Enter it below to activate.
          </p>
          <form
            [formGroup]="licenseForm"
            (ngSubmit)="activateLicense()"
            class="license-form"
          >
            <div class="form-row">
              <div class="form-group">
                <label for="licenseKey">License Key</label>
                <input
                  id="licenseKey"
                  type="text"
                  class="form-control"
                  formControlName="licenseKey"
                  placeholder="XXX-XXXXXXXXXX"
                  [class.invalid]="
                    licenseKeyControl?.invalid && licenseKeyControl?.touched
                  "
                />
              </div>
              <div class="form-group">
                <label for="email">Email</label>
                <input
                  id="email"
                  type="email"
                  class="form-control"
                  formControlName="email"
                  placeholder="your@email.com"
                  [class.invalid]="
                    emailControl?.invalid && emailControl?.touched
                  "
                />
              </div>
              <button
                type="submit"
                class="btn-primary"
                [disabled]="licenseForm.invalid || activating()"
              >
                <i class="fa fa-key"></i>
                Activate
              </button>
            </div>
            @if (error()) {
              <p class="error-message">{{ error() }}</p>
            }
            @if (successMessage()) {
              <p class="success-message">{{ successMessage() }}</p>
            }
          </form>
        </section>
      }
    </div>
  `,
  styles: [
    `
      .license-tab {
        max-width: 900px;
      }

      /* Callback Notification */
      .callback-notification {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 14px 16px;
        border-radius: 8px;
        margin-bottom: 24px;
        animation: slideIn 0.3s ease-out;
      }

      .callback-notification.success {
        background: rgba(34, 197, 94, 0.1);
        border: 1px solid var(--success-color);
        color: var(--success-color);
      }

      .callback-notification.error {
        background: rgba(239, 68, 68, 0.1);
        border: 1px solid var(--danger-color);
        color: var(--danger-color);
      }

      .callback-notification span {
        flex: 1;
      }

      .btn-dismiss {
        background: transparent;
        border: none;
        color: inherit;
        cursor: pointer;
        padding: 4px 8px;
        opacity: 0.7;
        transition: opacity 0.2s;
      }

      .btn-dismiss:hover {
        opacity: 1;
      }

      @keyframes slideIn {
        from {
          transform: translateY(-10px);
          opacity: 0;
        }
        to {
          transform: translateY(0);
          opacity: 1;
        }
      }

      /* Loading Skeleton */
      .skeleton-container {
        animation: pulse 1.5s ease-in-out infinite;
      }

      .skeleton-card {
        background: var(--surface-card);
        border-radius: 12px;
        padding: 24px;
        margin-bottom: 24px;
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
        margin-bottom: 20px;
      }

      .skeleton-stat {
        height: 60px;
        border-radius: 8px;
        background: var(--surface-hover);
      }

      .skeleton-features {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }

      .skeleton-chip {
        width: 100px;
        height: 32px;
        border-radius: 16px;
        background: var(--surface-hover);
      }

      .skeleton-section {
        height: 200px;
        border-radius: 12px;
        background: var(--surface-card);
        border: 1px solid var(--surface-border);
        margin-bottom: 24px;
      }

      @keyframes pulse {
        0%,
        100% {
          opacity: 1;
        }
        50% {
          opacity: 0.5;
        }
      }

      .license-card {
        background: var(--surface-card);
        border-radius: 12px;
        padding: 24px;
        margin-bottom: 32px;
        border: 1px solid var(--surface-border);
      }

      .license-card.tier-free {
        border-left: 4px solid var(--text-muted);
      }
      .license-card.tier-patreon_supporter,
      .license-card.tier-patreon_plus,
      .license-card.tier-patreon_pro,
      .license-card.tier-patreon_ultimate {
        border-left: 4px solid #f96854;
      }
      .license-card.tier-commercial_starter,
      .license-card.tier-commercial_pro {
        border-left: 4px solid var(--primary-color);
      }
      .license-card.tier-commercial_enterprise {
        border-left: 4px solid #ffd700;
      }

      .license-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 20px;
      }

      .tier-info {
        display: flex;
        align-items: center;
        gap: 12px;
      }

      .tier-info i {
        font-size: 28px;
        color: var(--primary-color);
      }

      .tier-badge {
        display: inline-block;
        padding: 4px 12px;
        border-radius: 20px;
        font-weight: 600;
        font-size: 14px;
      }

      .tier-free {
        background: var(--surface-hover);
        color: var(--text-muted);
      }
      .tier-patreon,
      .tier-patreon-plus,
      .tier-patreon-pro,
      .tier-patreon-ultimate {
        background: #f96854;
        color: white;
      }
      .tier-commercial-starter,
      .tier-commercial-pro {
        background: var(--primary-color);
        color: white;
      }
      .tier-commercial-enterprise {
        background: linear-gradient(135deg, #ffd700, #ffaa00);
        color: #000;
      }

      .price-tag {
        display: block;
        font-size: 12px;
        color: var(--text-muted);
        margin-top: 4px;
      }

      .usage-stats {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 20px;
        margin-bottom: 20px;
      }

      .stat-item {
        background: var(--surface-ground);
        border-radius: 8px;
        padding: 12px;
      }

      .stat-header {
        display: flex;
        justify-content: space-between;
        margin-bottom: 8px;
      }

      .stat-label {
        color: var(--text-muted);
        font-size: 13px;
      }
      .stat-value {
        font-weight: 600;
      }

      .progress-bar {
        height: 8px;
        background: var(--surface-border);
        border-radius: 4px;
        overflow: hidden;
      }

      .progress-fill {
        height: 100%;
        background: var(--primary-color);
        border-radius: 4px;
        transition: width 0.3s ease;
      }

      .progress-fill.warning {
        background: #f59e0b;
      }
      .progress-fill.critical {
        background: #ef4444;
      }

      .upgrade-banner {
        background: linear-gradient(135deg, var(--primary-color), #6366f1);
        color: white;
        padding: 12px 16px;
        border-radius: 8px;
        display: flex;
        align-items: center;
        gap: 12px;
        margin-bottom: 20px;
      }

      .upgrade-banner span {
        flex: 1;
      }

      .btn-upgrade-small {
        background: white;
        color: var(--primary-color);
        border: none;
        padding: 6px 14px;
        border-radius: 6px;
        font-weight: 600;
        cursor: pointer;
      }

      .features-grid {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }

      .feature-chip {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 6px 12px;
        border-radius: 20px;
        font-size: 13px;
        background: var(--surface-ground);
      }

      .feature-chip.enabled {
        color: var(--success-color);
      }
      .feature-chip.disabled {
        color: var(--text-muted);
        opacity: 0.7;
      }

      .support-section {
        background: var(--surface-card);
        border-radius: 12px;
        padding: 24px;
        margin-bottom: 24px;
        border: 1px solid var(--surface-border);
      }

      .section-header {
        display: flex;
        align-items: center;
        gap: 12px;
        margin-bottom: 8px;
      }

      .section-header i {
        font-size: 20px;
        color: var(--primary-color);
      }
      .section-header h3 {
        margin: 0;
        font-size: 18px;
      }

      .section-desc {
        color: var(--text-muted);
        margin-bottom: 20px;
        font-size: 14px;
      }

      /* Email Input Card for Stripe Checkout */
      .email-input-card {
        background: var(--surface-ground);
        border: 2px solid var(--primary-color);
        border-radius: 12px;
        padding: 20px;
        margin-bottom: 20px;
        animation: slideIn 0.2s ease-out;
      }

      .email-input-card p {
        margin: 0 0 12px 0;
        font-weight: 500;
      }

      .email-form {
        display: flex;
        flex-direction: column;
        gap: 12px;
      }

      .email-form .form-control {
        width: 100%;
        padding: 12px;
        border: 1px solid var(--surface-border);
        border-radius: 6px;
        background: var(--surface-card);
        color: var(--text-color);
        font-size: 16px;
      }

      .email-form .form-control.invalid {
        border-color: var(--danger-color);
      }

      .email-actions {
        display: flex;
        gap: 12px;
        justify-content: flex-end;
      }

      .btn-cancel {
        background: transparent;
        border: 1px solid var(--surface-border);
        color: var(--text-muted);
        padding: 10px 20px;
        border-radius: 6px;
        cursor: pointer;
        font-weight: 500;
        transition: all 0.2s;
      }

      .btn-cancel:hover {
        border-color: var(--text-color);
        color: var(--text-color);
      }

      /* Stripe Lookup Section */
      .stripe-lookup-section {
        border: 2px solid var(--success-color);
        background: rgba(34, 197, 94, 0.05);
      }

      .lookup-result {
        margin-top: 16px;
        padding: 12px 16px;
        border-radius: 8px;
      }

      .lookup-result.success {
        background: rgba(34, 197, 94, 0.1);
        border: 1px solid var(--success-color);
      }

      .lookup-result.error {
        background: rgba(239, 68, 68, 0.1);
        border: 1px solid var(--danger-color);
      }

      .lookup-result p {
        margin: 4px 0;
        font-size: 14px;
      }

      .lookup-hint {
        color: var(--text-muted);
        font-style: italic;
        margin-top: 8px !important;
      }

      .commercial-tiers {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
        gap: 16px;
        margin-bottom: 20px;
      }

      .tier-card {
        background: var(--surface-ground);
        border: 2px solid var(--surface-border);
        border-radius: 12px;
        padding: 20px;
        position: relative;
        transition:
          border-color 0.2s,
          transform 0.2s;
      }

      .tier-card:hover {
        border-color: var(--primary-color);
        transform: translateY(-2px);
      }
      .tier-card.current {
        border-color: var(--success-color);
        background: rgba(34, 197, 94, 0.05);
      }
      .tier-card.recommended {
        border-color: var(--primary-color);
      }

      .tier-badge-label {
        position: absolute;
        top: -10px;
        right: 12px;
        background: var(--primary-color);
        color: white;
        font-size: 11px;
        padding: 2px 10px;
        border-radius: 10px;
        font-weight: 600;
      }

      .tier-card-header {
        margin-bottom: 16px;
      }

      .tier-name {
        display: block;
        font-weight: 600;
        font-size: 16px;
        margin-bottom: 4px;
      }

      .tier-price {
        font-size: 24px;
        font-weight: 700;
        color: var(--primary-color);
      }

      .tier-price .period {
        font-size: 14px;
        font-weight: 400;
        color: var(--text-muted);
      }

      .tier-features {
        list-style: none;
        padding: 0;
        margin: 0 0 16px 0;
        font-size: 13px;
      }

      .tier-features li {
        padding: 4px 0;
        color: var(--text-color);
      }

      .tier-features li::before {
        content: '\\2713';
        color: var(--success-color);
        margin-right: 8px;
      }

      .current-badge {
        display: inline-block;
        background: var(--success-color);
        color: white;
        padding: 6px 16px;
        border-radius: 6px;
        font-size: 13px;
        font-weight: 600;
      }

      .btn-patreon {
        background: #f96854;
        color: white;
        border: none;
        padding: 12px 24px;
        border-radius: 8px;
        font-weight: 600;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        gap: 8px;
        transition: background 0.2s;
      }

      .btn-patreon:hover {
        background: #e85a47;
      }
      .btn-patreon:disabled {
        opacity: 0.6;
        cursor: not-allowed;
      }

      .btn-subscribe {
        width: 100%;
        background: var(--primary-color);
        color: white;
        border: none;
        padding: 10px 16px;
        border-radius: 6px;
        font-weight: 600;
        cursor: pointer;
        transition: background 0.2s;
      }

      .btn-subscribe:hover {
        background: var(--primary-color-dark, #5a5fcf);
      }
      .btn-subscribe:disabled {
        opacity: 0.6;
        cursor: not-allowed;
      }

      .btn-contact {
        display: block;
        width: 100%;
        text-align: center;
        padding: 10px 16px;
        border: 2px solid var(--surface-border);
        border-radius: 6px;
        color: var(--text-color);
        text-decoration: none;
        font-weight: 600;
        transition: border-color 0.2s;
      }

      .btn-contact:hover {
        border-color: var(--primary-color);
      }

      .license-form .form-row {
        display: flex;
        gap: 12px;
        align-items: flex-end;
      }

      .license-form .form-group {
        flex: 1;
      }

      .license-form label {
        display: block;
        margin-bottom: 6px;
        font-size: 13px;
        color: var(--text-muted);
      }

      .license-form .form-control {
        width: 100%;
        padding: 10px 12px;
        border: 1px solid var(--surface-border);
        border-radius: 6px;
        background: var(--surface-ground);
        color: var(--text-color);
      }

      .license-form .form-control.invalid {
        border-color: var(--danger-color);
      }

      .license-form .btn-primary {
        padding: 10px 20px;
        white-space: nowrap;
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

      @media (max-width: 768px) {
        .usage-stats {
          grid-template-columns: 1fr;
        }
        .skeleton-stats {
          grid-template-columns: 1fr;
        }
        .license-form .form-row {
          flex-direction: column;
        }
        .email-actions {
          flex-direction: column;
        }
      }
    `,
  ],
})
export class LicenseTabComponent implements OnInit {
  private readonly licenseService = inject(LicenseService);
  private readonly fb = inject(FormBuilder);
  private readonly destroyRef = inject(DestroyRef);
  private readonly route = inject(ActivatedRoute);

  license = signal<License | null>(null);
  capabilities = signal<LicenseCapabilities | null>(null);
  loading = signal(false);
  activating = signal(false);
  stripeLoading = signal(false);
  error = signal<string | null>(null);
  successMessage = signal<string | null>(null);
  stripeConfigured = signal(false);
  stripePlans = signal<Map<LicenseTier, string>>(new Map());

  // OAuth callback handling
  callbackMessage = signal<string | null>(null);
  callbackSuccess = signal(false);

  // Stripe email input for checkout
  showEmailInput = signal(false);
  checkoutEmail = '';
  private pendingCheckoutTier: LicenseTierInfo | null = null;

  // Stripe success - license lookup
  showStripeLookup = signal(false);
  lookupEmail = '';
  lookupLoading = signal(false);
  lookupResult = signal<{
    found: boolean;
    license?: { tier: string; maskedKey: string };
  } | null>(null);

  licenseForm!: FormGroup<{
    licenseKey: FormControl<string | null>;
    email: FormControl<string | null>;
  }>;

  LicenseTier = LicenseTier;

  // Expose functions to template
  getTierBadgeClass = getTierBadgeClass;
  getTierDisplayName = getTierDisplayName;
  getTierIcon = getTierIcon;
  getTierPrice = getTierPrice;
  isUpgrade = isUpgrade;

  commercialTiers: LicenseTierInfo[] = [
    {
      id: LicenseTier.COMMERCIAL_STARTER,
      name: 'Starter',
      price: 49,
      priceUnit: 'month',
      maxNodes: 15,
      maxConcurrentJobs: 30,
      features: ['Priority support', 'SLA guarantee'],
      badge: '',
    },
    {
      id: LicenseTier.COMMERCIAL_PRO,
      name: 'Pro',
      price: 149,
      priceUnit: 'month',
      maxNodes: 50,
      maxConcurrentJobs: 100,
      features: ['Everything in Starter', 'Custom presets', 'Dedicated support'],
      badge: 'Popular',
    },
    {
      id: LicenseTier.COMMERCIAL_ENTERPRISE,
      name: 'Enterprise',
      price: 0,
      priceUnit: 'month',
      maxNodes: 999,
      maxConcurrentJobs: 999,
      features: ['Unlimited everything', 'Custom integrations', 'White-label'],
      badge: '',
    },
  ];

  ngOnInit(): void {
    this.initializeForm();
    this.handleCallbackParams();
    this.loadData();
  }

  private initializeForm(): void {
    this.licenseForm = this.fb.group({
      licenseKey: ['', [Validators.required]],
      email: ['', [Validators.required, Validators.email]],
    });
  }

  private handleCallbackParams(): void {
    this.route.queryParams.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      // Handle Stripe callback
      if (params.stripe) {
        if (params.stripe === 'success') {
          this.callbackSuccess.set(true);
          this.callbackMessage.set(
            'Payment successful! Enter your email below to retrieve your license.'
          );
          // Show the license lookup section
          this.showStripeLookup.set(true);
        } else if (params.stripe === 'cancelled') {
          this.callbackSuccess.set(false);
          this.callbackMessage.set('Checkout was cancelled. No payment was processed.');
        }
      }
    });
  }

  dismissCallback(): void {
    this.callbackMessage.set(null);
    // Clean URL params without reload
    const url = new URL(window.location.href);
    url.searchParams.delete('stripe');
    window.history.replaceState({}, '', url.toString());
  }

  dismissStripeLookup(): void {
    this.showStripeLookup.set(false);
    this.lookupResult.set(null);
    this.lookupEmail = '';
    // Clean URL params
    const url = new URL(window.location.href);
    url.searchParams.delete('stripe');
    window.history.replaceState({}, '', url.toString());
  }

  lookupLicenseByEmail(): void {
    if (!this.lookupEmail) return;

    this.lookupLoading.set(true);
    this.lookupResult.set(null);

    this.licenseService
      .lookupLicense(this.lookupEmail)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          this.lookupResult.set(result);
          this.lookupLoading.set(false);

          // If found, auto-fill the activation form
          if (result.found && result.license) {
            this.licenseForm.patchValue({ email: this.lookupEmail });
          }
        },
        error: () => {
          this.lookupResult.set({ found: false });
          this.lookupLoading.set(false);
        },
      });
  }

  private loadData(): void {
    this.loading.set(true);

    forkJoin({
      license: this.licenseService.getCurrentLicense(),
      capabilities: this.licenseService.getCapabilities(),
      stripePlans: this.licenseService
        .getStripePlans()
        .pipe(catchError(() => of({ configured: false, plans: [] as StripePlan[] }))),
    })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (data) => {
          this.license.set(data.license);
          this.capabilities.set(data.capabilities);
          this.stripeConfigured.set(data.stripePlans.configured);

          const planMap = new Map<LicenseTier, string>();
          for (const plan of data.stripePlans.plans) {
            planMap.set(plan.tier, plan.priceId);
          }
          this.stripePlans.set(planMap);

          this.loading.set(false);
        },
        error: () => {
          this.error.set('Failed to load license information');
          this.loading.set(false);
        },
      });
  }

  getNodeUsagePercent(): number {
    const cap = this.capabilities();
    if (!cap || cap.maxNodes === 0) return 0;
    return Math.min(100, (cap.currentNodes / cap.maxNodes) * 100);
  }

  getJobUsagePercent(): number {
    const cap = this.capabilities();
    if (!cap || cap.maxConcurrentJobs === 0) return 0;
    return Math.min(100, (cap.currentConcurrentJobs / cap.maxConcurrentJobs) * 100);
  }

  scrollToTiers(): void {
    const el = document.getElementById('commercial-section');
    el?.scrollIntoView({ behavior: 'smooth' });
  }

  startStripeCheckout(tier: LicenseTierInfo): void {
    const priceId = this.stripePlans().get(tier.id);
    if (!priceId) {
      this.error.set('This plan is not available. Please contact support.');
      return;
    }

    // If we have an email, proceed directly
    const email = this.license()?.email;
    if (email) {
      this.processCheckout(tier, email, priceId);
    } else {
      // Show inline email input
      this.pendingCheckoutTier = tier;
      this.showEmailInput.set(true);
      this.checkoutEmail = '';
    }
  }

  confirmCheckout(): void {
    if (!this.pendingCheckoutTier || !this.checkoutEmail) return;

    const priceId = this.stripePlans().get(this.pendingCheckoutTier.id);
    if (!priceId) return;

    this.processCheckout(this.pendingCheckoutTier, this.checkoutEmail, priceId);
    this.showEmailInput.set(false);
    this.pendingCheckoutTier = null;
  }

  cancelCheckout(): void {
    this.showEmailInput.set(false);
    this.pendingCheckoutTier = null;
    this.checkoutEmail = '';
  }

  private processCheckout(_tier: LicenseTierInfo, email: string, priceId: string): void {
    this.stripeLoading.set(true);
    this.error.set(null);

    this.licenseService
      .createStripeCheckout(email, priceId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          window.location.href = res.url;
        },
        error: () => {
          this.error.set('Failed to start checkout. Please try again.');
          this.stripeLoading.set(false);
        },
      });
  }

  activateLicense(): void {
    if (this.licenseForm.valid) {
      this.activating.set(true);
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
            this.activating.set(false);
            this.successMessage.set('License activated successfully!');
            this.licenseForm.reset();
            this.loadData();
          },
          error: () => {
            this.error.set('Failed to activate license. Please check your key and try again.');
            this.activating.set(false);
          },
        });
    }
  }

  get licenseKeyControl() {
    return this.licenseForm.get('licenseKey');
  }

  get emailControl() {
    return this.licenseForm.get('email');
  }
}
