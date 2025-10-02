import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  type OnDestroy,
  type OnInit,
  signal,
} from '@angular/core';
import { FontAwesomeModule } from '@fortawesome/angular-fontawesome';
import {
  faChartLine,
  faCheck,
  faCheckCircle,
  faClock,
  faHardDrive,
  faPlay,
  faSpinner,
  faTimes,
} from '@fortawesome/pro-solid-svg-icons';
import { interval, Subject } from 'rxjs';
import { startWith, switchMap, takeUntil } from 'rxjs/operators';
import type { OverviewModel } from '../models/overview.model';
import { OverviewClient } from '../services/overview.client';

@Component({
  selector: 'app-overview',
  standalone: true,
  imports: [CommonModule, FontAwesomeModule],
  templateUrl: './overview.component.html',
  styleUrls: ['./overview.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OverviewComponent implements OnInit, OnDestroy {
  private readonly overviewApi = inject(OverviewClient);
  private readonly destroy$ = new Subject<void>();

  // Signals for reactive state
  readonly overviewData = signal<OverviewModel | null>(null);
  readonly isLoading = signal<boolean>(true);
  readonly error = signal<string | null>(null);

  // Computed signals
  readonly hasData = computed(() => this.overviewData() !== null);
  readonly totalQueueItems = computed(() => {
    const data = this.overviewData();
    if (!data) return 0;
    const queue = data.queue_summary;
    return queue.queued + queue.encoding + queue.completed + queue.failed;
  });

  // Font Awesome icons
  readonly icons = {
    activeNodes: faCheckCircle,
    queueStatus: faSpinner,
    storageSaved: faHardDrive,
    successRate: faChartLine,
    queued: faClock,
    encoding: faPlay,
    completed: faCheck,
    failed: faTimes,
  };

  ngOnInit(): void {
    this.startPolling();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private startPolling(): void {
    // Poll every 5 seconds
    interval(5000)
      .pipe(
        startWith(0), // Start immediately
        switchMap(() => this.overviewApi.getOverview()),
        takeUntil(this.destroy$)
      )
      .subscribe({
        next: (data) => {
          this.overviewData.set(data);
          this.isLoading.set(false);
          this.error.set(null);
        },
        error: (err) => {
          this.error.set('Failed to load overview data');
          this.isLoading.set(false);
          console.error('Overview polling error:', err);
        },
      });
  }

  formatBytes(gb: number): string {
    return `${gb.toFixed(2)} GB`;
  }

  formatDuration(seconds: number): string {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}m ${remainingSeconds}s`;
  }

  formatTime(isoString: string): string {
    const date = new Date(isoString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffMins < 1440) return `${Math.floor(diffMins / 60)}h ago`;
    return `${Math.floor(diffMins / 1440)}d ago`;
  }

  getProgressPercentage(value: number, total: number): number {
    return total > 0 ? Math.round((value / total) * 100) : 0;
  }
}
