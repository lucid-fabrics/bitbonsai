import { CommonModule } from '@angular/common';
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
  faPlay,
  faSpinner,
  faTimes,
} from '@fortawesome/pro-solid-svg-icons';
import { Store } from '@ngrx/store';
import { RichTooltipDirective } from '../../shared/directives/rich-tooltip.directive';
import { OverviewActions } from './+state/overview.actions';
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
  imports: [CommonModule, FontAwesomeModule, RichTooltipDirective],
  templateUrl: './overview.page.html',
  styleUrls: ['./overview.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OverviewComponent implements OnInit, OnDestroy {
  private readonly store = inject(Store);

  // Observables from NgRx store
  readonly overviewData$ = this.store.select(selectOverviewData);
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

  formatBytes(gb: number): string {
    return `${gb.toFixed(2)} GB`;
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
