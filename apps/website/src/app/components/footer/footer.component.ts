import { Component } from '@angular/core';
import { RouterModule } from '@angular/router';
import { FontAwesomeModule } from '@fortawesome/angular-fontawesome';
import { faDiscord, faGithub, faReddit, faTwitter } from '@fortawesome/free-brands-svg-icons';
import { faSeedling } from '@fortawesome/free-solid-svg-icons';

@Component({
  selector: 'app-footer',
  standalone: true,
  imports: [RouterModule, FontAwesomeModule],
  template: `
    <footer class="footer">
      <div class="footer__container">
        <div class="footer__brand">
          <div class="footer__logo">
            <fa-icon [icon]="faSeedling" class="footer__logo-icon"></fa-icon>
            <span class="footer__logo-text">BitBonsai</span>
          </div>
          <p class="footer__tagline">Intelligent multi-node video encoding</p>
          <div class="footer__social">
            <a href="https://github.com/bitbonsai/bitbonsai" target="_blank" aria-label="GitHub">
              <fa-icon [icon]="faGithub"></fa-icon>
            </a>
            <a href="https://discord.gg/bitbonsai" target="_blank" aria-label="Discord">
              <fa-icon [icon]="faDiscord"></fa-icon>
            </a>
            <a href="https://twitter.com/bitbonsai" target="_blank" aria-label="Twitter">
              <fa-icon [icon]="faTwitter"></fa-icon>
            </a>
            <a href="https://reddit.com/r/bitbonsai" target="_blank" aria-label="Reddit">
              <fa-icon [icon]="faReddit"></fa-icon>
            </a>
          </div>
        </div>

        <div class="footer__links">
          <div class="footer__section">
            <h4 class="footer__heading">Product</h4>
            <a routerLink="/" class="footer__link">Features</a>
            <a routerLink="/pricing" class="footer__link">Pricing</a>
            <a routerLink="/download" class="footer__link">Download</a>
            <a routerLink="/compare" class="footer__link">Compare</a>
          </div>

          <div class="footer__section">
            <h4 class="footer__heading">Resources</h4>
            <a routerLink="/docs" class="footer__link">Docs</a>
            <a href="https://github.com/bitbonsai/bitbonsai/blob/main/CHANGELOG.md" target="_blank" class="footer__link">Changelog</a>
            <a href="https://github.com/bitbonsai/bitbonsai/wiki" target="_blank" class="footer__link">Wiki</a>
            <a href="https://github.com/bitbonsai/bitbonsai/discussions" target="_blank" class="footer__link">FAQ</a>
          </div>

          <div class="footer__section">
            <h4 class="footer__heading">Community</h4>
            <a href="https://github.com/bitbonsai/bitbonsai" target="_blank" class="footer__link">GitHub</a>
            <a href="https://discord.gg/bitbonsai" target="_blank" class="footer__link">Discord</a>
            <a href="https://twitter.com/bitbonsai" target="_blank" class="footer__link">Twitter</a>
            <a href="https://reddit.com/r/bitbonsai" target="_blank" class="footer__link">Reddit</a>
          </div>

          <div class="footer__section">
            <h4 class="footer__heading">Legal</h4>
            <a href="https://github.com/bitbonsai/bitbonsai/blob/main/LICENSE" target="_blank" class="footer__link">License (MIT)</a>
            <a routerLink="/privacy" class="footer__link">Privacy</a>
            <a routerLink="/terms" class="footer__link">Terms</a>
          </div>
        </div>
      </div>

      <div class="footer__bottom">
        <p>&copy; 2026 BitBonsai • Made with ❤️ for homelabbers</p>
      </div>
    </footer>
  `,
  styleUrls: ['./footer.component.scss'],
})
export class FooterComponent {
  // Icons
  faSeedling = faSeedling;
  faGithub = faGithub;
  faDiscord = faDiscord;
  faTwitter = faTwitter;
  faReddit = faReddit;
}
