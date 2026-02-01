import { CommonModule } from '@angular/common';
import { Component, DestroyRef, inject, type OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import {
  DebugClient,
  type FfmpegProcessesResponse,
  type SystemLoadInfo,
} from '../../../core/clients/debug.client';

@Component({
  selector: 'app-debug-tab',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="tab-panel">
      <h2>Diagnostics</h2>
      <p class="tab-description">System monitoring and process management for troubleshooting</p>

      <!-- System Load Card -->
      <div class="info-card">
        <div class="card-header-row">
          <h3><i class="fa fa-tachometer-alt"></i> System Load</h3>
          <button class="btn-icon" (click)="loadSystemInfo()" title="Refresh">
            <i class="fa fa-sync" [class.fa-spin]="loadingSystemInfo()"></i>
          </button>
        </div>

        @if (systemLoadInfo()) {
          <div class="load-grid">
            <div class="load-stat">
              <span class="load-label">1m Load</span>
              <span class="load-value" [class.overloaded]="systemLoadInfo()!.loadAvg1m > systemLoadInfo()!.loadThreshold">
                {{ systemLoadInfo()!.loadAvg1m.toFixed(2) }}
              </span>
            </div>
            <div class="load-stat">
              <span class="load-label">5m Load</span>
              <span class="load-value">{{ systemLoadInfo()!.loadAvg5m.toFixed(2) }}</span>
            </div>
            <div class="load-stat">
              <span class="load-label">15m Load</span>
              <span class="load-value">{{ systemLoadInfo()!.loadAvg15m.toFixed(2) }}</span>
            </div>
            <div class="load-stat">
              <span class="load-label">Threshold</span>
              <span class="load-value threshold">{{ systemLoadInfo()!.loadThreshold.toFixed(0) }}</span>
            </div>
            <div class="load-stat">
              <span class="load-label">CPU Cores</span>
              <span class="load-value">{{ systemLoadInfo()!.cpuCount }}</span>
            </div>
            <div class="load-stat">
              <span class="load-label">Free Memory</span>
              <span class="load-value">{{ systemLoadInfo()!.freeMemoryGB.toFixed(1) }} GB</span>
            </div>
          </div>

          @if (systemLoadInfo()!.isOverloaded) {
            <div class="alert alert-warning">
              <i class="fa fa-exclamation-triangle"></i>
              <span>System overloaded: {{ systemLoadInfo()!.reason }}</span>
            </div>
          } @else {
            <div class="alert alert-success">
              <i class="fa fa-check-circle"></i>
              <span>System load is within acceptable limits</span>
            </div>
          }
        }
      </div>

      <!-- Advanced Settings (collapsed by default) -->
      <details class="advanced-section">
        <summary class="advanced-toggle">
          <i class="fa fa-cog"></i> Advanced Settings
          <span class="toggle-hint">(usually not needed)</span>
        </summary>

        <!-- Load Threshold Setting -->
        <div class="info-card">
          <h3><i class="fa fa-sliders-h"></i> Load Threshold Override</h3>
          <p class="setting-description">
            Override automatic load management. Only adjust if encoding is being throttled unnecessarily.
          </p>

          <div class="threshold-setting">
            <div class="threshold-input-group">
              <label for="loadThreshold">Multiplier</label>
              <input
                id="loadThreshold"
                type="number"
                class="form-control"
                [ngModel]="loadThresholdMultiplier()"
                (ngModelChange)="loadThresholdMultiplier.set($event)"
                min="1.0"
                max="10.0"
                step="0.5"
              />
            </div>

            @if (systemLoadInfo()) {
              <div class="threshold-preview">
                <span class="preview-label">New Threshold:</span>
                <span class="preview-value">
                  {{ systemLoadInfo()!.cpuCount }} cores × {{ loadThresholdMultiplier() }} =
                  <strong>{{ (systemLoadInfo()!.cpuCount * loadThresholdMultiplier()).toFixed(0) }}</strong>
                </span>
              </div>
            }

            <button
              class="btn-primary"
              (click)="updateLoadThreshold()"
              [disabled]="savingThreshold()"
            >
              <i class="fa fa-save"></i>
              {{ savingThreshold() ? 'Saving...' : 'Apply' }}
            </button>
          </div>
        </div>
      </details>

      <!-- FFmpeg Processes Card -->
      <div class="info-card">
        <div class="card-header-row">
          <h3><i class="fa fa-film"></i> FFmpeg Processes</h3>
          <div class="header-actions">
            <button class="btn-icon" (click)="loadFfmpegProcesses()" title="Refresh">
              <i class="fa fa-sync" [class.fa-spin]="loadingProcesses()"></i>
            </button>
          </div>
        </div>
        @if (ffmpegData()?.zombieCount) {
          <div class="auto-cleanup-notice">
            <i class="fa fa-broom"></i>
            <span>{{ ffmpegData()!.zombieCount }} zombie process(es) detected - auto-cleanup runs every 60s</span>
          </div>
        }

        @if (ffmpegData()) {
          <!-- Tracked Encodings -->
          <div class="process-section">
            <h4>Tracked Encodings ({{ ffmpegData()!.trackedEncodings.length }})</h4>
            @if (ffmpegData()!.trackedEncodings.length === 0) {
              <p class="no-data">No active encoding jobs</p>
            } @else {
              <div class="process-table-container">
                <table class="process-table">
                  <thead>
                    <tr>
                      <th>Job ID</th>
                      <th>PID</th>
                      <th>Progress</th>
                      <th>Runtime</th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (enc of ffmpegData()!.trackedEncodings; track enc.jobId) {
                      <tr>
                        <td class="job-id">{{ enc.jobId.substring(0, 8) }}...</td>
                        <td>{{ enc.pid || 'N/A' }}</td>
                        <td>{{ enc.lastProgress.toFixed(1) }}%</td>
                        <td>{{ formatDuration(enc.runtimeSeconds) }}</td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            }
          </div>

          <!-- System Processes -->
          <div class="process-section">
            <h4>
              System FFmpeg Processes ({{ ffmpegData()!.systemProcesses.length }})
              @if (ffmpegData()!.zombieCount > 0) {
                <span class="zombie-badge">{{ ffmpegData()!.zombieCount }} zombies</span>
              }
            </h4>
            @if (ffmpegData()!.systemProcesses.length === 0) {
              <p class="no-data">No FFmpeg processes running on system</p>
            } @else {
              <div class="process-table-container">
                <table class="process-table">
                  <thead>
                    <tr>
                      <th>PID</th>
                      <th>Status</th>
                      <th>CPU%</th>
                      <th>MEM%</th>
                      <th>Runtime</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (proc of ffmpegData()!.systemProcesses; track proc.pid) {
                      <tr [class.zombie-row]="proc.isZombie">
                        <td>{{ proc.pid }}</td>
                        <td>
                          @if (proc.isZombie) {
                            <span class="status-badge zombie">
                              <i class="fa fa-skull"></i> Zombie
                            </span>
                          } @else {
                            <span class="status-badge tracked">
                              <i class="fa fa-check"></i> Tracked
                            </span>
                          }
                        </td>
                        <td>{{ proc.cpuPercent.toFixed(1) }}%</td>
                        <td>{{ proc.memPercent.toFixed(1) }}%</td>
                        <td>{{ formatDuration(proc.runtimeSeconds) }}</td>
                        <td>
                          @if (proc.isZombie) {
                            <button
                              class="btn-icon btn-danger-icon"
                              (click)="killProcess(proc.pid)"
                              title="Kill this process"
                            >
                              <i class="fa fa-times"></i>
                            </button>
                          } @else {
                            <span class="text-muted">-</span>
                          }
                        </td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            }
          </div>
        }
      </div>

      <!-- Messages -->
      @if (successMessage()) {
        <div class="alert alert-success">
          <i class="fa fa-check-circle"></i>
          {{ successMessage() }}
        </div>
      }
      @if (errorMessage()) {
        <div class="alert alert-danger">
          <i class="fa fa-exclamation-circle"></i>
          {{ errorMessage() }}
        </div>
      }
    </div>
  `,
  styles: [
    `
      .card-header-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 1rem;
      }

      .card-header-row h3 {
        margin: 0;
        display: flex;
        align-items: center;
        gap: 0.5rem;
      }

      .header-actions {
        display: flex;
        gap: 0.5rem;
        align-items: center;
      }

      .load-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
        gap: 1rem;
        margin-bottom: 1rem;
      }

      .load-stat {
        background: var(--bg-tertiary, #2a2a2a);
        padding: 1rem;
        border-radius: 8px;
        text-align: center;
      }

      .load-label {
        display: block;
        font-size: 0.75rem;
        color: var(--text-secondary, #888);
        margin-bottom: 0.25rem;
      }

      .load-value {
        display: block;
        font-size: 1.5rem;
        font-weight: bold;
        color: var(--text-primary, #e0e0e0);
      }

      .load-value.overloaded {
        color: var(--danger, #ff6b6b);
      }

      .load-value.threshold {
        color: var(--accent-primary, #f9be03);
      }

      .setting-description {
        color: var(--text-secondary, #888);
        margin-bottom: 1rem;
      }

      .threshold-setting {
        display: flex;
        flex-wrap: wrap;
        gap: 1rem;
        align-items: flex-end;
        margin-bottom: 1.5rem;
      }

      .threshold-input-group {
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
      }

      .threshold-input-group label {
        font-size: 0.875rem;
        color: var(--text-secondary, #888);
      }

      .threshold-input-group input {
        width: 100px;
      }

      .threshold-preview {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.5rem 1rem;
        background: var(--bg-tertiary, #2a2a2a);
        border-radius: 4px;
      }

      .preview-label {
        color: var(--text-secondary, #888);
      }

      .preview-value strong {
        color: var(--accent-primary, #f9be03);
      }

      .threshold-help {
        background: var(--bg-tertiary, #2a2a2a);
        padding: 1rem;
        border-radius: 8px;
      }

      .threshold-help h4 {
        margin: 0 0 0.5rem 0;
        font-size: 0.875rem;
        color: var(--text-primary, #e0e0e0);
      }

      .threshold-help ul {
        margin: 0 0 0.75rem 0;
        padding-left: 1.25rem;
      }

      .threshold-help li {
        margin-bottom: 0.25rem;
        color: var(--text-secondary, #888);
      }

      .help-note {
        margin: 0;
        font-size: 0.875rem;
        color: var(--success, #4ade80);
        display: flex;
        align-items: center;
        gap: 0.5rem;
      }

      .process-section {
        margin-top: 1.5rem;
      }

      .process-section h4 {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        margin: 0 0 0.75rem 0;
        font-size: 0.875rem;
        color: var(--text-primary, #e0e0e0);
      }

      .zombie-badge {
        background: var(--danger, #ff6b6b);
        color: white;
        padding: 0.125rem 0.5rem;
        border-radius: 4px;
        font-size: 0.75rem;
      }

      .process-table-container {
        overflow-x: auto;
      }

      .process-table {
        width: 100%;
        border-collapse: collapse;
      }

      .process-table th,
      .process-table td {
        padding: 0.5rem;
        text-align: left;
        border-bottom: 1px solid var(--border-primary, #2d2d2d);
      }

      .process-table th {
        font-size: 0.75rem;
        text-transform: uppercase;
        color: var(--text-secondary, #888);
      }

      .process-table td {
        font-size: 0.875rem;
      }

      .zombie-row {
        background: var(--danger-bg, #4d1f1f);
      }

      .status-badge {
        display: inline-flex;
        align-items: center;
        gap: 0.25rem;
        padding: 0.125rem 0.5rem;
        border-radius: 4px;
        font-size: 0.75rem;
      }

      .status-badge.zombie {
        background: var(--danger, #ff6b6b);
        color: white;
      }

      .status-badge.tracked {
        background: var(--success, #4ade80);
        color: var(--text-dark, #1a1a1a);
      }

      .job-id {
        font-family: var(--font-mono, monospace);
        font-size: 0.75rem;
      }

      .no-data {
        color: var(--text-secondary, #888);
        font-style: italic;
      }

      .btn-danger-icon {
        color: var(--danger, #ff6b6b);
      }

      .btn-danger-icon:hover {
        color: white;
        background: var(--danger, #ff6b6b);
      }

      .alert {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.75rem 1rem;
        border-radius: 4px;
        margin-top: 1rem;
      }

      .alert-success {
        background: var(--success-bg, #1a4d2e);
        color: var(--success, #4ade80);
      }

      .alert-warning {
        background: var(--warning-bg, #4d3a1a);
        color: var(--warning, #fbbf24);
      }

      .alert-danger {
        background: var(--danger-bg, #4d1f1f);
        color: var(--danger, #ff6b6b);
      }

      .btn-sm {
        padding: 0.25rem 0.75rem;
        font-size: 0.875rem;
      }

      .btn-danger {
        background: var(--danger, #ff6b6b);
        color: white;
        border: none;
        cursor: pointer;
      }

      .btn-danger:hover:not(:disabled) {
        background: #ff5252;
      }

      .text-muted {
        color: var(--text-tertiary, #666);
      }

      /* Advanced Settings Section */
      .advanced-section {
        margin-top: 1rem;
      }

      .advanced-toggle {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.75rem 1rem;
        background: var(--bg-tertiary, #2a2a2a);
        border-radius: 8px;
        cursor: pointer;
        color: var(--text-secondary, #888);
        font-size: 0.875rem;
        list-style: none;
      }

      .advanced-toggle::-webkit-details-marker {
        display: none;
      }

      .advanced-toggle::before {
        content: '▶';
        font-size: 0.625rem;
        transition: transform 0.2s;
      }

      details[open] .advanced-toggle::before {
        transform: rotate(90deg);
      }

      .advanced-toggle:hover {
        background: var(--bg-quaternary, #333);
      }

      .toggle-hint {
        font-size: 0.75rem;
        color: var(--text-tertiary, #666);
        font-style: italic;
      }

      details[open] .info-card {
        margin-top: 1rem;
      }

      /* Auto-cleanup notice */
      .auto-cleanup-notice {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.5rem 0.75rem;
        background: var(--info-bg, #1a3d4d);
        color: var(--info, #60a5fa);
        border-radius: 4px;
        font-size: 0.875rem;
        margin-bottom: 1rem;
      }
    `,
  ],
})
export class DebugTabComponent implements OnInit {
  private readonly debugClient = inject(DebugClient);
  private readonly destroyRef = inject(DestroyRef);

  // System load
  systemLoadInfo = signal<SystemLoadInfo | null>(null);
  loadingSystemInfo = signal(false);
  loadThresholdMultiplier = signal(5.0); // Default 5.0x - smart default that works for most systems
  savingThreshold = signal(false);

  // FFmpeg processes
  ffmpegData = signal<FfmpegProcessesResponse | null>(null);
  loadingProcesses = signal(false);
  killingZombies = signal(false);

  // Messages
  successMessage = signal<string | null>(null);
  errorMessage = signal<string | null>(null);

  ngOnInit(): void {
    this.loadSystemInfo();
    this.loadFfmpegProcesses();
  }

  loadSystemInfo(): void {
    this.loadingSystemInfo.set(true);
    this.debugClient
      .getSystemLoad()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (info) => {
          this.systemLoadInfo.set(info);
          this.loadThresholdMultiplier.set(info.loadThresholdMultiplier);
          this.loadingSystemInfo.set(false);
        },
        error: () => {
          this.loadingSystemInfo.set(false);
          this.showError('Failed to load system info');
        },
      });
  }

  loadFfmpegProcesses(): void {
    this.loadingProcesses.set(true);
    this.debugClient
      .getFfmpegProcesses()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (data) => {
          this.ffmpegData.set(data);
          this.loadingProcesses.set(false);
        },
        error: () => {
          this.loadingProcesses.set(false);
          this.showError('Failed to load FFmpeg processes');
        },
      });
  }

  updateLoadThreshold(): void {
    const multiplier = this.loadThresholdMultiplier();
    if (multiplier < 1.0 || multiplier > 10.0) {
      this.showError('Multiplier must be between 1.0 and 10.0');
      return;
    }

    this.savingThreshold.set(true);
    this.debugClient
      .updateLoadThreshold(multiplier)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          this.savingThreshold.set(false);
          if (result.success) {
            this.showSuccess(
              `Load threshold updated to ${result.loadThresholdMultiplier}x (max load: ${result.maxLoad})`
            );
            this.loadSystemInfo(); // Refresh to show new values
          } else {
            this.showError(result.message || 'Failed to update threshold');
          }
        },
        error: () => {
          this.savingThreshold.set(false);
          this.showError('Failed to update load threshold');
        },
      });
  }

  killProcess(pid: number): void {
    this.debugClient
      .killFfmpegProcess(pid)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          if (result.success) {
            this.showSuccess(result.message);
            this.loadFfmpegProcesses(); // Refresh list
          } else {
            this.showError(result.message);
          }
        },
        error: () => {
          this.showError(`Failed to kill process ${pid}`);
        },
      });
  }

  killAllZombies(): void {
    this.killingZombies.set(true);
    this.debugClient
      .killAllZombies()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          this.killingZombies.set(false);
          this.showSuccess(`Killed ${result.killed} zombie processes (${result.failed} failed)`);
          this.loadFfmpegProcesses(); // Refresh list
        },
        error: () => {
          this.killingZombies.set(false);
          this.showError('Failed to kill zombie processes');
        },
      });
  }

  formatDuration(seconds: number): string {
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) {
      const mins = Math.floor(seconds / 60);
      const secs = seconds % 60;
      return `${mins}m ${secs}s`;
    }
    const hours = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    return `${hours}h ${mins}m`;
  }

  private showSuccess(message: string): void {
    this.successMessage.set(message);
    this.errorMessage.set(null);
    setTimeout(() => this.successMessage.set(null), 5000);
  }

  private showError(message: string): void {
    this.errorMessage.set(message);
    this.successMessage.set(null);
    setTimeout(() => this.errorMessage.set(null), 5000);
  }
}
