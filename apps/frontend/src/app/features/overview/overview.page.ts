import { AsyncPipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  inject,
  type OnDestroy,
  type OnInit,
} from '@angular/core';
import { FontAwesomeModule } from '@fortawesome/angular-fontawesome';
import {
  faChartLine,
  faCheck,
  faCheckCircle,
  faClock,
  faHardDrive,
  faMicrochip,
  faPlay,
  faSpinner,
  faTimes,
} from '@fortawesome/pro-solid-svg-icons';
import { TranslocoModule } from '@ngneat/transloco';
import { Store } from '@ngrx/store';
import { distinctUntilChanged } from 'rxjs';
import { OverviewActions } from './+state/overview.actions';
import type { OverviewModel } from './models/overview.model';

/**
 * DEEP AUDIT P2-2: Custom equality check for OverviewModel
 * Replaces JSON.stringify comparison with shallow key comparison for better performance.
 * Only compares the numeric values that affect UI rendering.
 */
function overviewDataEqual(prev: OverviewModel | null, curr: OverviewModel | null): boolean {
  if (prev === curr) return true;
  if (!prev || !curr) return false;

  // Compare queue_summary (most frequently changing)
  const pq = prev.queue_summary;
  const cq = curr.queue_summary;
  if (
    pq.queued !== cq.queued ||
    pq.encoding !== cq.encoding ||
    pq.completed !== cq.completed ||
    pq.failed !== cq.failed
  ) {
    return false;
  }

  // Compare system_health
  const ph = prev.system_health;
  const ch = curr.system_health;
  if (
    ph.active_nodes.current !== ch.active_nodes.current ||
    ph.active_nodes.total !== ch.active_nodes.total ||
    ph.queue_status.encoding_count !== ch.queue_status.encoding_count ||
    ph.storage_saved.total_tb !== ch.storage_saved.total_tb ||
    ph.success_rate.percentage !== ch.success_rate.percentage ||
    ph.cpu_utilization.percentage !== ch.cpu_utilization.percentage
  ) {
    return false;
  }

  // Compare recent_activity length and first item (most visible change)
  if (prev.recent_activity.length !== curr.recent_activity.length) return false;
  if (prev.recent_activity.length > 0) {
    const pa = prev.recent_activity[0];
    const ca = curr.recent_activity[0];
    if (pa.id !== ca.id || pa.progress !== ca.progress || pa.stage !== ca.stage) {
      return false;
    }
  }

  // Compare top_libraries length
  if (prev.top_libraries.length !== curr.top_libraries.length) return false;

  return true;
}

import {
  selectChildNodes,
  selectEnvironmentInfo,
  selectError,
  selectHasData,
  selectIsLoading,
  selectMainNode,
  selectNodes,
  selectOverviewData,
  selectTotalQueueItems,
} from './+state/overview.selectors';

@Component({
  selector: 'app-overview',
  standalone: true,
  imports: [AsyncPipe, FontAwesomeModule, TranslocoModule],
  templateUrl: './overview.page.html',
  styleUrls: ['./overview.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OverviewComponent implements OnInit, OnDestroy {
  private readonly store = inject(Store);

  // Observables from NgRx store
  // DEEP AUDIT P2-2: Use custom equality function instead of JSON.stringify for better performance
  readonly overviewData$ = this.store
    .select(selectOverviewData)
    .pipe(distinctUntilChanged(overviewDataEqual));
  readonly environmentInfo$ = this.store.select(selectEnvironmentInfo);
  readonly nodes$ = this.store.select(selectNodes);
  readonly isLoading$ = this.store.select(selectIsLoading);
  readonly error$ = this.store.select(selectError);

  // Computed observables (replacing computed signals)
  readonly hasData$ = this.store.select(selectHasData);
  readonly totalQueueItems$ = this.store.select(selectTotalQueueItems);
  readonly mainNode$ = this.store.select(selectMainNode);
  readonly childNodes$ = this.store.select(selectChildNodes);

  // Font Awesome icons
  readonly icons = {
    activeNodes: faCheckCircle,
    queueStatus: faSpinner,
    storageSaved: faHardDrive,
    successRate: faChartLine,
    cpuUtilization: faMicrochip,
    queued: faClock,
    encoding: faPlay,
    completed: faCheck,
    failed: faTimes,
  };

  ngOnInit(): void {
    // Initialize overview - loads all data and starts polling
    this.store.dispatch(OverviewActions.initOverview());
  }

  ngOnDestroy(): void {
    // Stop polling when component is destroyed
    this.store.dispatch(OverviewActions.stopPolling());
  }

  // Expose Math for template
  protected readonly Math = Math;

  formatBytes(gb: number): string {
    return `${gb.toFixed(2)} GB`;
  }

  formatSizeBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    if (bytes < 1024) return `${bytes.toFixed(0)} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
    if (bytes < 1024 * 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
    return `${(bytes / (1024 * 1024 * 1024 * 1024)).toFixed(2)} TB`;
  }

  formatSizeBytesCompact(bytes: number): string {
    if (bytes === 0) return '0';
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}K`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(0)}M`;
    if (bytes < 1024 * 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)}G`;
    return `${(bytes / (1024 * 1024 * 1024 * 1024)).toFixed(1)}T`;
  }

  formatStorageSaved(tb: number): string {
    const bytes = tb * 1024 * 1024 * 1024 * 1024; // Convert TB to bytes

    if (bytes === 0) return '0 B';
    if (bytes < 1024) return `${bytes.toFixed(0)} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
    if (bytes < 1024 * 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;

    return `${tb.toFixed(2)} TB`;
  }

  formatDuration(seconds: number): string {
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) {
      const minutes = Math.floor(seconds / 60);
      return `${minutes}m`;
    }
    if (seconds < 86400) {
      const hours = Math.floor(seconds / 3600);
      const minutes = Math.floor((seconds % 3600) / 60);
      return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
    }
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
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

  // TrackBy functions to prevent unnecessary re-renders
  // DEEP AUDIT P2-1: Fix any type
  trackByActivityId(_index: number, activity: { id: string }): string {
    return activity.id;
  }
}
