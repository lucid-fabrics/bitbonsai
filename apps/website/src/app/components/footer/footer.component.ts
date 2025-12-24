import { Component } from '@angular/core';
import { RouterModule } from '@angular/router';

@Component({
  selector: 'bb-footer',
  standalone: true,
  imports: [RouterModule],
  template: `
    <footer class="footer">
      <div class="footer__container">
        <div class="footer__section">
          <h3>BitBonsai</h3>
          <p>Open-source video transcoding automation</p>
        </div>

        <div class="footer__section">
          <h4>Product</h4>
          <a routerLink="/pricing">Pricing</a>
          <a routerLink="/download">Download</a>
          <a routerLink="/docs">Documentation</a>
        </div>

        <div class="footer__section">
          <h4>Community</h4>
          <a href="https://github.com/bitbonsai/bitbonsai" target="_blank">GitHub</a>
          <a href="https://discord.gg/bitbonsai" target="_blank">Discord</a>
          <a href="https://twitter.com/bitbonsai" target="_blank">Twitter</a>
        </div>

        <div class="footer__section">
          <h4>Support</h4>
          <a href="https://ko-fi.com/bitbonsai" target="_blank">Ko-fi</a>
          <a href="https://patreon.com/bitbonsai" target="_blank">Patreon</a>
        </div>
      </div>

      <div class="footer__bottom">
        <p>&copy; 2025 BitBonsai. Open-source under MIT License.</p>
      </div>
    </footer>
  `,
  styleUrls: ['./footer.component.scss'],
})
export class FooterComponent {}
