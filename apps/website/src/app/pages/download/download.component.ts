import { Component } from '@angular/core';
import { RouterModule } from '@angular/router';
import { FontAwesomeModule } from '@fortawesome/angular-fontawesome';
import { IconDefinition } from '@fortawesome/fontawesome-svg-core';
import { faDiscord, faDocker, faGithub } from '@fortawesome/free-brands-svg-icons';
import {
  faBook,
  faBox,
  faGlobe,
  faLaptop,
  faServer,
  faTools,
  faWrench,
} from '@fortawesome/free-solid-svg-icons';
import { ScrollRevealDirective } from '../../shared/directives/scroll-reveal.directive';

interface Platform {
  name: string;
  faIcon: IconDefinition;
  description: string;
  command: string;
  notes?: string;
}

@Component({
  selector: 'app-download',
  standalone: true,
  imports: [RouterModule, FontAwesomeModule, ScrollRevealDirective],
  template: `
    <div class="download">
      <!-- Header -->
      <section class="download-header">
        <div class="download-header__container">
          <h1 class="download-header__title">Download BitBonsai</h1>
          <p class="download-header__subtitle">
            Get started with intelligent multi-node video encoding in under 5 minutes
          </p>
        </div>
      </section>

      <!-- Platforms -->
      <section class="platforms">
        <div class="platforms__container">
          <h2 class="platforms__title">Choose Your Platform</h2>

          <div class="platforms__grid">
            @for (platform of platforms; track platform.name; let i = $index) {
              <div class="platform-card" appScrollReveal [delay]="i * 100" animation="fade-in-up">
                <fa-icon [icon]="platform.faIcon" class="platform-card__icon"></fa-icon>
                <h3 class="platform-card__name">{{ platform.name }}</h3>
                <p class="platform-card__description">{{ platform.description }}</p>

                <div class="code-block">
                  <div class="code-block__header">
                    <span class="code-block__label">Installation</span>
                    <button class="code-block__copy" (click)="copyCommand(platform.command)">
                      {{ copiedCommand === platform.command ? 'Copied!' : 'Copy' }}
                    </button>
                  </div>
                  <pre class="code-block__content"><code>{{ platform.command }}</code></pre>
                </div>

                @if (platform.notes) {
                  <p class="platform-card__notes">
                    {{ platform.notes }}
                  </p>
                }
              </div>
            }
          </div>
        </div>
      </section>

      <!-- Quick Start -->
      <section class="quick-start">
        <div class="quick-start__container">
          <h2 class="quick-start__title">After Installation</h2>
          <p class="quick-start__description">
            Follow these steps to get BitBonsai up and running
          </p>

          <div class="steps">
            <div class="step">
              <div class="step__number">1</div>
              <div class="step__content">
                <h3 class="step__title">Open the UI</h3>
                <p class="step__description">
                  Navigate to <code>http://localhost:4210</code> in your browser
                </p>
              </div>
            </div>

            <div class="step">
              <div class="step__number">2</div>
              <div class="step__content">
                <h3 class="step__title">Add Your Library</h3>
                <p class="step__description">
                  Point BitBonsai at your media folder and create an encoding policy
                </p>
              </div>
            </div>

            <div class="step">
              <div class="step__number">3</div>
              <div class="step__content">
                <h3 class="step__title">Start Encoding</h3>
                <p class="step__description">
                  Queue jobs and watch BitBonsai automatically reduce your storage by 40-60%
                </p>
              </div>
            </div>
          </div>

          <div class="quick-start__cta">
            <a routerLink="/docs" class="quick-start__button">View Full Documentation</a>
          </div>
        </div>
      </section>

      <!-- System Requirements -->
      <section class="requirements">
        <div class="requirements__container">
          <h2 class="requirements__title">System Requirements</h2>

          <div class="requirements__grid">
            <div class="requirement-card">
              <fa-icon [icon]="faLaptop" class="requirement-card__icon"></fa-icon>
              <h3 class="requirement-card__title">Hardware</h3>
              <ul class="requirement-card__list">
                <li>CPU: 4+ cores recommended</li>
                <li>RAM: 4GB minimum, 8GB+ recommended</li>
                <li>Storage: 10GB for application + temp space</li>
                <li>GPU: Optional (NVIDIA/Intel/AMD for hardware acceleration)</li>
              </ul>
            </div>

            <div class="requirement-card">
              <fa-icon [icon]="faTools" class="requirement-card__icon"></fa-icon>
              <h3 class="requirement-card__title">Software</h3>
              <ul class="requirement-card__list">
                <li>Docker 20.10+ (recommended)</li>
                <li>Node.js 18+ (if running from source)</li>
                <li>PostgreSQL 15+ (auto-installed with Docker)</li>
                <li>FFmpeg 5.0+ (auto-installed with Docker)</li>
              </ul>
            </div>

            <div class="requirement-card">
              <fa-icon [icon]="faGlobe" class="requirement-card__icon"></fa-icon>
              <h3 class="requirement-card__title">Network</h3>
              <ul class="requirement-card__list">
                <li>Port 4210: Frontend UI</li>
                <li>Port 3100: Backend API</li>
                <li>NFS/SMB: For multi-node shared storage (optional)</li>
                <li>Internet: For license validation</li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      <!-- Support -->
      <section class="support">
        <div class="support__container">
          <h2 class="support__title">Need Help?</h2>
          <p class="support__description">
            Join our community for support, updates, and discussions
          </p>

          <div class="support__links">
            <a href="https://github.com/bitbonsai/bitbonsai" target="_blank" class="support__link">
              <fa-icon [icon]="faGithub" class="support__link-icon"></fa-icon>
              <span class="support__link-text">GitHub</span>
            </a>
            <a href="https://discord.gg/bitbonsai" target="_blank" class="support__link">
              <fa-icon [icon]="faDiscord" class="support__link-icon"></fa-icon>
              <span class="support__link-text">Discord</span>
            </a>
            <a routerLink="/docs" class="support__link">
              <fa-icon [icon]="faBook" class="support__link-icon"></fa-icon>
              <span class="support__link-text">Documentation</span>
            </a>
          </div>
        </div>
      </section>
    </div>
  `,
  styleUrls: ['./download.component.scss'],
})
export class DownloadComponent {
  copiedCommand: string | null = null;

  // Icons
  faLaptop = faLaptop;
  faTools = faTools;
  faGlobe = faGlobe;
  faGithub = faGithub;
  faDiscord = faDiscord;
  faBook = faBook;

  platforms: Platform[] = [
    {
      name: 'Docker',
      faIcon: faDocker,
      description: 'Recommended - Works on any platform with Docker installed',
      command: `docker run -d --name=bitbonsai \\
  -p 4210:4210 -p 3100:3100 \\
  -v /path/to/media:/media \\
  -v /path/to/config:/config \\
  ghcr.io/bitbonsai/bitbonsai:latest`,
      notes: 'Replace /path/to/media and /path/to/config with your actual paths',
    },
    {
      name: 'Unraid',
      faIcon: faServer,
      description: 'Install from Community Applications with pre-configured template',
      command: `1. Open Unraid WebUI
2. Go to Apps tab
3. Search for "BitBonsai"
4. Click Install
5. Configure paths and ports`,
      notes: 'Template includes all paths and ports configured automatically',
    },
    {
      name: 'Docker Compose',
      faIcon: faBox,
      description: 'Multi-container setup with PostgreSQL and auto-restart',
      command: `git clone https://github.com/bitbonsai/bitbonsai.git
cd bitbonsai
docker compose up -d`,
      notes: 'Includes PostgreSQL database and automatic container restart',
    },
    {
      name: 'Proxmox LXC',
      faIcon: faWrench,
      description: 'Lightweight container for Proxmox with minimal overhead',
      command: `pct create 300 local:vztmpl/ubuntu-22.04.tar.gz \\
  --hostname bitbonsai --memory 4096 \\
  --net0 name=eth0,bridge=vmbr0,ip=dhcp \\
  --storage local-lvm --rootfs 32
pct start 300
pct enter 300`,
      notes: 'Install Docker inside LXC, then use Docker installation method',
    },
  ];

  copyCommand(command: string) {
    navigator.clipboard.writeText(command);
    this.copiedCommand = command;
    setTimeout(() => {
      this.copiedCommand = null;
    }, 2000);
  }
}
