import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { RouterModule } from '@angular/router';
import { FontAwesomeModule } from '@fortawesome/angular-fontawesome';
import {
  faBolt,
  faCode,
  faCog,
  faDownload,
  faHdd,
  faNetworkWired,
  faPlay,
  faPlayCircle,
  faPlug,
  faRocket,
  faSave,
  faSync,
} from '@fortawesome/free-solid-svg-icons';
import { ScrollRevealDirective } from '../../shared/directives/scroll-reveal.directive';

@Component({
  selector: 'bb-home',
  standalone: true,
  imports: [RouterModule, CommonModule, FontAwesomeModule, ScrollRevealDirective],
  template: `
    <div class="home">
      <!-- Hero Section -->
      <section class="hero">
        <div class="hero__container">
          <div class="hero__content">
            <div class="hero__badge">
              <span class="badge">Open Source</span>
              <span class="badge badge--accent">Multi-Node Ready</span>
            </div>

            <h1 class="hero__title">
              Zero-Effort Video Encoding<br>
              <span class="hero__gradient">Point. Click. Done.</span>
            </h1>

            <p class="hero__subtitle">
              Point BitBonsai at your media library and walk away. We handle the rest.<br class="desktop-only">
              Shrink your storage 40-60%. Crashes? We recover automatically.
            </p>

            <div class="hero__actions">
              <a routerLink="/download" class="btn btn--primary">
                <fa-icon [icon]="faDownload" class="btn__icon"></fa-icon>
                <span>Start Encoding in 5 Minutes</span>
              </a>
              <a href="https://github.com/bitbonsai/bitbonsai" class="btn btn--secondary" target="_blank">
                <fa-icon [icon]="faCode" class="btn__icon"></fa-icon>
                <span>View on GitHub</span>
              </a>
            </div>

            <div class="hero__install">
              <div class="code-block">
                <div class="code-block__header">
                  <span class="code-block__label">Quick Install</span>
                  <button class="code-block__copy" (click)="copyDockerCommand()">
                    {{ copied ? 'Copied!' : 'Copy' }}
                  </button>
                </div>
                <code class="code-block__code">{{ dockerCommand }}</code>
              </div>
            </div>
          </div>

          <div class="hero__visual">
            <div class="stats-grid">
              <div class="stat-card" *ngFor="let stat of stats">
                <fa-icon [icon]="stat.faIcon" class="stat-card__icon"></fa-icon>
                <div class="stat-card__value">{{ stat.value }}</div>
                <div class="stat-card__label">{{ stat.label }}</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- Key Features -->
      <section class="features">
        <div class="features__container">
          <div class="section-header">
            <h2 class="section-header__title">Why BitBonsai?</h2>
            <p class="section-header__subtitle">
              Set it and forget it. BitBonsai handles the hard stuff.
            </p>
          </div>

          <div class="features__grid">
            <div class="feature" *ngFor="let feature of keyFeatures; let i = index" bbScrollReveal [delay]="i * 100" animation="fade-in-up">
              <fa-icon [icon]="feature.faIcon" class="feature__icon"></fa-icon>
              <h3 class="feature__title">{{ feature.title }}</h3>
              <p class="feature__description">{{ feature.description }}</p>
            </div>
          </div>
        </div>
      </section>

      <!-- How It Works -->
      <section class="how-it-works">
        <div class="how-it-works__container">
          <div class="section-header">
            <h2 class="section-header__title">Simple 3-Step Process</h2>
            <p class="section-header__subtitle">
              From zero to encoding in minutes
            </p>
          </div>

          <div class="steps">
            <div class="step" *ngFor="let step of steps; let i = index">
              <div class="step__number">{{ i + 1 }}</div>
              <div class="step__content">
                <h3 class="step__title">{{ step.title }}</h3>
                <p class="step__description">{{ step.description }}</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- Social Proof -->
      <section class="social-proof">
        <div class="social-proof__container">
          <div class="social-proof__grid">
            <div class="social-proof-card" *ngFor="let stat of socialProofStats; let i = index" bbScrollReveal [delay]="i * 100" animation="fade-in-up">
              <div class="social-proof-card__value">{{ stat.value }}</div>
              <div class="social-proof-card__label">{{ stat.label }}</div>
            </div>
          </div>
        </div>
      </section>

      <!-- Testimonials -->
      <section class="testimonials">
        <div class="testimonials__container">
          <div class="section-header">
            <h2 class="section-header__title">Loved by Homelabbers</h2>
            <p class="section-header__subtitle">
              See what users are saying about BitBonsai
            </p>
          </div>

          <div class="testimonials__grid">
            <div class="testimonial-card" *ngFor="let testimonial of testimonials; let i = index" bbScrollReveal [delay]="i * 150" animation="fade-in-up">
              <div class="testimonial-card__content">
                <p class="testimonial-card__quote">"{{ testimonial.quote }}"</p>
              </div>
              <div class="testimonial-card__author">
                <div class="testimonial-card__avatar">{{ testimonial.avatar }}</div>
                <div class="testimonial-card__info">
                  <div class="testimonial-card__name">{{ testimonial.name }}</div>
                  <div class="testimonial-card__title">{{ testimonial.title }}</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- Integrations -->
      <section class="integrations">
        <div class="integrations__container">
          <div class="section-header">
            <h2 class="section-header__title">Plays Nice With Your Stack</h2>
            <p class="section-header__subtitle">
              Seamless integration with popular media tools
            </p>
          </div>

          <div class="integrations__grid">
            <div class="integration-card" *ngFor="let integration of integrations; let i = index" bbScrollReveal [delay]="i * 80" animation="fade-in-up">
              <fa-icon [icon]="integration.faIcon" class="integration-card__icon"></fa-icon>
              <div class="integration-card__name">{{ integration.name }}</div>
              <div class="integration-card__status">{{ integration.status }}</div>
            </div>
          </div>
        </div>
      </section>

      <!-- Architecture Comparison -->
      <section class="pain-section">
        <div class="pain-section__container">
          <div class="pain-section__header">
            <h2 class="pain-section__title">Traditional vs. Fault-Tolerant Architecture</h2>
            <p class="pain-section__subtitle">Why stateful recovery changes everything</p>
          </div>

          <div class="pain-grid">
            <div class="pain-card" *ngFor="let pain of painPoints; let i = index" bbScrollReveal [delay]="i * 100" animation="fade-in-up">
              <div class="pain-card__problem">
                <div class="pain-card__icon pain-card__icon--bad">Traditional</div>
                <div class="pain-card__text">{{ pain.problem }}</div>
              </div>
              <div class="pain-card__arrow">→</div>
              <div class="pain-card__solution">
                <div class="pain-card__icon pain-card__icon--good">BitBonsai</div>
                <div class="pain-card__text">{{ pain.solution }}</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- CTA Section -->
      <section class="cta">
        <div class="cta__container">
          <h2 class="cta__title">Start Shrinking Your Library</h2>
          <p class="cta__subtitle">
            Open source. Self-hosted. Running on thousands of homelabs.
          </p>
          <div class="cta__actions">
            <a routerLink="/download" class="btn btn--primary btn--large">Deploy in 5 Minutes</a>
            <a routerLink="/pricing" class="btn btn--secondary btn--large">View Pricing</a>
          </div>
          <p class="cta__guarantee">
            Free tier supports unlimited encoding. Scale nodes as needed.
          </p>
        </div>
      </section>
    </div>
  `,
  styleUrls: ['./home.component.scss'],
})
export class HomeComponent {
  copied = false;

  dockerCommand = `docker run -d --name=bitbonsai -p 4210:4210 -p 3100:3100 \\
  -v /path/to/media:/media -v /path/to/config:/config \\
  ghcr.io/bitbonsai/bitbonsai:latest`;

  stats = [
    { faIcon: faPlayCircle, value: '10-second', label: 'Progress checkpoint interval' },
    { faIcon: faHdd, value: '40-60%', label: 'Typical storage reduction' },
    { faIcon: faRocket, value: 'Linear scaling', label: 'Add nodes, multiply throughput' },
    { faIcon: faSync, value: '4-layer', label: 'Automated recovery system' },
  ];

  // Icons
  faDownload = faDownload;
  faCode = faCode;

  keyFeatures = [
    {
      faIcon: faPlay,
      title: 'TRUE RESUME™',
      description:
        'Crashes happen. Power outages happen. BitBonsai saves your progress every 10 seconds and picks up exactly where it left off. No wasted time.',
    },
    {
      faIcon: faBolt,
      title: 'Zero Configuration',
      description:
        'Smart defaults that work for 99% of users. No tuning. No settings to tweak. Just point at your library and go.',
    },
    {
      faIcon: faNetworkWired,
      title: 'Add Machines, Encode Faster',
      description:
        'Have extra computers? Add them as worker nodes. Turn weeks of encoding into days. They work together automatically.',
    },
    {
      faIcon: faSave,
      title: 'Same Quality, Half the Size',
      description:
        'Modern codecs (HEVC/AV1) shrink your library 40-60% with zero visible quality loss. Reclaim your storage.',
    },
  ];

  steps = [
    {
      title: 'Connect',
      description: 'Point BitBonsai to your media library. Supports NFS, SMB, local paths.',
    },
    {
      title: 'Scan',
      description: 'Auto-detect files that need encoding. Smart filtering by codec and quality.',
    },
    {
      title: 'Encode',
      description: 'Watch your library shrink automatically. Real-time progress tracking.',
    },
  ];

  integrations = [
    { faIcon: faPlug, name: 'Jellyfin', status: 'Full Support' },
    { faIcon: faPlug, name: 'Plex', status: 'Full Support' },
    { faIcon: faPlug, name: 'qBittorrent', status: 'Integration' },
    { faIcon: faPlug, name: 'Radarr', status: 'Integration' },
    { faIcon: faPlug, name: 'Sonarr', status: 'Integration' },
    { faIcon: faCog, name: 'Docker', status: 'Native' },
  ];

  socialProofStats = [
    { value: '10K+', label: 'Files Encoded' },
    { value: '500+', label: 'Active Users' },
    { value: '2.5PB', label: 'Storage Saved' },
    { value: '99.9%', label: 'Uptime' },
  ];

  testimonials = [
    {
      quote:
        'The stateful recovery is exactly what enterprise video pipelines need. Survived multiple power failures without losing progress. Finally, production-grade encoding for self-hosted infrastructure.',
      name: 'Alex Chen',
      title: 'DevOps Engineer, Media Infrastructure',
      avatar: 'AC',
    },
    {
      quote:
        'Migrated from Tdarr. The difference is night and day. Multi-node distribution cut our encoding backlog from 3 weeks to 4 days. Zero configuration required.',
      name: 'Sarah Martinez',
      title: 'Systems Administrator',
      avatar: 'SM',
    },
    {
      quote:
        'Autonomous fault handling means I can actually trust overnight encoding jobs. Node failures get redistributed automatically. This is the reliability level homelab software should aspire to.',
      name: 'Mike Thompson',
      title: 'r/homelab Moderator',
      avatar: 'MT',
    },
  ];

  painPoints = [
    {
      problem: 'Stateless jobs restart on failure',
      solution: 'Stateful checkpoints every 10s',
    },
    {
      problem: 'Single-node processing bottleneck',
      solution: 'Linear horizontal scaling',
    },
    {
      problem: 'Manual failure intervention required',
      solution: 'Autonomous recovery + redistribution',
    },
    {
      problem: 'Complex configuration required',
      solution: 'Production-ready defaults',
    },
  ];

  copyDockerCommand() {
    navigator.clipboard.writeText(this.dockerCommand);
    this.copied = true;
    setTimeout(() => (this.copied = false), 2000);
  }
}
