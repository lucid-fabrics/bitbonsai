import { Component, inject, OnInit } from '@angular/core';
import { RouterModule } from '@angular/router';
import { FontAwesomeModule } from '@fortawesome/angular-fontawesome';
import { faCheckCircle } from '@fortawesome/free-solid-svg-icons';
import { PricingApiService, PricingTier } from '../../services/pricing-api.service';
import { ScrollRevealDirective } from '../../shared/directives/scroll-reveal.directive';

interface ViewPricingTier {
  name: string;
  price: number;
  period: string;
  description: string;
  features: string[];
  cta: string;
  popular?: boolean;
  maxNodes: number;
  maxConcurrent: number;
}

@Component({
  selector: 'app-pricing',
  standalone: true,
  imports: [RouterModule, FontAwesomeModule, ScrollRevealDirective],
  template: `
    <div class="pricing">
      <!-- Loading State -->
      @if (loading) {
        <div class="pricing-loader">
          <div class="spinner"></div>
          <p>Loading pricing...</p>
        </div>
      }

      <!-- Error State -->
      @if (error) {
        <div class="pricing-error">
          <h2>Unable to Load Pricing</h2>
          <p>{{ error }}</p>
          <p>Please try again later.</p>
        </div>
      }

      <!-- Content -->
      @if (!loading && !error) {
        <!-- Header -->
        <section class="pricing-header">
        <div class="pricing-header__container">
          <h1 class="pricing-header__title">Simple, Transparent Pricing</h1>
          <p class="pricing-header__subtitle">
            Start free. Scale as you grow. No credit card required.
          </p>
        </div>
      </section>

      <!-- Pricing Tiers -->
      <section class="tiers">
        <div class="tiers__container">
          <div class="tiers__grid">
            @for (tier of tiers; track tier.name; let i = $index) {
              <div class="tier-card" [class.tier-card--popular]="tier.popular" appScrollReveal [delay]="i * 100" animation="fade-in-up">
                @if (tier.popular) {
                  <div class="tier-card__badge">Most Popular</div>
                }

                <div class="tier-card__header">
                  <h3 class="tier-card__name">{{ tier.name }}</h3>
                  <div class="tier-card__price">
                    <span class="tier-card__currency">$</span>
                    <span class="tier-card__amount">{{ tier.price }}</span>
                    <span class="tier-card__period">/{{ tier.period }}</span>
                  </div>
                  <p class="tier-card__description">{{ tier.description }}</p>
                </div>

                <ul class="tier-card__features">
                  @for (feature of tier.features; track feature) {
                    <li>
                      <fa-icon [icon]="faCheckCircle" class="tier-card__check"></fa-icon>
                      {{ feature }}
                    </li>
                  }
                </ul>

                <a [href]="tier.cta" class="tier-card__button" [class.tier-card__button--primary]="tier.popular">
                  Get Started
                </a>
              </div>
            }
          </div>
        </div>
      </section>

      <!-- FAQ -->
      <section class="faq">
        <div class="faq__container">
          <h2 class="faq__title">Frequently Asked Questions</h2>

          <div class="faq__grid">
            @for (item of faqs; track item.question; let i = $index) {
              <div class="faq-item" appScrollReveal [delay]="i * 80" animation="fade-in-up">
                <h3 class="faq-item__question">{{ item.question }}</h3>
                <p class="faq-item__answer">{{ item.answer }}</p>
              </div>
            }
          </div>
        </div>
      </section>

      <!-- CTA -->
      <section class="pricing-cta">
        <div class="pricing-cta__container">
          <h2 class="pricing-cta__title">Ready to Get Started?</h2>
          <p class="pricing-cta__subtitle">Try BitBonsai free. No credit card required.</p>
          <a routerLink="/download" class="pricing-cta__button">Download Now</a>
        </div>
      </section>
      }
    </div>
  `,
  styleUrls: ['./pricing.component.scss'],
})
export class PricingComponent implements OnInit {
  private readonly pricingApi = inject(PricingApiService);

  // Icons
  faCheckCircle = faCheckCircle;

  // State
  loading = true;
  error: string | null = null;
  tiers: ViewPricingTier[] = [];

  ngOnInit(): void {
    this.pricingApi.getActiveTiers().subscribe({
      next: (apiTiers) => {
        if (!apiTiers || apiTiers.length === 0) {
          this.tiers = this.getFallbackTiers();
        } else {
          this.tiers = apiTiers.map((tier) => this.mapTierToView(tier));
        }
        this.loading = false;
      },
      error: () => {
        // Use fallback tiers instead of showing error
        this.tiers = this.getFallbackTiers();
        this.loading = false;
      },
    });
  }

  private mapTierToView(tier: PricingTier): ViewPricingTier {
    // Validate required fields
    if (!tier.name || !tier.displayName || tier.maxNodes == null) {
      throw new Error('Invalid tier data');
    }

    // Convert cents to dollars
    const priceInDollars = Math.max(0, (tier.priceMonthly || 0) / 100);

    // Build features list
    const features = this.buildFeaturesForTier(tier);

    // Determine CTA - use Stripe checkout for paid tiers
    let cta: string;
    if (tier.name === 'FREE') {
      cta = '/download';
    } else if (tier.stripePriceIdMonthly) {
      // Use Stripe checkout with price ID
      cta = `/checkout?tier=${encodeURIComponent(tier.displayName)}&priceId=${tier.stripePriceIdMonthly}&price=${priceInDollars}`;
    } else {
      // Fallback to Patreon if no Stripe price configured
      cta = 'https://patreon.com/bitbonsai';
    }

    // Mark middle tier as popular (Plus)
    const popular = tier.name === 'PLUS';

    return {
      name: tier.displayName,
      price: priceInDollars,
      period: priceInDollars === 0 ? 'forever' : 'month',
      description: tier.description || '',
      features,
      cta,
      popular,
      maxNodes: tier.maxNodes,
      maxConcurrent: tier.maxConcurrentJobs,
    };
  }

  private buildFeaturesForTier(tier: PricingTier): string[] {
    const baseFeatures = [
      `${tier.maxNodes} processing ${tier.maxNodes === 1 ? 'node' : 'nodes'}`,
      `${tier.maxConcurrentJobs} concurrent ${tier.maxConcurrentJobs === 1 ? 'job' : 'jobs'}`,
      'HEVC & AV1 encoding',
      'Hardware acceleration',
    ];

    // Add tier-specific features based on tier name
    const tierSpecificFeatures: { [key: string]: string[] } = {
      FREE: ['Basic support', 'Community Discord'],
      SUPPORTER: [
        'All Free features',
        'Priority bug fixes',
        'Early access to features',
        'Support development',
      ],
      PLUS: [
        'All Supporter features',
        'Advanced analytics',
        'Custom encoding policies',
        'Email support',
      ],
      PRO: [
        'All Plus features',
        'Advanced job routing',
        'Webhook integrations',
        'Priority email support',
      ],
      ULTIMATE: [
        'All Pro features',
        'Unlimited libraries',
        'Custom integrations',
        '1-on-1 support',
      ],
    };

    const additionalFeatures = tierSpecificFeatures[tier.name] || [];
    return [...baseFeatures, ...additionalFeatures];
  }

  private getFallbackTiers(): ViewPricingTier[] {
    return [
      {
        name: 'Free',
        price: 0,
        period: 'forever',
        description: 'Perfect for testing and small libraries',
        maxNodes: 1,
        maxConcurrent: 2,
        features: [
          '1 processing node',
          '2 concurrent jobs',
          'HEVC & AV1 encoding',
          'Hardware acceleration',
          'Basic support',
          'Community Discord',
        ],
        cta: '/download',
      },
      {
        name: 'Supporter',
        price: 3,
        period: 'month',
        description: 'For home users with growing libraries',
        maxNodes: 2,
        maxConcurrent: 3,
        features: [
          '2 processing nodes',
          '3 concurrent jobs',
          'All Free features',
          'Priority bug fixes',
          'Early access to features',
          'Support development',
        ],
        cta: 'https://patreon.com/bitbonsai',
      },
      {
        name: 'Plus',
        price: 5,
        period: 'month',
        description: 'For homelab enthusiasts',
        maxNodes: 3,
        maxConcurrent: 5,
        popular: true,
        features: [
          '3 processing nodes',
          '5 concurrent jobs',
          'All Supporter features',
          'Advanced analytics',
          'Custom encoding policies',
          'Email support',
        ],
        cta: 'https://patreon.com/bitbonsai',
      },
      {
        name: 'Pro',
        price: 10,
        period: 'month',
        description: 'For power users and multi-server setups',
        maxNodes: 5,
        maxConcurrent: 10,
        features: [
          '5 processing nodes',
          '10 concurrent jobs',
          'All Plus features',
          'Advanced job routing',
          'Webhook integrations',
          'Priority email support',
        ],
        cta: 'https://patreon.com/bitbonsai',
      },
      {
        name: 'Ultimate',
        price: 20,
        period: 'month',
        description: 'For data hoarders with massive libraries',
        maxNodes: 10,
        maxConcurrent: 20,
        features: [
          '10 processing nodes',
          '20 concurrent jobs',
          'All Pro features',
          'Unlimited libraries',
          'Custom integrations',
          '1-on-1 support',
        ],
        cta: 'https://patreon.com/bitbonsai',
      },
    ];
  }

  faqs = [
    {
      question: 'What happens if I exceed my node limit?',
      answer:
        "Your existing nodes will continue to work, but you won't be able to register new ones until you upgrade or remove existing nodes.",
    },
    {
      question: 'Can I change tiers at any time?',
      answer:
        'Yes! You can upgrade or downgrade your tier at any time. Changes take effect immediately for upgrades, and at the end of your billing period for downgrades.',
    },
    {
      question: 'Is there a trial period?',
      answer:
        'The Free tier is available forever with no credit card required. You can test all core features before deciding to upgrade.',
    },
    {
      question: 'What if my license expires?',
      answer:
        "Your encoding jobs will continue running, but you'll be limited to Free tier features (1 node, 2 concurrent jobs) until you renew.",
    },
    {
      question: 'Do you offer commercial licenses?',
      answer:
        'Yes! Contact us for custom commercial licensing with dedicated support, SLAs, and unlimited nodes.',
    },
    {
      question: 'What payment methods do you accept?',
      answer:
        'We accept all major credit cards via Patreon. For commercial licenses, we also offer invoicing and annual contracts.',
    },
  ];
}
