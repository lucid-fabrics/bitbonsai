import { CommonModule } from '@angular/common';
import { Component, DestroyRef, inject, type OnInit } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import type { EnvironmentInfo } from '../models/environment-info.model';
import { SettingsService } from '../services/settings.service';

@Component({
  selector: 'app-environment-tab',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="tab-panel">
      <h2>Environment Information</h2>

      @if (environmentInfo) {
        <!-- Environment Type -->
        <div class="info-card">
          <h3>Detected Environment</h3>
          <div class="env-badge env-{{ environmentInfo!.environment.toLowerCase() }}">
            {{ environmentInfo!.environment }}
          </div>
          <p class="env-description">
            @if (environmentInfo!.isUnraid) {
              Running on Unraid OS {{ environmentInfo!.systemInfo.unraidVersion || '' }}
            } @else if (environmentInfo!.isDocker) {
              Running in Docker container
            } @else {
              Running on bare metal
            }
          </p>
        </div>

        <!-- System Info -->
        <div class="info-card">
          <h3>System Information</h3>
          <div class="info-grid">
            <div class="info-item">
              <span class="label">Platform:</span>
              <span class="value">{{ environmentInfo!.systemInfo.platform }}</span>
            </div>
            <div class="info-item">
              <span class="label">Architecture:</span>
              <span class="value">{{ environmentInfo!.systemInfo.architecture }}</span>
            </div>
            <div class="info-item">
              <span class="label">CPU Cores:</span>
              <span class="value">{{ environmentInfo!.systemInfo.cpuCores }}</span>
            </div>
            <div class="info-item">
              <span class="label">Memory:</span>
              <span class="value">{{ environmentInfo!.systemInfo.totalMemoryGb }} GB</span>
            </div>
          </div>
        </div>

        <!-- Hardware Acceleration Detection (Read-only) -->
        <div class="info-card">
          <h3>Hardware Acceleration</h3>
          <p class="env-description">
            Detected hardware acceleration capabilities on this node. Configure which hardware to use in your <strong>Encoding Policies</strong>.
          </p>
          @if (environmentInfo) {
            <div class="hw-accel-list">
              <div class="hw-accel-item" [class.available]="environmentInfo.hardwareAcceleration.nvidia">
                <i class="fas" [class.fa-check-circle]="environmentInfo.hardwareAcceleration.nvidia" [class.fa-times-circle]="!environmentInfo.hardwareAcceleration.nvidia"></i>
                NVIDIA NVENC
              </div>
              <div class="hw-accel-item" [class.available]="environmentInfo.hardwareAcceleration.intelQsv">
                <i class="fas" [class.fa-check-circle]="environmentInfo.hardwareAcceleration.intelQsv" [class.fa-times-circle]="!environmentInfo.hardwareAcceleration.intelQsv"></i>
                Intel QuickSync
              </div>
              <div class="hw-accel-item" [class.available]="environmentInfo.hardwareAcceleration.amd">
                <i class="fas" [class.fa-check-circle]="environmentInfo.hardwareAcceleration.amd" [class.fa-times-circle]="!environmentInfo.hardwareAcceleration.amd"></i>
                AMD AMF
              </div>
              <div class="hw-accel-item" [class.available]="environmentInfo.hardwareAcceleration.appleVideoToolbox">
                <i class="fas" [class.fa-check-circle]="environmentInfo.hardwareAcceleration.appleVideoToolbox" [class.fa-times-circle]="!environmentInfo.hardwareAcceleration.appleVideoToolbox"></i>
                Apple VideoToolbox
              </div>
            </div>
          }
          @if (environmentInfo!.isUnraid) {
            <div class="unraid-gpu-help" style="margin-top: 16px;">
              <i class="fas fa-info-circle"></i>
              <div class="help-content">
                <strong>Unraid GPU Setup:</strong> To enable GPU encoding, pass through your GPU device to the container:
                <ul>
                  <li><strong>NVIDIA:</strong> Add <code>--runtime=nvidia</code> to Extra Parameters</li>
                  <li><strong>Intel:</strong> Add <code>/dev/dri</code> device mapping</li>
                  <li><strong>AMD:</strong> Add <code>/dev/dri</code> and <code>/dev/kfd</code> device mappings</li>
                </ul>
              </div>
            </div>
          }
        </div>

        <!-- Default Paths -->
        <div class="info-card">
          <h3>Recommended Paths</h3>
          <div class="path-list">
            <div class="path-item">
              <span class="label">Media:</span>
              <div class="path-value">
                <code>{{ environmentInfo!.defaultPaths.mediaPath }}</code>
                <button
                  type="button"
                  class="btn-icon"
                  (click)="copyToClipboard(environmentInfo!.defaultPaths.mediaPath, 'Media path')"
                >
                  <i class="fa fa-copy"></i>
                </button>
              </div>
            </div>
            <div class="path-item">
              <span class="label">Downloads:</span>
              <div class="path-value">
                <code>{{ environmentInfo!.defaultPaths.downloadsPath }}</code>
                <button
                  type="button"
                  class="btn-icon"
                  (click)="copyToClipboard(environmentInfo!.defaultPaths.downloadsPath, 'Downloads path')"
                >
                  <i class="fa fa-copy"></i>
                </button>
              </div>
            </div>
            <div class="path-item">
              <span class="label">Config:</span>
              <div class="path-value">
                <code>{{ environmentInfo!.defaultPaths.configPath }}</code>
                <button
                  type="button"
                  class="btn-icon"
                  (click)="copyToClipboard(environmentInfo!.defaultPaths.configPath, 'Config path')"
                >
                  <i class="fa fa-copy"></i>
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- Recommendations -->
        @if (environmentInfo!.recommendations.length > 0) {
          <div class="info-card recommendations">
            <h3>Setup Recommendations</h3>
            <ul class="recommendation-list">
              @for (rec of environmentInfo!.recommendations; track rec) {
                <li>
                  <i class="fa fa-lightbulb"></i>
                  {{ rec }}
                </li>
              }
            </ul>
            <a [href]="environmentInfo!.docsLink" target="_blank" class="btn-link">
              <i class="fa fa-book"></i>
              View Documentation
            </a>
          </div>
        }
      }
    </div>
  `,
})
export class EnvironmentTabComponent implements OnInit {
  private readonly settingsService = inject(SettingsService);
  private readonly destroyRef = inject(DestroyRef);

  environmentInfo: EnvironmentInfo | null = null;
  successMessage: string | null = null;

  ngOnInit(): void {
    this.loadEnvironmentInfo();
  }

  private loadEnvironmentInfo(): void {
    this.settingsService
      .getEnvironmentInfo()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (info) => {
          this.environmentInfo = info;
        },
        error: () => {
          // Failed to load environment info
        },
      });
  }

  copyToClipboard(text: string, label: string): void {
    navigator.clipboard.writeText(text).then(() => {
      this.successMessage = `${label} copied to clipboard`;
      setTimeout(() => {
        this.successMessage = null;
      }, 3000);
    });
  }
}
