import { CommonModule } from '@angular/common';
import { Component, inject, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { PricingApiService } from '../../services/pricing-api.service';

@Component({
  selector: 'bb-checkout',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="checkout">
      <div class="checkout__container">
        <!-- Loading State -->
        <div *ngIf="loading" class="checkout__loader">
          <div class="spinner"></div>
          <p>Redirecting to payment...</p>
        </div>

        <!-- Error State -->
        <div *ngIf="error" class="checkout__error">
          <h2>Checkout Error</h2>
          <p>{{ error }}</p>
          <button (click)="goBack()" class="checkout__button">Go Back</button>
        </div>

        <!-- Form -->
        <div *ngIf="!loading && !error" class="checkout__content">
          <h1 class="checkout__title">Complete Your Purchase</h1>
          <p class="checkout__subtitle">
            {{ tierName }} - \${{ price }}/{{ period }}
          </p>

          <form (ngSubmit)="onSubmit()" class="checkout__form">
            <div class="checkout__field">
              <label for="email">Email Address</label>
              <input
                type="email"
                id="email"
                name="email"
                [(ngModel)]="email"
                placeholder="your@email.com"
                required
                [disabled]="submitting"
              />
              <small>Your license key will be sent to this email</small>
            </div>

            <button
              type="submit"
              class="checkout__button checkout__button--primary"
              [disabled]="submitting || !email"
            >
              {{ submitting ? 'Processing...' : 'Continue to Payment' }}
            </button>

            <button
              type="button"
              (click)="goBack()"
              class="checkout__button checkout__button--secondary"
              [disabled]="submitting"
            >
              Cancel
            </button>
          </form>

          <div class="checkout__security">
            <p>🔒 Secure payment powered by Stripe</p>
            <p class="checkout__note">
              You'll be redirected to Stripe's secure checkout page
            </p>
          </div>
        </div>
      </div>
    </div>
  `,
  styleUrls: ['./checkout.component.scss'],
})
export class CheckoutComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly pricingApi = inject(PricingApiService);

  // Form data
  email = '';
  priceId = '';
  tierName = '';
  price = 0;
  period = 'month';

  // State
  loading = false;
  submitting = false;
  error: string | null = null;

  ngOnInit() {
    this.priceId = this.route.snapshot.queryParamMap.get('priceId') || '';
    this.tierName = this.route.snapshot.queryParamMap.get('tier') || 'Unknown';
    const priceStr = this.route.snapshot.queryParamMap.get('price');
    this.price = priceStr ? parseFloat(priceStr) : 0;

    if (!this.priceId) {
      this.error = 'Invalid checkout session. Please return to pricing page.';
    }
  }

  async onSubmit() {
    if (!this.email || !this.priceId) {
      return;
    }

    this.submitting = true;
    this.error = null;

    try {
      const result = await this.pricingApi
        .createCheckoutSession({
          email: this.email,
          priceId: this.priceId,
          successUrl: `${window.location.origin}/success?session_id={CHECKOUT_SESSION_ID}`,
          cancelUrl: `${window.location.origin}/pricing`,
        })
        .toPromise();

      if (result?.url) {
        // Redirect to Stripe checkout
        window.location.href = result.url;
      } else {
        throw new Error('No checkout URL returned');
      }
    } catch (err: any) {
      console.error('Checkout failed:', err);
      this.error = err.error?.message || 'Failed to create checkout session. Please try again.';
      this.submitting = false;
    }
  }

  goBack() {
    this.router.navigate(['/pricing']);
  }
}
