import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Component, inject, type OnInit, signal } from '@angular/core';
import { DomSanitizer, type SafeHtml } from '@angular/platform-browser';
import DOMPurify from 'dompurify';
import { marked } from 'marked';

@Component({
  selector: 'app-docs-tab',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="tab-panel">
      <h2>Documentation</h2>
      <p class="tab-description">User guides and technical documentation</p>

      <!-- Document Selector -->
      <div class="doc-selector">
        <button
          class="doc-button"
          [class.active]="selectedDoc() === 'rebalancing'"
          (click)="loadDocument('rebalancing')"
        >
          <i class="fa fa-balance-scale"></i>
          Job Rebalancing Guide
        </button>
      </div>

      <!-- Document Content -->
      <div class="info-card doc-content">
        @if (loading()) {
          <div class="loading-state">
            <i class="fa fa-spinner fa-spin"></i>
            Loading documentation...
          </div>
        } @else if (error()) {
          <div class="error-state">
            <i class="fa fa-exclamation-triangle"></i>
            <p>{{ error() }}</p>
          </div>
        } @else {
          <div class="markdown-content" [innerHTML]="renderedContent()"></div>
        }
      </div>
    </div>
  `,
  styles: [
    `
      .doc-selector {
        display: flex;
        gap: 1rem;
        margin-bottom: 2rem;
        flex-wrap: wrap;
      }

      .doc-button {
        padding: 1rem 1.5rem;
        background: var(--card-bg);
        border: 2px solid var(--border-color);
        border-radius: 8px;
        cursor: pointer;
        transition: all 0.2s;
        display: flex;
        align-items: center;
        gap: 0.5rem;
        font-size: 1rem;
        color: var(--text-color);
      }

      .doc-button:hover {
        border-color: var(--primary-color);
        transform: translateY(-2px);
      }

      .doc-button.active {
        border-color: var(--primary-color);
        background: var(--primary-color);
        color: white;
      }

      .doc-button i {
        font-size: 1.2rem;
      }

      .doc-content {
        min-height: 400px;
      }

      .loading-state,
      .error-state {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 1rem;
        padding: 3rem;
        color: var(--text-secondary);
      }

      .error-state {
        color: var(--danger);
        flex-direction: column;
      }

      .loading-state i {
        font-size: 2rem;
      }

      /* Markdown Styling */
      .markdown-content {
        line-height: 2;
        color: var(--text-color);
        max-width: 1000px;
        padding: 2.5rem 3rem;
        font-size: 16px;
      }

      .markdown-content h1 {
        font-size: 2.5rem;
        margin-top: 0;
        margin-bottom: 3rem;
        color: var(--text-color);
        border-bottom: 3px solid var(--primary-color);
        padding-bottom: 1rem;
        font-weight: 700;
        letter-spacing: -0.02em;
      }

      .markdown-content h2 {
        font-size: 2rem;
        margin-top: 4rem;
        margin-bottom: 2rem;
        color: var(--primary-color);
        font-weight: 600;
        display: flex;
        align-items: center;
        gap: 0.75rem;
      }

      .markdown-content h2::before {
        content: '';
        display: inline-block;
        width: 5px;
        height: 2rem;
        background: var(--primary-color);
        border-radius: 3px;
      }

      .markdown-content h3 {
        font-size: 1.5rem;
        margin-top: 3rem;
        margin-bottom: 1.5rem;
        color: var(--text-color);
        font-weight: 600;
        padding-top: 1rem;
      }

      .markdown-content p {
        margin-bottom: 1.75rem;
        color: var(--text-color);
        font-size: 1.05rem;
        line-height: 2;
      }

      .markdown-content ul,
      .markdown-content ol {
        margin-bottom: 2.5rem;
        padding-left: 2.5rem;
        margin-top: 1.5rem;
      }

      .markdown-content li {
        margin-bottom: 1.25rem;
        line-height: 2;
        color: var(--text-color);
        padding-left: 0.5rem;
      }

      .markdown-content li::marker {
        color: var(--primary-color);
      }

      .markdown-content code {
        background: rgba(255, 255, 255, 0.05);
        border: 1px solid var(--border-color);
        padding: 0.25rem 0.5rem;
        border-radius: 4px;
        font-family: 'Courier New', monospace;
        font-size: 0.92em;
        color: #4fc3f7;
      }

      .markdown-content pre {
        background: rgba(0, 0, 0, 0.3);
        border: 1px solid var(--border-color);
        padding: 1.5rem;
        border-radius: 8px;
        overflow-x: auto;
        margin-bottom: 2.5rem;
        margin-top: 1.5rem;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
      }

      .markdown-content pre code {
        background: none;
        border: none;
        padding: 0;
        color: #e0e0e0;
        font-size: 0.95em;
        line-height: 1.8;
      }

      .markdown-content table {
        width: 100%;
        border-collapse: separate;
        border-spacing: 0;
        margin-bottom: 3rem;
        margin-top: 2rem;
        background: var(--card-bg);
        border-radius: 8px;
        overflow: hidden;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
      }

      .markdown-content table th {
        background: linear-gradient(135deg, var(--primary-color) 0%, #1976d2 100%);
        color: white;
        padding: 1.25rem 1.5rem;
        text-align: left;
        font-weight: 600;
        text-transform: uppercase;
        font-size: 0.85rem;
        letter-spacing: 0.05em;
      }

      .markdown-content table td {
        padding: 1.25rem 1.5rem;
        border-bottom: 1px solid var(--border-color);
        vertical-align: top;
        line-height: 1.8;
      }

      .markdown-content table tr:last-child td {
        border-bottom: none;
      }

      .markdown-content table tr:nth-child(even) {
        background: rgba(255, 255, 255, 0.02);
      }

      .markdown-content blockquote {
        border-left: 4px solid var(--primary-color);
        background: rgba(33, 150, 243, 0.05);
        padding: 1.5rem 2rem;
        margin: 2.5rem 0;
        border-radius: 0 8px 8px 0;
        color: var(--text-color);
        font-style: italic;
        line-height: 2;
      }

      .markdown-content strong {
        color: var(--primary-color);
        font-weight: 600;
      }

      .markdown-content hr {
        border: none;
        height: 2px;
        background: linear-gradient(90deg, transparent, var(--border-color), transparent);
        margin: 3rem 0;
      }

      .markdown-content a {
        color: var(--primary-color);
        text-decoration: none;
        border-bottom: 1px solid transparent;
        transition: border-color 0.2s;
      }

      .markdown-content a:hover {
        border-bottom-color: var(--primary-color);
      }
    `,
  ],
})
export class DocsTabComponent implements OnInit {
  private http = inject(HttpClient);
  private sanitizer = inject(DomSanitizer);

  selectedDoc = signal<string>('rebalancing');
  loading = signal<boolean>(false);
  error = signal<string | null>(null);
  renderedContent = signal<SafeHtml>('');

  private docUrls: Record<string, string> = {
    rebalancing: '/api/v1/docs/REBALANCING',
  };

  ngOnInit() {
    this.loadDocument('rebalancing');
  }

  loadDocument(docName: string) {
    this.selectedDoc.set(docName);
    this.loading.set(true);
    this.error.set(null);

    const url = this.docUrls[docName];
    if (!url) {
      this.error.set(`Documentation "${docName}" not found`);
      this.loading.set(false);
      return;
    }

    this.http.get(url, { responseType: 'text' }).subscribe({
      next: (markdown) => {
        try {
          const html = marked(markdown);
          // DEEP AUDIT P1-1: Sanitize HTML with DOMPurify before trusting
          // This prevents XSS attacks from malicious markdown content
          const sanitizedHtml = DOMPurify.sanitize(html as string);
          this.renderedContent.set(this.sanitizer.bypassSecurityTrustHtml(sanitizedHtml));
          this.loading.set(false);
        } catch (err) {
          this.error.set('Failed to render documentation');
          this.loading.set(false);
        }
      },
      error: (err) => {
        this.error.set('Failed to load documentation. Please try again later.');
        this.loading.set(false);
        console.error('Failed to load documentation:', err);
      },
    });
  }
}
