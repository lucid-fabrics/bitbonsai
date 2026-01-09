import { CommonModule } from '@angular/common';
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
  selector: 'bb-compare',
  standalone: true,
  imports: [CommonModule, RouterModule, FontAwesomeModule, ScrollRevealDirective],
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
            <div class="summary-card summary-card--bitbonsai" bbScrollReveal [delay]="0" animation="slide-in-left">
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

            <div class="summary-card" bbScrollReveal [delay]="100" animation="slide-in-right">
              <fa-icon [icon]="faVideo" class="summary-card__logo"></fa-icon>
              <h3 class="summary-card__name">Tdarr</h3>
              <p class="summary-card__tagline">Plugin-based transcoding</p>
              <ul class="summary-card__highlights">
                <li>Hours of setup</li>
                <li>Restart from 0%</li>
                <li>Manual recovery</li>
                <li>Single-node</li>
                <li>47+ plugins to configure</li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      <!-- Detailed Comparison -->
      <section class="comparison">
        <div class="comparison__container">
          <h2 class="comparison__title">Feature Comparison</h2>

          <div class="comparison-table" *ngFor="let section of comparisonSections; let i = index" bbScrollReveal [delay]="i * 150" animation="fade-in-up">
            <h3 class="comparison-table__section">{{ section.title }}</h3>

            <div class="comparison-table__header">
              <div class="comparison-table__cell comparison-table__cell--feature">Feature</div>
              <div class="comparison-table__cell comparison-table__cell--bitbonsai">BitBonsai</div>
              <div class="comparison-table__cell comparison-table__cell--tdarr">Tdarr</div>
            </div>

            <div
              class="comparison-table__row"
              *ngFor="let row of section.rows"
              [class.comparison-table__row--highlight]="row.highlight"
            >
              <div class="comparison-table__cell comparison-table__cell--feature">{{ row.feature }}</div>
              <div class="comparison-table__cell comparison-table__cell--bitbonsai">
                <ng-container *ngIf="typeof row.bitbonsai === 'boolean'">
                  <span class="check" *ngIf="row.bitbonsai">✓</span>
                  <span class="cross" *ngIf="!row.bitbonsai">✗</span>
                </ng-container>
                <ng-container *ngIf="typeof row.bitbonsai === 'string'">
                  {{ row.bitbonsai }}
                </ng-container>
              </div>
              <div class="comparison-table__cell comparison-table__cell--tdarr">
                <ng-container *ngIf="typeof row.tdarr === 'boolean'">
                  <span class="check" *ngIf="row.tdarr">✓</span>
                  <span class="cross" *ngIf="!row.tdarr">✗</span>
                </ng-container>
                <ng-container *ngIf="typeof row.tdarr === 'string'">
                  {{ row.tdarr }}
                </ng-container>
              </div>
            </div>
          </div>
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
                <li>Plugin-based customization</li>
                <li>Complete control over every setting</li>
                <li>Mature, established project</li>
                <li>Larger community</li>
                <li>Flow-based configuration</li>
              </ul>
              <p class="use-case-card__note">
                Note: Expect hours of configuration and frequent manual intervention
              </p>
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
        { feature: 'Setup Time', bitbonsai: '5 minutes', tdarr: 'Hours', highlight: true },
        {
          feature: 'Default Configuration',
          bitbonsai: 'Works out of box',
          tdarr: '47+ plugins to configure',
          highlight: true,
        },
        { feature: 'Docker Compose', bitbonsai: true, tdarr: true },
        { feature: 'Unraid Template', bitbonsai: true, tdarr: true },
        { feature: 'Manual Tuning Required', bitbonsai: false, tdarr: true },
      ],
    },
    {
      title: 'Crash Recovery',
      rows: [
        {
          feature: 'Resume After Crash',
          bitbonsai: 'TRUE RESUME™ (exact timestamp)',
          tdarr: 'Restart from 0%',
          highlight: true,
        },
        {
          feature: 'Auto-Healing',
          bitbonsai: '4-layer recovery system',
          tdarr: 'Manual retry',
          highlight: true,
        },
        { feature: 'Orphaned Job Recovery', bitbonsai: true, tdarr: false },
        { feature: 'Health Check Retry', bitbonsai: true, tdarr: false },
        {
          feature: 'Stuck Job Detection',
          bitbonsai: 'Automatic watchdog',
          tdarr: 'Manual intervention',
        },
      ],
    },
    {
      title: 'Multi-Node Processing',
      rows: [
        { feature: 'Multi-Node Support', bitbonsai: true, tdarr: false, highlight: true },
        {
          feature: 'Load Balancing',
          bitbonsai: 'Distribution v2 algorithm',
          tdarr: 'N/A',
          highlight: true,
        },
        { feature: 'Node Health Monitoring', bitbonsai: true, tdarr: false },
        { feature: 'Shared Storage', bitbonsai: 'NFS/SMB', tdarr: 'N/A' },
        { feature: 'File Transfer Mode', bitbonsai: true, tdarr: false },
        { feature: 'Node Pairing', bitbonsai: '6-digit code', tdarr: 'N/A' },
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
          tdarr: 'NVIDIA, Intel',
        },
        { feature: 'Concurrent Jobs', bitbonsai: '2-20 (tier-based)', tdarr: 'Unlimited' },
        { feature: 'Quality Presets', bitbonsai: 'Smart defaults', tdarr: 'Manual configuration' },
        { feature: 'Bitrate Control', bitbonsai: 'Auto-optimized', tdarr: 'Manual' },
      ],
    },
    {
      title: 'User Experience',
      rows: [
        {
          feature: 'UI/UX Design',
          bitbonsai: 'Modern, clean',
          tdarr: 'Complex, overwhelming',
          highlight: true,
        },
        { feature: 'Learning Curve', bitbonsai: 'Minimal', tdarr: 'Steep', highlight: true },
        { feature: 'Error Messages', bitbonsai: 'User-friendly', tdarr: 'Technical jargon' },
        { feature: 'Progress Tracking', bitbonsai: 'Real-time', tdarr: 'Periodic updates' },
        { feature: 'Job Queue', bitbonsai: 'Visual grid', tdarr: 'Table view' },
      ],
    },
    {
      title: 'Integrations',
      rows: [
        { feature: 'Jellyfin', bitbonsai: true, tdarr: true },
        { feature: 'Plex', bitbonsai: true, tdarr: true },
        { feature: 'qBittorrent', bitbonsai: true, tdarr: false },
        { feature: 'Webhooks', bitbonsai: true, tdarr: true },
        { feature: 'Discord Notifications', bitbonsai: true, tdarr: true },
      ],
    },
    {
      title: 'Licensing & Support',
      rows: [
        { feature: 'Free Tier', bitbonsai: '1 node, 2 concurrent', tdarr: 'Unlimited' },
        { feature: 'Paid Tiers', bitbonsai: '$3-$20/mo', tdarr: 'Free' },
        { feature: 'Community Support', bitbonsai: 'Discord', tdarr: 'Discord, Reddit' },
        { feature: 'Documentation', bitbonsai: 'Comprehensive', tdarr: 'Community-driven' },
        { feature: 'Active Development', bitbonsai: true, tdarr: true },
      ],
    },
  ];
}
