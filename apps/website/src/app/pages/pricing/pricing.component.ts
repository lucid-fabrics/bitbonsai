import { CommonModule } from '@angular/common';
import { Component, inject, OnInit } from '@angular/core';
import { PricingApiService, PricingTier } from '../../services/pricing-api.service';

@Component({
  selector: 'bb-pricing',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="pricing">
      <div class="pricing__container">
        <h1>Simple, Transparent Pricing</h1>
        <p class="pricing__subtitle">Choose the plan that works for you</p>

        @if (loading) {
          <div class="pricing__loading">Loading pricing tiers...</div>
        } @else if (tiers.length > 0) {
          <div class="pricing__grid">
            @for (tier of tiers; track tier.id) {
              <div class="pricing-card">
                <h3>{{ tier.displayName }}</h3>
                <div class="pricing-card__price">
                  <span class="pricing-card__currency">$</span>
                  <span class="pricing-card__amount">{{
                    tier.priceMonthly / 100 | number: '1.0-0'
                  }}</span>
                  <span class="pricing-card__period">/month</span>
                </div>
                <ul class="pricing-card__features">
                  <li>{{ tier.maxNodes }} Processing Node{{ tier.maxNodes > 1 ? 's' : '' }}</li>
                  <li>
                    {{ tier.maxConcurrentJobs }} Concurrent Job{{
                      tier.maxConcurrentJobs > 1 ? 's' : ''
                    }}
                  </li>
                  @if (tier.features && tier.features.length > 0) {
                    @for (feature of tier.features; track feature) {
                      <li>{{ feature }}</li>
                    }
                  }
                </ul>
                <button class="pricing-card__cta">Get Started</button>
              </div>
            }
          </div>
        } @else {
          <div class="pricing__empty">No pricing tiers available</div>
        }
      </div>
    </div>
  `,
  styleUrls: ['./pricing.component.scss'],
})
export class PricingComponent implements OnInit {
  private readonly pricingApi = inject(PricingApiService);

  tiers: PricingTier[] = [];
  loading = true;

  ngOnInit() {
    this.pricingApi.getActiveTiers().subscribe({
      next: (tiers) => {
        this.tiers = tiers.sort((a, b) => a.priceMonthly - b.priceMonthly);
        this.loading = false;
      },
      error: (error) => {
        console.error('Failed to load pricing tiers:', error);
        this.loading = false;
      },
    });
  }
}
