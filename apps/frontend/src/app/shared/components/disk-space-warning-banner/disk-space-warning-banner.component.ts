import { AsyncPipe, NgClass } from '@angular/common';
import { Component, inject, OnInit } from '@angular/core';
import { TranslocoModule } from '@ngneat/transloco';
import { interval, type Observable, startWith, switchMap } from 'rxjs';
import { HealthClient } from '../../../core/clients/health.client';
import type { DiskSpaceMonitoringModel } from '../../../core/models/disk-space-monitoring.model';

@Component({
  selector: 'app-disk-space-warning-banner',
  standalone: true,
  imports: [AsyncPipe, NgClass, TranslocoModule],
  templateUrl: './disk-space-warning-banner.component.html',
  styleUrl: './disk-space-warning-banner.component.scss',
})
export class DiskSpaceWarningBannerComponent implements OnInit {
  private readonly healthClient = inject(HealthClient);

  diskSpaceData$!: Observable<DiskSpaceMonitoringModel>;
  showDetails = false;

  ngOnInit(): void {
    // Poll disk space every 2 minutes
    this.diskSpaceData$ = interval(2 * 60 * 1000).pipe(
      startWith(0), // Trigger immediately on init
      switchMap(() => this.healthClient.getDiskSpaceMonitoring())
    );
  }

  toggleDetails(): void {
    this.showDetails = !this.showDetails;
  }

  getStatusClass(status: 'ok' | 'warning' | 'critical'): string {
    return `banner-${status}`;
  }

  getStatusIcon(status: 'ok' | 'warning' | 'critical'): string {
    switch (status) {
      case 'critical':
        return 'fas fa-exclamation-circle';
      case 'warning':
        return 'fas fa-exclamation-triangle';
      default:
        return 'fas fa-check-circle';
    }
  }

  formatBytes(bytes: string | null): string {
    if (!bytes) return 'N/A';

    const num = Number(bytes);
    if (Number.isNaN(num)) return 'N/A';

    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(num) / Math.log(k));

    return `${Math.round((num / k ** i) * 10) / 10} ${sizes[i]}`;
  }

  hasLibrariesWithWarnings(diskSpace: DiskSpaceMonitoringModel): boolean {
    return diskSpace.libraries.some((lib) => lib.status !== 'ok');
  }
}
