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
  faShieldAlt,
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
              Intelligent Multi-Node<br>
              <span class="hero__gradient">Video Encoding</span>
            </h1>

            <p class="hero__subtitle">
              Reduce storage by 40-60% with zero friction. Self-healing, distributed,<br class="desktop-only">
              built for Plex/Jellyfin.
            </p>

            <div class="hero__actions">
              <a routerLink="/download" class="btn btn--primary">
                <fa-icon [icon]="faDownload" class="btn__icon"></fa-icon>
                <span>Start Encoding in 5 Minutes</span>
              </a>
              <a href="https://github.com/lucid-fabrics/bitbonsai" class="btn btn--secondary" target="_blank">
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
              Enterprise-grade features for the self-hosted community
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

      <!-- CTA Section -->
      <section class="cta">
        <div class="cta__container">
          <h2 class="cta__title">Ready to Trim Your Library?</h2>
          <p class="cta__subtitle">
            Start with the free tier. No credit card required.
          </p>
          <div class="cta__actions">
            <a routerLink="/download" class="btn btn--primary btn--large">Get Started</a>
            <a routerLink="/pricing" class="btn btn--secondary btn--large">View Pricing</a>
          </div>
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
    { faIcon: faPlayCircle, value: 'TRUE RESUME™', label: 'Crash at 98%? Resume at 98%' },
    { faIcon: faHdd, value: '40-60%', label: 'Storage Reduction' },
    { faIcon: faRocket, value: 'Multi-Node', label: 'Distributed Encoding' },
    { faIcon: faSync, value: 'Auto-Heal', label: 'Self-Recovers' },
  ];

  // Icons
  faDownload = faDownload;
  faCode = faCode;

  keyFeatures = [
    {
      faIcon: faPlay,
      title: 'TRUE RESUME™',
      description: 'Crash at 98%? Resume at 98%. Not 0%. Progress saved every 10 seconds.',
    },
    {
      faIcon: faShieldAlt,
      title: 'Auto-Healing',
      description: 'Self-recovers from crashes. 4-layer recovery system. Zero manual intervention.',
    },
    {
      faIcon: faBolt,
      title: 'Zero Configuration',
      description: 'Point at your library. We handle the rest. Smart defaults that just work.',
    },
    {
      faIcon: faNetworkWired,
      title: 'Multi-Node Distribution',
      description: 'Turn 2 weeks into 2 days. Scale encoding across unlimited servers.',
    },
    {
      faIcon: faRocket,
      title: 'Hardware Acceleration',
      description: 'NVIDIA NVENC, Intel QSV, AMD VCE, Apple Silicon. Auto-detected.',
    },
    {
      faIcon: faSave,
      title: 'Storage Savings',
      description: 'Same quality. Half the size. 40-60% reduction with HEVC/AV1.',
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
        'BitBonsai saved me 8TB on my Plex library. TRUE RESUME™ is a game changer - I had a job crash at 97% and it picked up exactly where it left off.',
      name: 'Alex Chen',
      title: 'Homelab Enthusiast',
      avatar: 'AC',
    },
    {
      quote:
        'I was using Tdarr before and spent hours configuring plugins. BitBonsai just works out of the box. Multi-node support turned my 3-week encoding job into 4 days.',
      name: 'Sarah Martinez',
      title: 'Self-Hosted Advocate',
      avatar: 'SM',
    },
    {
      quote:
        'The auto-healing is insane. I had a node crash overnight and when I woke up, BitBonsai had already redistributed the work. Zero intervention required.',
      name: 'Mike Thompson',
      title: 'r/homelab Moderator',
      avatar: 'MT',
    },
  ];

  copyDockerCommand() {
    navigator.clipboard.writeText(this.dockerCommand);
    this.copied = true;
    setTimeout(() => (this.copied = false), 2000);
  }
}
