import { Component } from '@angular/core';
import { RouterModule } from '@angular/router';
import { FontAwesomeModule } from '@fortawesome/angular-fontawesome';
import { faSeedling, faVideo } from '@fortawesome/free-solid-svg-icons';
import { ScrollRevealDirective } from '../../shared/directives/scroll-reveal.directive';

interface ComparisonRow {
  feature: string;
  bitbonsai: string | boolean;
  tdarr: string | boolean;
  highlight?: boolean;
}

interface ComparisonSection {
  title: string;
  rows: ComparisonRow[];
}

@Component({
  selector: 'app-compare',
  standalone: true,
  imports: [RouterModule, FontAwesomeModule, ScrollRevealDirective],
  template: `
    <div class="compare">
      <!-- Header -->
      <section class="compare-header">
        <div class="compare-header__container">
          <h1 class="compare-header__title">BitBonsai vs Tdarr</h1>
          <p class="compare-header__subtitle">
            Why choose BitBonsai for your video encoding needs?
          </p>
        </div>
      </section>

      <!-- Summary -->
      <section class="summary">
        <div class="summary__container">
          <div class="summary__grid">
            <div class="summary-card summary-card--bitbonsai" appScrollReveal [delay]="0" animation="slide-in-left">
              <fa-icon [icon]="faSeedling" class="summary-card__logo"></fa-icon>
              <h3 class="summary-card__name">BitBonsai</h3>
              <p class="summary-card__tagline">Intelligent multi-node encoding</p>
              <ul class="summary-card__highlights">
                <li>5-minute setup</li>
                <li>TRUE RESUME™</li>
                <li>Auto-healing</li>
                <li>Multi-node distribution</li>
                <li>Zero configuration</li>
              </ul>
              <a routerLink="/download" class="summary-card__cta">Get Started</a>
            </div>

            <div class="summary-card" appScrollReveal [delay]="100" animation="slide-in-right">
              <fa-icon [icon]="faVideo" class="summary-card__logo"></fa-icon>
              <h3 class="summary-card__name">Tdarr</h3>
              <p class="summary-card__tagline">Plugin-based transcoding</p>
              <ul class="summary-card__highlights">
                <li>Highly customizable</li>
                <li>Large plugin ecosystem</li>
                <li>Mature community</li>
                <li>Flow-based workflows</li>
                <li>Free forever</li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      <!-- Detailed Comparison -->
      <section class="comparison">
        <div class="comparison__container">
          <h2 class="comparison__title">Feature Comparison</h2>

          @for (section of comparisonSections; track section.title; let i = $index) {
            <div class="comparison-table" appScrollReveal [delay]="i * 150" animation="fade-in-up">
              <h3 class="comparison-table__section">{{ section.title }}</h3>

              <div class="comparison-table__header">
                <div class="comparison-table__cell comparison-table__cell--feature">Feature</div>
                <div class="comparison-table__cell comparison-table__cell--bitbonsai">BitBonsai</div>
                <div class="comparison-table__cell comparison-table__cell--tdarr">Tdarr</div>
              </div>

              @for (row of section.rows; track row.feature) {
                <div
                  class="comparison-table__row"
                  [class.comparison-table__row--highlight]="row.highlight"
                >
                  <div class="comparison-table__cell comparison-table__cell--feature">{{ row.feature }}</div>
                  <div class="comparison-table__cell comparison-table__cell--bitbonsai">
                    @if (typeof(row.bitbonsai) === 'boolean') {
                      @if (row.bitbonsai) {
                        <span class="check">✓</span>
                      } @else {
                        <span class="cross">✗</span>
                      }
                    }
                    @if (typeof(row.bitbonsai) === 'string') {
                      {{ row.bitbonsai }}
                    }
                  </div>
                  <div class="comparison-table__cell comparison-table__cell--tdarr">
                    @if (typeof(row.tdarr) === 'boolean') {
                      @if (row.tdarr) {
                        <span class="check">✓</span>
                      } @else {
                        <span class="cross">✗</span>
                      }
                    }
                    @if (typeof(row.tdarr) === 'string') {
                      {{ row.tdarr }}
                    }
                  </div>
                </div>
              }
            </div>
          }
        </div>
      </section>

      <!-- Use Cases -->
      <section class="use-cases">
        <div class="use-cases__container">
          <h2 class="use-cases__title">When to Use Each</h2>

          <div class="use-cases__grid">
            <div class="use-case-card use-case-card--bitbonsai">
              <h3 class="use-case-card__title">Choose BitBonsai If You Want:</h3>
              <ul class="use-case-card__list">
                <li>Zero-friction setup (5 minutes)</li>
                <li>Multi-node distributed encoding</li>
                <li>Automatic crash recovery</li>
                <li>TRUE RESUME™ (resume at exact timestamp)</li>
                <li>Auto-healing system</li>
                <li>Smart defaults that just work</li>
                <li>Modern, clean UI</li>
                <li>Active development and support</li>
              </ul>
            </div>

            <div class="use-case-card">
              <h3 class="use-case-card__title">Choose Tdarr If You Want:</h3>
              <ul class="use-case-card__list">
                <li>Deep plugin-based customization</li>
                <li>Complete control over every setting</li>
                <li>Mature, established project</li>
                <li>Larger community and ecosystem</li>
                <li>Flow-based visual workflows</li>
                <li>100% free with no feature limits</li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      <!-- CTA -->
      <section class="compare-cta">
        <div class="compare-cta__container">
          <h2 class="compare-cta__title">Ready to Try BitBonsai?</h2>
          <p class="compare-cta__subtitle">
            Start encoding in under 5 minutes. No credit card required.
          </p>
          <div class="compare-cta__buttons">
            <a routerLink="/download" class="compare-cta__button compare-cta__button--primary">
              Download Now
            </a>
            <a routerLink="/docs" class="compare-cta__button">
              View Documentation
            </a>
          </div>
        </div>
      </section>
    </div>
  `,
  styleUrls: ['./compare.component.scss'],
})
export class CompareComponent {
  typeof = (value: unknown) => typeof value;

  // Icons
  faSeedling = faSeedling;
  faVideo = faVideo;

  comparisonSections: ComparisonSection[] = [
    {
      title: 'Setup & Configuration',
      rows: [
        {
          feature: 'Setup Time',
          bitbonsai: '~5 minutes',
          tdarr: 'Varies by complexity',
          highlight: true,
        },
        {
          feature: 'Default Configuration',
          bitbonsai: 'Works out of box',
          tdarr: 'Plugin-based (flexible)',
          highlight: true,
        },
        { feature: 'Docker Compose', bitbonsai: true, tdarr: true },
        { feature: 'Unraid Template', bitbonsai: true, tdarr: true },
        { feature: 'Customization Depth', bitbonsai: 'Moderate', tdarr: 'Extensive' },
      ],
    },
    {
      title: 'Crash Recovery',
      rows: [
        {
          feature: 'Resume After Crash',
          bitbonsai: 'TRUE RESUME™ (exact frame)',
          tdarr: 'Restart from beginning',
          highlight: true,
        },
        {
          feature: 'Auto-Recovery',
          bitbonsai: 'Automatic',
          tdarr: 'Manual',
          highlight: true,
        },
        { feature: 'Orphaned Job Recovery', bitbonsai: true, tdarr: false },
        { feature: 'Health Check Retry', bitbonsai: true, tdarr: false },
        {
          feature: 'Stuck Job Detection',
          bitbonsai: 'Automatic watchdog',
          tdarr: 'Manual',
        },
      ],
    },
    {
      title: 'Multi-Node Processing',
      rows: [
        { feature: 'Distributed Processing', bitbonsai: true, tdarr: true, highlight: true },
        {
          feature: 'Load Balancing',
          bitbonsai: 'Automatic',
          tdarr: 'Manual assignment',
          highlight: true,
        },
        { feature: 'Node Health Monitoring', bitbonsai: true, tdarr: false },
        { feature: 'Shared Storage', bitbonsai: 'NFS/SMB', tdarr: 'NFS/SMB' },
        { feature: 'File Transfer Mode', bitbonsai: true, tdarr: false },
      ],
    },
    {
      title: 'Encoding Features',
      rows: [
        { feature: 'HEVC Encoding', bitbonsai: true, tdarr: true },
        { feature: 'AV1 Encoding', bitbonsai: true, tdarr: true },
        {
          feature: 'Hardware Acceleration',
          bitbonsai: 'NVIDIA, Intel, AMD, Apple',
          tdarr: 'NVIDIA, Intel, AMD',
        },
        { feature: 'Concurrent Jobs', bitbonsai: '2-20 (tier-based)', tdarr: 'Unlimited' },
        { feature: 'Quality Presets', bitbonsai: 'Smart defaults', tdarr: 'Custom via plugins' },
      ],
    },
    {
      title: 'User Experience',
      rows: [
        {
          feature: 'UI Design',
          bitbonsai: 'Modern, minimal',
          tdarr: 'Feature-rich',
          highlight: true,
        },
        { feature: 'Learning Curve', bitbonsai: 'Minimal', tdarr: 'Moderate', highlight: true },
        { feature: 'Progress Tracking', bitbonsai: 'Real-time', tdarr: 'Real-time' },
        { feature: 'Job Queue', bitbonsai: 'Visual grid', tdarr: 'Table view' },
      ],
    },
    {
      title: 'Integrations',
      rows: [
        { feature: 'Jellyfin', bitbonsai: true, tdarr: true },
        { feature: 'Plex', bitbonsai: true, tdarr: true },
        { feature: 'qBittorrent', bitbonsai: true, tdarr: true },
        { feature: 'Webhooks', bitbonsai: true, tdarr: true },
        { feature: 'Discord Notifications', bitbonsai: true, tdarr: true },
      ],
    },
    {
      title: 'Licensing & Support',
      rows: [
        { feature: 'Free Tier', bitbonsai: '1 node, 2 concurrent', tdarr: 'Unlimited' },
        { feature: 'Paid Options', bitbonsai: '$3-$20/mo', tdarr: 'Free (donations welcome)' },
        { feature: 'Community Support', bitbonsai: 'Discord', tdarr: 'Discord, Reddit' },
        { feature: 'Active Development', bitbonsai: true, tdarr: true },
      ],
    },
  ];
}
