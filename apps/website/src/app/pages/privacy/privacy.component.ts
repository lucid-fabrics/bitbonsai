import { Component } from '@angular/core';
import { RouterModule } from '@angular/router';

@Component({
  selector: 'bb-privacy',
  standalone: true,
  imports: [RouterModule],
  template: `
    <div class="legal">
      <section class="legal-header">
        <div class="legal-header__container">
          <h1 class="legal-header__title">Privacy Policy</h1>
          <p class="legal-header__updated">Last updated: January 2026</p>
        </div>
      </section>

      <section class="legal-content">
        <div class="legal-content__container">
          <div class="legal-section">
            <h2>1. Introduction</h2>
            <p>
              BitBonsai ("we", "our", or "us") respects your privacy. This Privacy Policy explains how we collect,
              use, and protect information when you use our self-hosted video encoding software and related services.
            </p>
          </div>

          <div class="legal-section">
            <h2>2. Information We Collect</h2>
            <h3>2.1 Self-Hosted Software</h3>
            <p>
              BitBonsai is designed to run entirely on your own infrastructure. The core software does not transmit
              your media files, library metadata, or encoding activity to our servers.
            </p>

            <h3>2.2 License Validation</h3>
            <p>When you activate a license, we collect:</p>
            <ul>
              <li>License key</li>
              <li>Machine identifier (anonymized hardware fingerprint)</li>
              <li>Software version</li>
              <li>Number of registered nodes</li>
            </ul>
            <p>
              This information is used solely for license validation and enforcement of tier limits.
            </p>

            <h3>2.3 Website Analytics</h3>
            <p>
              Our marketing website (bitbonsai.app) may use privacy-respecting analytics to understand visitor
              patterns. We do not use cookies for tracking purposes.
            </p>

            <h3>2.4 Payment Information</h3>
            <p>
              Payments are processed through Stripe or Patreon. We do not store credit card numbers or payment
              details on our servers. Please refer to their respective privacy policies for payment data handling.
            </p>
          </div>

          <div class="legal-section">
            <h2>3. How We Use Information</h2>
            <p>We use collected information to:</p>
            <ul>
              <li>Validate and manage software licenses</li>
              <li>Enforce tier-based feature limits</li>
              <li>Process payments and subscriptions</li>
              <li>Provide customer support</li>
              <li>Improve our software and services</li>
            </ul>
          </div>

          <div class="legal-section">
            <h2>4. Data Retention</h2>
            <p>
              License activation data is retained for the duration of your subscription plus 90 days.
              Payment records are retained as required by applicable financial regulations.
              You may request deletion of your data by contacting us.
            </p>
          </div>

          <div class="legal-section">
            <h2>5. Data Security</h2>
            <p>
              We implement industry-standard security measures to protect your information, including:
            </p>
            <ul>
              <li>Encrypted data transmission (TLS 1.3)</li>
              <li>Secure storage with access controls</li>
              <li>Regular security audits</li>
            </ul>
          </div>

          <div class="legal-section">
            <h2>6. Third-Party Services</h2>
            <p>We integrate with the following third-party services:</p>
            <ul>
              <li><strong>Stripe:</strong> Payment processing</li>
              <li><strong>Patreon:</strong> Subscription management</li>
              <li><strong>GitHub:</strong> Source code hosting and issue tracking</li>
              <li><strong>Discord:</strong> Community support</li>
            </ul>
            <p>Each service has its own privacy policy governing data handling.</p>
          </div>

          <div class="legal-section">
            <h2>7. Your Rights</h2>
            <p>You have the right to:</p>
            <ul>
              <li>Access your personal data</li>
              <li>Correct inaccurate data</li>
              <li>Request deletion of your data</li>
              <li>Export your data</li>
              <li>Withdraw consent for data processing</li>
            </ul>
            <p>To exercise these rights, contact us at privacy&#64;bitbonsai.app.</p>
          </div>

          <div class="legal-section">
            <h2>8. Children's Privacy</h2>
            <p>
              BitBonsai is not intended for use by children under 13. We do not knowingly collect
              personal information from children.
            </p>
          </div>

          <div class="legal-section">
            <h2>9. Changes to This Policy</h2>
            <p>
              We may update this Privacy Policy from time to time. We will notify users of significant
              changes via our website or email.
            </p>
          </div>

          <div class="legal-section">
            <h2>10. Contact Us</h2>
            <p>
              For privacy-related questions or concerns, contact us at:
            </p>
            <p>
              <strong>Email:</strong> privacy&#64;bitbonsai.app<br>
              <strong>GitHub:</strong> <a href="https://github.com/bitbonsai/bitbonsai/issues" target="_blank">bitbonsai/bitbonsai</a>
            </p>
          </div>
        </div>
      </section>
    </div>
  `,
  styleUrls: ['./privacy.component.scss'],
})
export class PrivacyComponent {}
