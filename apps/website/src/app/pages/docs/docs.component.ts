import { Component } from '@angular/core';
import { FontAwesomeModule } from '@fortawesome/angular-fontawesome';
import { IconDefinition } from '@fortawesome/fontawesome-svg-core';
import {
  faBolt,
  faBox,
  faKey,
  faNetworkWired,
  faPlug,
  faWrench,
} from '@fortawesome/free-solid-svg-icons';
import { ScrollRevealDirective } from '../../shared/directives/scroll-reveal.directive';

interface DocSection {
  title: string;
  faIcon: IconDefinition;
  items: DocItem[];
}

interface DocItem {
  title: string;
  description: string;
}

@Component({
  selector: 'bb-docs',
  standalone: true,
  imports: [FontAwesomeModule, ScrollRevealDirective],
  template: `
    <div class="docs">
      <!-- Header -->
      <section class="docs-header">
        <div class="docs-header__container">
          <h1 class="docs-header__title">Documentation</h1>
          <p class="docs-header__subtitle">
            Everything you need to know about BitBonsai
          </p>
        </div>
      </section>

      <!-- Content -->
      <section class="docs-content">
        <div class="docs-content__container">
          <!-- Quick Start Card -->
          <div class="quick-start">
            <h2 class="quick-start__title">Quick Start</h2>
            <p class="quick-start__description">
              Get BitBonsai running in under 5 minutes with Docker
            </p>

            <div class="code-block">
              <div class="code-block__header">
                <span class="code-block__label">Docker</span>
                <button class="code-block__copy" (click)="copyDockerCommand()">
                  {{ copied ? 'Copied!' : 'Copy' }}
                </button>
              </div>
              <pre class="code-block__content"><code>{{ dockerCommand }}</code></pre>
            </div>

            <div class="quick-start__steps">
              <div class="step">
                <div class="step__number">1</div>
                <div class="step__content">
                  <h3 class="step__title">Start Container</h3>
                  <p class="step__description">Run the Docker command above to start BitBonsai</p>
                </div>
              </div>
              <div class="step">
                <div class="step__number">2</div>
                <div class="step__content">
                  <h3 class="step__title">Open UI</h3>
                  <p class="step__description">Navigate to http://localhost:4210 in your browser</p>
                </div>
              </div>
              <div class="step">
                <div class="step__number">3</div>
                <div class="step__content">
                  <h3 class="step__title">Add Library</h3>
                  <p class="step__description">Point BitBonsai at your media folder and start encoding</p>
                </div>
              </div>
            </div>
          </div>

          <!-- Documentation Sections -->
          <div class="doc-sections">
            @for (section of docSections; track section.title; let i = $index) {
              <div class="doc-section" bbScrollReveal [delay]="i * 120" animation="fade-in-up">
                <div class="doc-section__header">
                  <fa-icon [icon]="section.faIcon" class="doc-section__icon"></fa-icon>
                  <h2 class="doc-section__title">{{ section.title }}</h2>
                </div>
                <div class="doc-section__items">
                  @for (item of section.items; track item.title) {
                    <div class="doc-item">
                      <h3 class="doc-item__title">{{ item.title }}</h3>
                      <p class="doc-item__description">{{ item.description }}</p>
                    </div>
                  }
                </div>
              </div>
            }
          </div>
        </div>
      </section>
    </div>
  `,
  styleUrls: ['./docs.component.scss'],
})
export class DocsComponent {
  copied = false;
  dockerCommand = `docker run -d --name=bitbonsai \\
  -p 4210:4210 -p 3100:3100 \\
  -v /path/to/media:/media \\
  -v /path/to/config:/config \\
  ghcr.io/bitbonsai/bitbonsai:latest`;

  docSections: DocSection[] = [
    {
      title: 'Installation',
      faIcon: faBox,
      items: [
        {
          title: 'Docker',
          description:
            'Install BitBonsai using Docker with pre-built images from GitHub Container Registry. Supports volume mounts for media and config. Environment variables for database connection, API keys, and hardware acceleration settings. Works on Linux, macOS, and Windows with Docker Desktop.',
        },
        {
          title: 'Unraid',
          description:
            'Install from Community Applications with one-click setup. Pre-configured template includes media paths (/mnt/user/media), config paths (/mnt/user/appdata/bitbonsai), port mappings (4210 for UI, 3100 for API), and automatic GPU passthrough detection. Template auto-updates on container restart.',
        },
        {
          title: 'LXC Container (Proxmox)',
          description:
            'Run BitBonsai in a privileged LXC container for minimal overhead. Create container with Ubuntu 22.04 template, allocate 4GB RAM minimum, mount NFS shares for media access. Install Docker inside LXC, then deploy BitBonsai. GPU passthrough requires privileged container and device mapping.',
        },
      ],
    },
    {
      title: 'Multi-Node Setup',
      faIcon: faNetworkWired,
      items: [
        {
          title: 'Node Types',
          description:
            'MAIN nodes own PostgreSQL database and serve as job coordinator. Can process jobs itself. LINKED nodes are pure workers that connect to MAIN via API. Each node tracks its own load (CPU, jobs) and reports health status every 30 seconds. Node type determined at startup via DATABASE_URL environment variable.',
        },
        {
          title: 'Pairing Process',
          description:
            'On MAIN node: Navigate to Nodes page, click "Add Node", generate 6-digit pairing code (valid 10 minutes). On LINKED node: Enter MAIN node URL and pairing code during setup wizard. Connection verified via API health check. Failed pairing shows specific error (invalid code, expired, network unreachable).',
        },
        {
          title: 'Shared Storage vs File Transfer',
          description:
            'Shared Storage (recommended): Mount same NFS/SMB share on all nodes. Zero file copying, instant access. File Transfer Mode: Copies source file to worker node before encoding, copies output back after. Use when shared storage unavailable. 10GB file = 20GB transfer overhead.',
        },
        {
          title: 'Load Balancing (Distribution v2)',
          description:
            'Jobs routed to node with lowest normalized load score. Score = (activeJobs / maxConcurrent) + (cpuLoad / 100). Nodes with load > threshold marked THROTTLED, receive no new jobs. Health checks every 30s update load metrics. Dead nodes auto-detected after 3 failed health checks (90s), jobs redistributed.',
        },
      ],
    },
    {
      title: 'Features',
      faIcon: faBolt,
      items: [
        {
          title: 'TRUE RESUME™ (Frame-Accurate Resume)',
          description:
            'FFmpeg progress tracked every 10 seconds, saved to database. Crash at 98%? Resume at exact frame (not 0%). Uses `-ss` seek with `-noaccurate_seek` for fast resume. Temp file validated before resume (size check, corruption detection). If temp corrupted, falls back to restart from 0%. Resume saves hours on long encodes.',
        },
        {
          title: 'Auto-Healing (4-Layer Recovery)',
          description:
            'Layer 1: Orphaned Job Recovery (on startup, reset stuck ENCODING jobs to QUEUED). Layer 2: Temp File Detection (10 retries × 2s for NFS mount delays). Layer 3: Health Check Retry (5 retries × 2s before marking CORRUPTED). Layer 4: CORRUPTED Auto-Requeue (hourly cron re-validates, resets to QUEUED if fixable). Zero manual intervention.',
        },
        {
          title: 'Hardware Acceleration (Auto-Detected)',
          description:
            'Detects GPU at startup: NVIDIA (nvenc_h265), Intel (qsv_h265), AMD (hevc_amf), Apple (hevc_videotoolbox). Fallback to software (libx265) if no GPU. Encoding speed: Software 0.5x realtime, NVENC 10-30x realtime. Quality: NVENC CRF 23 ≈ Software CRF 20. GPU priority: NVIDIA > Intel > AMD > Software.',
        },
        {
          title: 'Zero Configuration (Smart Defaults)',
          description:
            'Default policy: Target codec HEVC, CRF 23, preset medium, max resolution 1080p. Auto-skips files already in target codec. Auto-detects audio codec (AAC preferred, copy if compatible). Auto-calculates bitrate based on resolution. Advanced users can override via policy settings, but 90% of users never need to.',
        },
      ],
    },
    {
      title: 'Licensing',
      faIcon: faKey,
      items: [
        {
          title: 'Free Tier',
          description:
            'Forever free with 1 node and 2 concurrent jobs. Perfect for testing and small libraries.',
        },
        {
          title: 'Patreon Tiers',
          description:
            'Unlock more nodes and concurrent jobs at $3, $5, $10, or $20/month. Support development and get priority features.',
        },
        {
          title: 'License Activation',
          description:
            'Enter your license key in Settings → License tab. License validation happens automatically every 24 hours.',
        },
        {
          title: 'Node Limits',
          description:
            "Existing nodes continue working if you exceed limits. You just can't add new nodes until you upgrade or remove existing ones.",
        },
      ],
    },
    {
      title: 'Integrations',
      faIcon: faPlug,
      items: [
        {
          title: 'Jellyfin / Plex',
          description:
            'Automatically scan libraries from Jellyfin or Plex. BitBonsai detects media files and queues them for encoding.',
        },
        {
          title: 'qBittorrent',
          description:
            'Watch qBittorrent download folder and auto-encode completed downloads. Supports category-based filtering.',
        },
        {
          title: 'Webhooks',
          description:
            'Send notifications on job completion or failure. Supports Discord, Slack, and custom webhook endpoints.',
        },
      ],
    },
    {
      title: 'Troubleshooting',
      faIcon: faWrench,
      items: [
        {
          title: 'FFmpeg Errors',
          description:
            'Common FFmpeg errors and solutions. Includes codec compatibility, bitrate issues, and hardware acceleration problems.',
        },
        {
          title: 'Node Connection Issues',
          description:
            'Troubleshoot node connectivity, pairing failures, and database connection errors. Check logs and network configuration.',
        },
        {
          title: 'Performance Tuning',
          description:
            'Optimize encoding speed with hardware acceleration, concurrent job limits, and quality settings.',
        },
        {
          title: 'Stuck Jobs',
          description:
            'Watchdog system detects and recovers stuck jobs automatically. Manual recovery via job actions menu if needed.',
        },
      ],
    },
  ];

  copyDockerCommand() {
    navigator.clipboard.writeText(this.dockerCommand);
    this.copied = true;
    setTimeout(() => (this.copied = false), 2000);
  }
}
