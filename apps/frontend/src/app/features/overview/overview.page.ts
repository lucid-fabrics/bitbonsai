import { CommonModule, ViewportScroller } from '@angular/common';
import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  inject,
  type OnDestroy,
  type OnInit,
} from '@angular/core';
import { FontAwesomeModule } from '@fortawesome/angular-fontawesome';
import { faCompactDisc } from '@fortawesome/pro-regular-svg-icons';
import {
  faChartLine,
  faCheck,
  faCheckCircle,
  faClock,
  faFilm,
  faHardDrive,
  faMicrochip,
  faPlay,
  faSpinner,
  faTimes,
  faTv,
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
export class OverviewComponent implements OnInit, OnDestroy, AfterViewInit {
  private readonly store = inject(Store);
  private readonly elementRef = inject(ElementRef);
  private savedScrollPosition = 0;

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
    cpuUtilization: faMicrochip,
    queued: faClock,
    encoding: faPlay,
    completed: faCheck,
    failed: faTimes,
    movie: faFilm,
    tvShow: faTv,
    anime: faCompactDisc,
  };

  ngOnInit(): void {
    // Initialize overview - loads all data and starts polling
    this.store.dispatch(OverviewActions.initOverview());

    // Subscribe to data changes and preserve scroll position
    this.overviewData$.subscribe(() => {
      // Save position immediately before any DOM updates
      const scrollPos = this.savedScrollPosition;

      // Use both setTimeout and requestAnimationFrame for maximum compatibility
      setTimeout(() => {
        requestAnimationFrame(() => {
          if (scrollPos > 0) {
            window.scrollTo({
              top: scrollPos,
              behavior: 'instant' as ScrollBehavior,
            });
          }
        });
      }, 0);
    });
  }

  ngAfterViewInit(): void {
    // Track scroll position whenever user scrolls
    window.addEventListener('scroll', this.saveScrollPosition.bind(this), { passive: true });
  }

  ngOnDestroy(): void {
    // Stop polling when component is destroyed
    this.store.dispatch(OverviewActions.stopPolling());

    // Clean up scroll listener
    window.removeEventListener('scroll', this.saveScrollPosition.bind(this));
  }

  private saveScrollPosition(): void {
    this.savedScrollPosition = window.scrollY || window.pageYOffset;
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

  getMediaTypeIcon(mediaType: string) {
    switch (mediaType) {
      case 'MOVIE':
      case 'ANIME_MOVIE':
        return this.icons.movie;
      case 'TV_SHOW':
        return this.icons.tvShow;
      case 'ANIME':
        return this.icons.anime;
      case 'MIXED':
      case 'OTHER':
      default:
        return this.icons.queueStatus;
    }
  }

  getMediaTypeLabel(mediaType: string): string {
    switch (mediaType) {
      case 'MOVIE':
        return 'Movies';
      case 'TV_SHOW':
        return 'TV Shows';
      case 'ANIME':
        return 'Anime';
      case 'ANIME_MOVIE':
        return 'Anime Movies';
      case 'MIXED':
        return 'Mixed';
      case 'OTHER':
      default:
        return 'Other';
    }
  }

  getCompressionPercent(library: {
    total_savings_bytes: number;
    total_before_bytes: number;
  }): number {
    if (library.total_before_bytes === 0) return 0;
    return (library.total_savings_bytes / library.total_before_bytes) * 100;
  }

  getCompletionPercent(library: { completed_jobs: number; job_count: number }): number {
    if (library.job_count === 0) return 0;
    return (library.completed_jobs / library.job_count) * 100;
  }

  // TrackBy functions to prevent unnecessary re-renders
  trackByActivityId(index: number, activity: any): string {
    return activity.id;
  }

  trackByLibraryName(index: number, library: any): string {
    return library.name;
  }
}
