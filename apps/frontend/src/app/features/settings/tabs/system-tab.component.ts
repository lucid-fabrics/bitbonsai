import { Dialog } from '@angular/cdk/dialog';
import { CommonModule } from '@angular/common';
import { Component, DestroyRef, inject, type OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { Store } from '@ngrx/store';
import { Observable } from 'rxjs';
import { selectIsLinkedNode, selectMainNode } from '../../../core/+state/current-node.selectors';
import { NodesClient } from '../../../core/clients/nodes.client';
import {
  ConfirmationDialogComponent,
  type ConfirmationDialogData,
} from '../../../shared/components/confirmation-dialog/confirmation-dialog.component';
import type { SystemSettings } from '../models/system-settings.model';
import { SettingsService } from '../services/settings.service';

@Component({
  selector: 'app-system-tab',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="tab-panel">
      <h2>System Configuration</h2>

      @if (systemSettings()) {
        <!-- System Overview Card - Compact version -->
        <div class="info-card compact-card">
          <div class="compact-grid">
            <!-- Version -->
            <div class="compact-item">
              <div class="compact-icon version-icon">
                <i class="fa fa-tag"></i>
              </div>
              <div class="compact-details">
                <span class="compact-label">Version</span>
                <span class="compact-value">v{{ systemSettings()!.version }}</span>
              </div>
            </div>

            <!-- Database -->
            <div class="compact-item">
              <div class="compact-icon database-icon">
                <i class="fa fa-database"></i>
              </div>
              <div class="compact-details">
                <span class="compact-label">Database</span>
                <span class="compact-value">{{ systemSettings()!.databaseType }}</span>
              </div>
            </div>

            <!-- Storage -->
            <div class="compact-item">
              <div class="compact-icon storage-icon">
                <i class="fa fa-hdd"></i>
              </div>
              <div class="compact-details">
                <span class="compact-label">Storage Used</span>
                <span class="compact-value">{{ systemSettings()!.storageInfo.usagePercent.toFixed(1) }}%</span>
              </div>
            </div>

            <!-- Database Path -->
            <div class="compact-item full-span">
              <div class="compact-icon path-icon">
                <i class="fa fa-folder"></i>
              </div>
              <div class="compact-details">
                <span class="compact-label">Database Path</span>
                <code class="compact-value path-value">{{ systemSettings()!.databasePath }}</code>
              </div>
            </div>
          </div>

          <!-- Inline actions -->
          <div class="compact-actions">
            <button type="button" class="btn-secondary btn-sm" (click)="backupDatabase()" [disabled]="loading()">
              <i class="fa fa-download"></i>
              Backup Database
            </button>
          </div>
        </div>

        <!-- Storage Progress Bar (separate, visual card) -->
        <div class="info-card storage-card">
          <div class="storage-header">
            <h3>Storage Usage</h3>
            <span class="storage-percentage">{{ systemSettings()!.storageInfo.usagePercent.toFixed(1) }}%</span>
          </div>
          <div class="storage-bar-container">
            <div
              class="storage-bar-fill"
              [style.width.%]="systemSettings()!.storageInfo.usagePercent"
              [class.storage-warning]="systemSettings()!.storageInfo.usagePercent > 80"
              [class.storage-critical]="systemSettings()!.storageInfo.usagePercent > 90"
            ></div>
          </div>
          <div class="storage-details">
            <span>{{ systemSettings()!.storageInfo.usedGb.toFixed(1) }} GB used</span>
            <span>{{ systemSettings()!.storageInfo.totalGb.toFixed(1) }} GB total</span>
          </div>
        </div>

        <!-- Node Unregistration (Only shown for LINKED nodes) - Compact version -->
        @if (isLinkedNode$ | async) {
          <div class="info-card node-unregister-card">
            <div class="unregister-header">
              <div class="unregister-info">
                <h3>
                  <i class="fa fa-unlink"></i>
                  Unregister Node
                </h3>
                <p class="description">
                  Connected as <strong>Child Node</strong>
                  @if (mainNode$ | async; as mainNode) {
                    to <strong>{{ mainNode.name }}</strong>
                  }
                </p>
              </div>
              <button type="button" class="btn-danger btn-compact" (click)="unregisterNode()" [disabled]="loading()">
                <i class="fa fa-unlink"></i>
                Unregister
              </button>
            </div>
            <div class="unregister-note">
              <i class="fa fa-info-circle"></i>
              Unregistering will disconnect this node and reset it to unconfigured state.
            </div>
          </div>
        }

        <!-- Danger Zone - Compact version -->
        <div class="info-card danger-card">
          <div class="danger-header">
            <div>
              <h3>
                <i class="fa fa-exclamation-triangle"></i>
                Danger Zone
              </h3>
              <p class="description">Irreversible actions that reset system configuration</p>
            </div>
            <button type="button" class="btn-danger btn-compact" (click)="resetToDefaults()" [disabled]="loading()">
              <i class="fa fa-undo"></i>
              Reset to Defaults
            </button>
          </div>
        </div>
      }
    </div>
  `,
})
export class SystemTabComponent implements OnInit {
  private readonly settingsService = inject(SettingsService);
  private readonly nodesClient = inject(NodesClient);
  private readonly destroyRef = inject(DestroyRef);
  private readonly router = inject(Router);
  private readonly store = inject(Store);
  private readonly dialog = inject(Dialog);

  readonly isLinkedNode$: Observable<boolean> = this.store.select(selectIsLinkedNode);
  readonly mainNode$ = this.store.select(selectMainNode);

  systemSettings = signal<SystemSettings | null>(null);
  loading = signal(false);
  error = signal<string | null>(null);
  successMessage = signal<string | null>(null);

  ngOnInit(): void {
    this.loadSystemSettings();
  }

  private loadSystemSettings(): void {
    this.settingsService
      .getSystemSettings()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (settings) => {
          this.systemSettings.set(settings);
        },
        error: (err) => {
          console.error('Failed to load system settings:', err);
        },
      });
  }

  backupDatabase(): void {
    this.loading.set(true);
    this.error.set(null);
    this.successMessage.set(null);

    this.settingsService
      .backupDatabase()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result: { backupPath: string }) => {
          this.loading.set(false);
          this.successMessage.set(`Database backed up to: ${result.backupPath}`);
        },
        error: () => {
          this.error.set('Failed to backup database');
          this.loading.set(false);
        },
      });
  }

  resetToDefaults(): void {
    const dialogData: ConfirmationDialogData = {
      title: 'Reset to Defaults?',
      itemName: 'All System Settings',
      itemType: 'configuration',
      willHappen: [
        'Reset all system settings to factory defaults',
        'Clear custom configuration values',
        'Restart with default values',
      ],
      wontHappen: [
        'Delete any media files or libraries',
        'Remove encoding history or jobs',
        'Unregister nodes or delete connections',
        'Delete the database',
      ],
      irreversible: true,
      confirmButtonText: 'Reset to Defaults',
      cancelButtonText: 'Keep Current Settings',
    };

    const dialogRef = this.dialog.open(ConfirmationDialogComponent, {
      data: dialogData,
      disableClose: false,
    });

    dialogRef.closed.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((confirmed) => {
      if (confirmed === true) {
        this.loading.set(true);
        this.error.set(null);
        this.successMessage.set(null);

        this.settingsService
          .resetToDefaults()
          .pipe(takeUntilDestroyed(this.destroyRef))
          .subscribe({
            next: (result: { message: string }) => {
              this.loading.set(false);
              this.successMessage.set(result.message);
              this.loadSystemSettings();
            },
            error: () => {
              this.error.set('Failed to reset settings');
              this.loading.set(false);
            },
          });
      }
    });
  }

  unregisterNode(): void {
    const dialogData: ConfirmationDialogData = {
      title: 'Unregister Node?',
      itemName: window.location.hostname || 'This Node',
      itemType: 'node connection',
      willHappen: [
        'Disconnect from the main node',
        'Reset this node to unconfigured state',
        'Clear pairing information',
        "Remove this node from main node's node list",
      ],
      wontHappen: [
        'Delete any local data or files',
        'Uninstall the BitBonsai software',
        'Affect the main node or other child nodes',
        'Delete encoding history',
      ],
      irreversible: false,
      confirmButtonText: 'Unregister Node',
      cancelButtonText: 'Keep Connection',
    };

    const dialogRef = this.dialog.open(ConfirmationDialogComponent, {
      data: dialogData,
      disableClose: false,
    });

    dialogRef.closed.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((confirmed) => {
      if (confirmed === true) {
        this.loading.set(true);
        this.error.set(null);
        this.successMessage.set(null);

        this.nodesClient
          .unregisterSelf()
          .pipe(takeUntilDestroyed(this.destroyRef))
          .subscribe({
            next: (result) => {
              this.loading.set(false);
              this.successMessage.set(result.message);

              // Redirect to setup after successful unregistration
              setTimeout(() => {
                this.router.navigate(['/setup']);
              }, 2000);
            },
            error: (err) => {
              this.loading.set(false);
              this.error.set(err.error?.message || 'Failed to unregister node');
            },
          });
      }
    });
  }
}
