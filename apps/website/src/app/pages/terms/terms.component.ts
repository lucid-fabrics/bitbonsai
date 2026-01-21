import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { RouterModule } from '@angular/router';

@Component({
  selector: 'bb-terms',
  standalone: true,
  imports: [CommonModule, RouterModule],
  template: `
    <div class="legal">
      <section class="legal-header">
        <div class="legal-header__container">
          <h1 class="legal-header__title">Terms of Service</h1>
          <p class="legal-header__updated">Last updated: January 2026</p>
        </div>
      </section>

      <section class="legal-content">
        <div class="legal-content__container">
          <div class="legal-section">
            <h2>1. Acceptance of Terms</h2>
            <p>
              By downloading, installing, or using BitBonsai software ("Software"), you agree to be bound by
              these Terms of Service ("Terms"). If you do not agree to these Terms, do not use the Software.
            </p>
          </div>

          <div class="legal-section">
            <h2>2. License Grant</h2>
            <h3>2.1 Open Source License</h3>
            <p>
              BitBonsai is licensed under the MIT License. You may use, copy, modify, merge, publish,
              distribute, sublicense, and/or sell copies of the Software, subject to the conditions of the
              MIT License.
            </p>

            <h3>2.2 Premium Features</h3>
            <p>
              Certain features (multi-node support, increased concurrent jobs) require a valid license key.
              License keys are granted upon subscription and are subject to the tier limits of your plan.
            </p>
          </div>

          <div class="legal-section">
            <h2>3. Subscription Terms</h2>
            <h3>3.1 Billing</h3>
            <p>
              Paid subscriptions are billed monthly through Stripe or Patreon. Your subscription will
              automatically renew unless cancelled before the renewal date.
            </p>

            <h3>3.2 Refunds</h3>
            <p>
              Refunds may be requested within 14 days of initial purchase if the Software does not
              function as described. Refunds are not available for partial months or after feature usage.
            </p>

            <h3>3.3 Cancellation</h3>
            <p>
              You may cancel your subscription at any time. Upon cancellation, you retain access to premium
              features until the end of your current billing period, after which your account reverts to
              the Free tier.
            </p>
          </div>

          <div class="legal-section">
            <h2>4. Acceptable Use</h2>
            <p>You agree not to:</p>
            <ul>
              <li>Use the Software for any illegal purpose</li>
              <li>Circumvent license validation or feature restrictions</li>
              <li>Share license keys with unauthorized users</li>
              <li>Reverse engineer the license validation system</li>
              <li>Use the Software to infringe on intellectual property rights</li>
              <li>Attempt to disrupt or compromise our infrastructure</li>
            </ul>
          </div>

          <div class="legal-section">
            <h2>5. Intellectual Property</h2>
            <p>
              The BitBonsai name, logo, and associated branding are trademarks of BitBonsai.
              The Software source code is available under the MIT License on GitHub.
              Third-party libraries and components retain their respective licenses.
            </p>
          </div>

          <div class="legal-section">
            <h2>6. Disclaimer of Warranties</h2>
            <p>
              THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED,
              INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR
              PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE
              FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
              OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
              DEALINGS IN THE SOFTWARE.
            </p>
          </div>

          <div class="legal-section">
            <h2>7. Limitation of Liability</h2>
            <p>
              To the maximum extent permitted by law, BitBonsai shall not be liable for any indirect,
              incidental, special, consequential, or punitive damages, including but not limited to:
            </p>
            <ul>
              <li>Loss of data or media files</li>
              <li>Loss of profits or revenue</li>
              <li>Service interruptions</li>
              <li>Hardware damage from encoding operations</li>
            </ul>
            <p>
              Our total liability shall not exceed the amount paid by you for the Software in the
              12 months preceding the claim.
            </p>
          </div>

          <div class="legal-section">
            <h2>8. User Responsibility</h2>
            <p>
              You are solely responsible for:
            </p>
            <ul>
              <li>Maintaining backups of your media files</li>
              <li>Ensuring you have rights to encode media content</li>
              <li>Compliance with local laws regarding media encoding</li>
              <li>Security of your self-hosted installation</li>
              <li>Proper hardware and storage configuration</li>
            </ul>
          </div>

          <div class="legal-section">
            <h2>9. Modifications to Service</h2>
            <p>
              We reserve the right to modify, suspend, or discontinue any part of the Software or Services
              at any time. We will provide reasonable notice of significant changes affecting paid features.
            </p>
          </div>

          <div class="legal-section">
            <h2>10. Termination</h2>
            <p>
              We may terminate or suspend your license immediately, without prior notice, if you breach
              these Terms. Upon termination, you must cease all use of premium features and delete any
              license keys.
            </p>
          </div>

          <div class="legal-section">
            <h2>11. Governing Law</h2>
            <p>
              These Terms shall be governed by and construed in accordance with the laws of the jurisdiction
              in which BitBonsai operates, without regard to its conflict of law provisions.
            </p>
          </div>

          <div class="legal-section">
            <h2>12. Changes to Terms</h2>
            <p>
              We reserve the right to modify these Terms at any time. We will provide notice of material
              changes via our website or email. Continued use of the Software after changes constitutes
              acceptance of the new Terms.
            </p>
          </div>

          <div class="legal-section">
            <h2>13. Contact Us</h2>
            <p>
              For questions about these Terms, contact us at:
            </p>
            <p>
              <strong>Email:</strong> legal&#64;bitbonsai.app<br>
              <strong>GitHub:</strong> <a href="https://github.com/bitbonsai/bitbonsai/issues" target="_blank">bitbonsai/bitbonsai</a>
            </p>
          </div>
        </div>
      </section>
    </div>
  `,
  styleUrls: ['./terms.component.scss'],
})
export class TermsComponent {}
