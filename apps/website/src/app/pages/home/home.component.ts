import { Component } from '@angular/core';
import { RouterModule } from '@angular/router';

@Component({
  selector: 'bb-home',
  standalone: true,
  imports: [RouterModule],
  template: `
    <div class="home">
      <section class="hero">
        <div class="hero__container">
          <div class="hero__content">
            <h1 class="hero__title">
              Automated Video Transcoding<br />
              <span class="hero__highlight">For Your Entire Library</span>
            </h1>
            <p class="hero__subtitle">
              Convert your video collection to modern codecs (HEVC/AV1) automatically. Save storage
              space without sacrificing quality.
            </p>
            <div class="hero__actions">
              <a routerLink="/download" class="hero__cta hero__cta--primary"> Download Free </a>
              <a routerLink="/pricing" class="hero__cta hero__cta--secondary"> View Pricing </a>
            </div>
          </div>

          <div class="hero__stats">
            <div class="hero__stat">
              <span class="hero__stat-value">50-70%</span>
              <span class="hero__stat-label">Storage Saved</span>
            </div>
            <div class="hero__stat">
              <span class="hero__stat-value">Multi-Node</span>
              <span class="hero__stat-label">Distributed Processing</span>
            </div>
            <div class="hero__stat">
              <span class="hero__stat-value">Open Source</span>
              <span class="hero__stat-label">MIT Licensed</span>
            </div>
          </div>
        </div>
      </section>

      <section class="features">
        <div class="features__container">
          <h2 class="features__title">Everything You Need</h2>

          <div class="features__grid">
            <div class="feature-card">
              <div class="feature-card__icon">⚡</div>
              <h3 class="feature-card__title">Multi-Node Processing</h3>
              <p class="feature-card__description">
                Distribute encoding jobs across multiple machines for faster processing.
              </p>
            </div>

            <div class="feature-card">
              <div class="feature-card__icon">🎬</div>
              <h3 class="feature-card__title">Codec Support</h3>
              <p class="feature-card__description">
                HEVC (x265) and AV1 encoding with intelligent quality presets.
              </p>
            </div>

            <div class="feature-card">
              <div class="feature-card__icon">📊</div>
              <h3 class="feature-card__title">Progress Tracking</h3>
              <p class="feature-card__description">
                Real-time encoding progress with detailed logs and error handling.
              </p>
            </div>

            <div class="feature-card">
              <div class="feature-card__icon">🔄</div>
              <h3 class="feature-card__title">Auto-Discovery</h3>
              <p class="feature-card__description">
                Automatically scans your media library for videos to encode.
              </p>
            </div>

            <div class="feature-card">
              <div class="feature-card__icon">🛡️</div>
              <h3 class="feature-card__title">Safe by Default</h3>
              <p class="feature-card__description">
                Original files preserved until encoding is verified successful.
              </p>
            </div>

            <div class="feature-card">
              <div class="feature-card__icon">🌐</div>
              <h3 class="feature-card__title">Web Dashboard</h3>
              <p class="feature-card__description">
                Modern Angular UI for managing your entire encoding pipeline.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section class="cta-section">
        <div class="cta-section__container">
          <h2>Ready to Save Storage Space?</h2>
          <p>Get started with BitBonsai today. No credit card required.</p>
          <a routerLink="/download" class="cta-section__button"> Download Now </a>
        </div>
      </section>
    </div>
  `,
  styleUrls: ['./home.component.scss'],
})
export class HomeComponent {}
