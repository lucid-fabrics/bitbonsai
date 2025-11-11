import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  EventEmitter,
  Input,
  Output,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { FontAwesomeModule } from '@fortawesome/angular-fontawesome';
import type { CapabilityTestResult } from '../../../../core/models/capability-test.model';
import { NetworkLocation } from '../../../../core/models/capability-test.model';

/**
 * Capability Results Component
 *
 * Displays capability test results with different layouts for LOCAL vs REMOTE nodes.
 * Allows editing configuration settings before finalizing.
 */
@Component({
  selector: 'app-capability-results',
  standalone: true,
  imports: [CommonModule, FormsModule, FontAwesomeModule],
  template: `
    <div class="capability-results-container">
      <!-- Results Header -->
      <div class="results-header" [class.local]="isLocal()" [class.remote]="isRemote()">
        @if (isLocal()) {
          <div class="header-badge local">
            <i class="fas fa-bolt"></i>
            <span>OPTIMIZED SETUP</span>
          </div>
          <h2>Local High-Speed Node</h2>
          <p>This node has optimal configuration for maximum performance</p>
        } @else if (isRemote()) {
          <div class="header-badge remote">
            <i class="fas fa-globe"></i>
            <span>REMOTE SETUP DETECTED</span>
          </div>
          <h2>Remote Network Node</h2>
          <p>File transfers will be required for encoding jobs</p>
        } @else {
          <div class="header-badge unknown">
            <i class="fas fa-question-circle"></i>
            <span>UNKNOWN CONFIGURATION</span>
          </div>
          <h2>Configuration Unknown</h2>
          <p>Unable to determine network configuration</p>
        }
      </div>

      <!-- Capabilities Summary -->
      <div class="capabilities-grid">
        <!-- Network Location -->
        <div class="capability-card">
          <div class="card-icon" [class.local]="isLocal()" [class.remote]="isRemote()">
            <i class="fas fa-network-wired"></i>
          </div>
          <div class="card-content">
            <div class="card-label">Network Location</div>
            <div class="card-value">{{ results().networkLocation }}</div>
          </div>
        </div>

        <!-- Shared Storage -->
        <div class="capability-card">
          <div class="card-icon" [class.enabled]="results().hasSharedStorage">
            <i class="fas fa-hdd"></i>
          </div>
          <div class="card-content">
            <div class="card-label">Shared Storage</div>
            <div class="card-value">{{ results().hasSharedStorage ? 'Enabled' : 'Disabled' }}</div>
            @if (results().storageBasePath) {
              <div class="card-detail">{{ results().storageBasePath }}</div>
            }
          </div>
        </div>

        <!-- Latency -->
        @if (results().latencyMs !== null) {
          <div class="capability-card">
            <div class="card-icon" [class.low-latency]="results().latencyMs! < 50">
              <i class="fas fa-tachometer-alt"></i>
            </div>
            <div class="card-content">
              <div class="card-label">Network Latency</div>
              <div class="card-value">{{ results().latencyMs }}ms</div>
            </div>
          </div>
        }

        <!-- IP Type -->
        <div class="capability-card">
          <div class="card-icon" [class.private]="results().isPrivateIP">
            <i class="fas fa-shield-alt"></i>
          </div>
          <div class="card-content">
            <div class="card-label">IP Address Type</div>
            <div class="card-value">{{ results().isPrivateIP ? 'Private' : 'Public' }}</div>
          </div>
        </div>
      </div>

      <!-- Reasoning -->
      <div class="reasoning-section">
        <div class="reasoning-title">
          <i class="fas fa-lightbulb"></i>
          <span>Configuration Analysis</span>
        </div>
        <div class="reasoning-text">{{ results().reasoning }}</div>
      </div>

      <!-- Configuration Settings -->
      <div class="settings-section">
        <h3>Node Configuration</h3>
        <p class="settings-subtitle">Customize performance settings for this node</p>

        <div class="settings-grid">
          <!-- Max Concurrent Jobs -->
          <div class="setting-field">
            <label for="maxWorkers">Max Concurrent Jobs</label>
            <input
              id="maxWorkers"
              type="number"
              min="1"
              max="10"
              [(ngModel)]="maxWorkers"
              class="form-input"
            />
            <div class="field-help">Number of encoding jobs this node can handle simultaneously</div>
          </div>

          <!-- CPU Limit -->
          <div class="setting-field">
            <label for="cpuLimit">CPU Limit (%)</label>
            <input
              id="cpuLimit"
              type="number"
              min="10"
              max="100"
              step="10"
              [(ngModel)]="cpuLimit"
              class="form-input"
            />
            <div class="field-help">Maximum CPU usage allowed for encoding tasks</div>
          </div>
        </div>
      </div>

      <!-- Warning for Remote Nodes -->
      @if (isRemote()) {
        <div class="warning-box">
          <div class="warning-header">
            <i class="fas fa-exclamation-triangle"></i>
            <span>Remote Node Performance Notice</span>
          </div>
          <div class="warning-content">
            <p>
              <strong>File Transfer Overhead:</strong> This node will need to download source files
              before encoding and upload results after completion.
            </p>
            <ul>
              <li>Estimated transfer time for 10GB file: ~15-30 minutes (depending on bandwidth)</li>
              <li>Consider using VPN or shared storage for better performance</li>
              <li>Jobs will be routed to local nodes when available</li>
            </ul>
          </div>
        </div>
      }

      <!-- Success Message for Local Nodes -->
      @if (isLocal() && results().hasSharedStorage) {
        <div class="success-box">
          <div class="success-header">
            <i class="fas fa-check-circle"></i>
            <span>Zero-Copy Encoding Enabled</span>
          </div>
          <div class="success-content">
            <p>
              This node can access files directly from the main node's storage. No file transfers
              required - encoding will start immediately!
            </p>
          </div>
        </div>
      }

      <!-- Actions -->
      <div class="actions-section">
        <button type="button" class="btn btn-secondary" (click)="onBack()">
          <i class="fas fa-arrow-left"></i>
          Back
        </button>
        <button type="button" class="btn btn-primary" (click)="onComplete()">
          Complete Setup
          <i class="fas fa-arrow-right"></i>
        </button>
      </div>
    </div>
  `,
  styles: [
    `
      .capability-results-container {
        max-width: 800px;
        margin: 0 auto;
        padding: 2rem;
      }

      .results-header {
        text-align: center;
        padding: 2rem;
        border-radius: 12px;
        margin-bottom: 2rem;
      }

      .results-header.local {
        background: linear-gradient(135deg, #1a4d2e 0%, #2a5d3e 100%);
        border: 2px solid #4ade80;
      }

      .results-header.remote {
        background: linear-gradient(135deg, #4d3a1a 0%, #5d4a2a 100%);
        border: 2px solid #fbbf24;
      }

      .results-header.unknown {
        background: linear-gradient(135deg, #2a2a2a 0%, #3a3a3a 100%);
        border: 2px solid #666;
      }

      .header-badge {
        display: inline-flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.5rem 1rem;
        border-radius: 9999px;
        font-size: 0.75rem;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        margin-bottom: 1rem;
      }

      .header-badge.local {
        background-color: #4ade80;
        color: #1a1a1a;
      }

      .header-badge.remote {
        background-color: #fbbf24;
        color: #1a1a1a;
      }

      .header-badge.unknown {
        background-color: #666;
        color: #e0e0e0;
      }

      .results-header h2 {
        font-size: 1.75rem;
        font-weight: 700;
        margin-bottom: 0.5rem;
        color: #e0e0e0;
      }

      .results-header p {
        font-size: 0.95rem;
        color: #888;
        margin: 0;
      }

      .capabilities-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
        gap: 1rem;
        margin-bottom: 2rem;
      }

      .capability-card {
        display: flex;
        align-items: flex-start;
        gap: 1rem;
        padding: 1.25rem;
        background-color: #252525;
        border: 1px solid #2d2d2d;
        border-radius: 8px;
        transition: all 0.2s;
      }

      .capability-card:hover {
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
        border-color: #3d3d3d;
      }

      .card-icon {
        width: 3rem;
        height: 3rem;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 8px;
        background-color: #2a2a2a;
        color: #666;
        font-size: 1.5rem;
      }

      .card-icon.local {
        background-color: #1a4d2e;
        color: #4ade80;
      }

      .card-icon.remote {
        background-color: #4d3a1a;
        color: #fbbf24;
      }

      .card-icon.enabled {
        background-color: #1a3a4d;
        color: #f9be03;
      }

      .card-icon.low-latency {
        background-color: #1a4d2e;
        color: #4ade80;
      }

      .card-icon.private {
        background-color: #1a2a4d;
        color: #f9be03;
      }

      .card-content {
        flex: 1;
      }

      .card-label {
        font-size: 0.75rem;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: #666;
        margin-bottom: 0.25rem;
        font-weight: 600;
      }

      .card-value {
        font-size: 1.125rem;
        font-weight: 700;
        color: #e0e0e0;
      }

      .card-detail {
        font-size: 0.75rem;
        color: #888;
        margin-top: 0.25rem;
        font-family: monospace;
      }

      .reasoning-section {
        padding: 1.5rem;
        background-color: #2a2a2a;
        border-left: 4px solid #f9be03;
        border-radius: 8px;
        margin-bottom: 2rem;
      }

      .reasoning-title {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        font-size: 0.875rem;
        font-weight: 600;
        color: #f9be03;
        margin-bottom: 0.75rem;
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }

      .reasoning-text {
        font-size: 0.95rem;
        color: #e0e0e0;
        line-height: 1.6;
      }

      .settings-section {
        background-color: #252525;
        border: 1px solid #2d2d2d;
        border-radius: 8px;
        padding: 1.5rem;
        margin-bottom: 2rem;
      }

      .settings-section h3 {
        font-size: 1.25rem;
        font-weight: 600;
        color: #e0e0e0;
        margin-bottom: 0.5rem;
      }

      .settings-subtitle {
        font-size: 0.875rem;
        color: #888;
        margin-bottom: 1.5rem;
      }

      .settings-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
        gap: 1.5rem;
      }

      .setting-field label {
        display: block;
        font-size: 0.875rem;
        font-weight: 600;
        color: #e0e0e0;
        margin-bottom: 0.5rem;
      }

      .form-input {
        width: 100%;
        padding: 0.625rem 0.875rem;
        background-color: #1a1a1a;
        border: 1px solid #3d3d3d;
        border-radius: 6px;
        font-size: 0.95rem;
        color: #e0e0e0;
        transition: all 0.2s;
      }

      .form-input:focus {
        outline: none;
        border-color: #f9be03;
        box-shadow: 0 0 0 3px rgba(249, 190, 3, 0.1);
      }

      .field-help {
        font-size: 0.75rem;
        color: #666;
        margin-top: 0.375rem;
      }

      .warning-box {
        background-color: #4d3a1a;
        border: 1px solid #5d4a2a;
        border-radius: 8px;
        padding: 1.5rem;
        margin-bottom: 2rem;
      }

      .warning-header {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        font-size: 0.95rem;
        font-weight: 600;
        color: #fbbf24;
        margin-bottom: 0.75rem;
      }

      .warning-header i {
        font-size: 1.25rem;
        color: #fbbf24;
      }

      .warning-content {
        font-size: 0.875rem;
        color: #e0e0e0;
      }

      .warning-content p {
        margin-bottom: 0.75rem;
      }

      .warning-content ul {
        margin: 0;
        padding-left: 1.5rem;
      }

      .warning-content li {
        margin-bottom: 0.375rem;
      }

      .success-box {
        background-color: #1a4d2e;
        border: 1px solid #2a5d3e;
        border-radius: 8px;
        padding: 1.5rem;
        margin-bottom: 2rem;
      }

      .success-header {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        font-size: 0.95rem;
        font-weight: 600;
        color: #4ade80;
        margin-bottom: 0.75rem;
      }

      .success-header i {
        font-size: 1.25rem;
        color: #4ade80;
      }

      .success-content {
        font-size: 0.875rem;
        color: #e0e0e0;
      }

      .success-content p {
        margin: 0;
      }

      .actions-section {
        display: flex;
        justify-content: space-between;
        gap: 1rem;
        padding-top: 1.5rem;
        border-top: 1px solid #2d2d2d;
      }

      .btn {
        display: inline-flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.75rem 1.5rem;
        border-radius: 6px;
        font-size: 0.95rem;
        font-weight: 600;
        border: none;
        cursor: pointer;
        transition: all 0.2s;
      }

      .btn-primary {
        background-color: #f9be03;
        color: #1a1a1a;
      }

      .btn-primary:hover {
        background-color: #fcd34d;
      }

      .btn-secondary {
        background-color: #252525;
        color: #e0e0e0;
        border: 1px solid #3d3d3d;
      }

      .btn-secondary:hover {
        background-color: #2a2a2a;
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CapabilityResultsComponent {
  @Input({ required: true }) set testResults(value: CapabilityTestResult) {
    this.results.set(value);
  }

  @Output() back = new EventEmitter<void>();
  @Output() complete = new EventEmitter<{ maxWorkers: number; cpuLimit: number }>();

  readonly results = signal<CapabilityTestResult>({} as CapabilityTestResult);

  // Editable settings
  maxWorkers = 2;
  cpuLimit = 80;

  // Computed properties
  readonly isLocal = computed(() => this.results().networkLocation === NetworkLocation.LOCAL);
  readonly isRemote = computed(() => this.results().networkLocation === NetworkLocation.REMOTE);

  onBack(): void {
    this.back.emit();
  }

  onComplete(): void {
    this.complete.emit({
      maxWorkers: this.maxWorkers,
      cpuLimit: this.cpuLimit,
    });
  }
}
