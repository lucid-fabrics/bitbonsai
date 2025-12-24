import { Component } from '@angular/core';
import { RouterModule } from '@angular/router';

@Component({
  selector: 'bb-download',
  standalone: true,
  imports: [RouterModule],
  template: `
    <div class="download">
      <div class="download__container">
        <h1>Download BitBonsai</h1>
        <p class="download__subtitle">Get started with automated video transcoding today</p>

        <div class="download__options">
          <div class="download-card">
            <h3>🐳 Docker (Recommended)</h3>
            <p>Run BitBonsai in containers with Docker Compose</p>
            <pre><code>git clone https://github.com/bitbonsai/bitbonsai.git
cd bitbonsai
docker-compose up -d</code></pre>
          </div>

          <div class="download-card">
            <h3>📦 Direct Download</h3>
            <p>Download pre-built releases for your platform</p>
            <a
              href="https://github.com/bitbonsai/bitbonsai/releases"
              target="_blank"
              class="download-card__button"
            >
              View Releases
            </a>
          </div>

          <div class="download-card">
            <h3>🔧 From Source</h3>
            <p>Build BitBonsai from source code</p>
            <pre><code>git clone https://github.com/bitbonsai/bitbonsai.git
cd bitbonsai
npm install
nx build backend
nx build frontend</code></pre>
          </div>
        </div>

        <div class="download__next-steps">
          <h2>Next Steps</h2>
          <ol>
            <li>Install dependencies (FFmpeg, Node.js, PostgreSQL)</li>
            <li>Configure environment variables</li>
            <li>Run database migrations</li>
            <li>Start the application</li>
          </ol>
          <a routerLink="/docs" class="download__docs-link">View Full Documentation →</a>
        </div>
      </div>
    </div>
  `,
  styleUrls: ['./download.component.scss'],
})
export class DownloadComponent {}
