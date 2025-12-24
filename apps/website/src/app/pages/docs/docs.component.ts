import { Component } from '@angular/core';

@Component({
  selector: 'bb-docs',
  standalone: true,
  template: `
    <div class="docs">
      <div class="docs__container">
        <h1>Documentation</h1>
        <p class="docs__subtitle">Everything you need to know about BitBonsai</p>

        <div class="docs__content">
          <section class="docs__section">
            <h2>Getting Started</h2>
            <ul>
              <li><a href="#">Installation Guide</a></li>
              <li><a href="#">Quick Start Tutorial</a></li>
              <li><a href="#">Configuration</a></li>
            </ul>
          </section>

          <section class="docs__section">
            <h2>Features</h2>
            <ul>
              <li><a href="#">Multi-Node Processing</a></li>
              <li><a href="#">Codec Support (HEVC/AV1)</a></li>
              <li><a href="#">Job Queue Management</a></li>
              <li><a href="#">Auto-Discovery</a></li>
            </ul>
          </section>

          <section class="docs__section">
            <h2>Licensing</h2>
            <ul>
              <li><a href="#">License Tiers</a></li>
              <li><a href="#">Activating Your License</a></li>
              <li><a href="#">Multi-Node Licensing</a></li>
            </ul>
          </section>

          <section class="docs__section">
            <h2>API Reference</h2>
            <ul>
              <li><a href="#">REST API</a></li>
              <li><a href="#">WebSocket Events</a></li>
              <li><a href="#">License API</a></li>
            </ul>
          </section>

          <section class="docs__section">
            <h2>Troubleshooting</h2>
            <ul>
              <li><a href="#">Common Issues</a></li>
              <li><a href="#">FFmpeg Errors</a></li>
              <li><a href="#">Performance Tuning</a></li>
            </ul>
          </section>
        </div>
      </div>
    </div>
  `,
  styleUrls: ['./docs.component.scss'],
})
export class DocsComponent {}
