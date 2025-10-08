import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, inject, type OnInit } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import {
  BehaviorSubject,
  catchError,
  interval,
  map,
  type Observable,
  of,
  shareReplay,
  startWith,
  switchMap,
} from 'rxjs';
import { RichTooltipDirective } from '../../shared/directives/rich-tooltip.directive';
import type { JobStatus } from './models/job-status.type';
import type { QueueFilters } from './models/queue-filters.model';
import type { QueueResponse } from './models/queue-response.model';
import { QueueClient } from './services/queue.client';

@Component({
  selector: 'app-queue',
  standalone: true,
  imports: [CommonModule, FormsModule, RichTooltipDirective],
  templateUrl: './queue.page.html',
  styleUrls: ['./queue.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class QueueComponent implements OnInit {
  private readonly queueApi = inject(QueueClient);
  private readonly destroyRef = inject(DestroyRef);

  // Expose Number for template
  protected readonly Number = Number;

  // Observables for reactive state
  private readonly refreshTrigger$ = new BehaviorSubject<void>(undefined);
  protected readonly queueData$: Observable<QueueResponse | null>;
  protected readonly isLoading$: Observable<boolean>;
  protected readonly availableNodes$: Observable<Map<string, string>>;

  // State
  protected expandedJobId: string | null = null;
  protected showCancelDialog = false;
  protected selectedJobId: string | null = null;

  // Filter state
  protected selectedStatus: JobStatus | 'ALL' = 'ALL';
  protected selectedNodeId = '';
  protected searchQuery = '';

  // Available statuses for filter
  protected readonly statuses: Array<JobStatus | 'ALL'> = [
    'ALL',
    'QUEUED',
    'ENCODING',
    'COMPLETED',
    'FAILED',
    'CANCELLED',
  ];

  constructor() {
    // Create observable stream for queue data
    this.queueData$ = this.refreshTrigger$.pipe(
      switchMap(() =>
        this.queueApi.getQueue(this.buildFilters()).pipe(
          catchError((error) => {
            console.error('Failed to fetch queue data:', error);
            return of(null);
          })
        )
      ),
      shareReplay({ bufferSize: 1, refCount: true })
    );

    // Loading state: true when queueData$ hasn't emitted yet
    this.isLoading$ = this.queueData$.pipe(
      map(() => false),
      startWith(true)
    );

    // Extract available nodes from queue data (Map of nodeId -> nodeName)
    this.availableNodes$ = this.queueData$.pipe(
      map((data) => {
        const jobs = data?.jobs || [];
        const nodeMap = new Map<string, string>();
        for (const job of jobs) {
          if (job.nodeId && job.nodeName) {
            nodeMap.set(job.nodeId, job.nodeName);
          }
        }
        return nodeMap;
      })
    );
  }

  ngOnInit(): void {
    this.startPolling();
  }

  private startPolling(): void {
    interval(5000)
      .pipe(startWith(0), takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        this.refreshTrigger$.next();
      });
  }

  private buildFilters(): QueueFilters {
    const filters: QueueFilters = {};
    if (this.selectedStatus !== 'ALL') {
      filters.status = this.selectedStatus as JobStatus;
    }
    if (this.selectedNodeId) {
      filters.nodeId = this.selectedNodeId;
    }
    if (this.searchQuery) {
      filters.search = this.searchQuery;
    }
    return filters;
  }

  protected onStatusFilterChange(status: JobStatus | 'ALL'): void {
    this.selectedStatus = status;
    this.refreshQueue();
  }

  protected onNodeFilterChange(nodeId: string): void {
    this.selectedNodeId = nodeId;
    this.refreshQueue();
  }

  protected onSearchChange(query: string): void {
    this.searchQuery = query;
    this.refreshQueue();
  }

  private refreshQueue(): void {
    this.refreshTrigger$.next();
  }

  protected toggleJobDetails(jobId: string): void {
    this.expandedJobId = this.expandedJobId === jobId ? null : jobId;
  }

  protected openCancelDialog(jobId: string, event: Event): void {
    event.stopPropagation();
    this.selectedJobId = jobId;
    this.showCancelDialog = true;
  }

  protected closeCancelDialog(): void {
    this.showCancelDialog = false;
    this.selectedJobId = null;
  }

  protected confirmCancel(): void {
    const jobId = this.selectedJobId;
    if (!jobId) return;

    this.queueApi.cancelJob(jobId).subscribe({
      next: () => {
        this.closeCancelDialog();
        this.refreshQueue();
      },
      error: (error) => {
        console.error('Failed to cancel job:', error);
        this.closeCancelDialog();
      },
    });
  }

  protected retryJob(jobId: string, event: Event): void {
    event.stopPropagation();
    this.queueApi.retryJob(jobId).subscribe({
      next: () => {
        this.refreshQueue();
      },
      error: (error) => {
        console.error('Failed to retry job:', error);
      },
    });
  }

  protected getStatusClass(status: JobStatus): string {
    return status ? `status-${status.toLowerCase()}` : 'status-unknown';
  }

  protected getStatusIcon(status: JobStatus): string {
    switch (status) {
      case 'QUEUED':
        return 'fa-clock';
      case 'ENCODING':
        return 'fa-spinner fa-spin';
      case 'COMPLETED':
        return 'fa-check-circle';
      case 'FAILED':
        return 'fa-exclamation-circle';
      case 'CANCELLED':
        return 'fa-ban';
      default:
        return 'fa-question-circle';
    }
  }

  protected getStatusExplanation(status: JobStatus): string {
    switch (status) {
      case 'QUEUED':
        return 'This job is waiting in the queue for an available encoding node. It will start automatically when a node becomes free.';
      case 'ENCODING':
        return 'This job is currently being encoded by a node. Progress is shown as a percentage. Encoding time depends on file size, quality settings, and node hardware.';
      case 'COMPLETED':
        return 'This job has finished encoding successfully. The file has been optimized and space savings are shown. The original file has been replaced or backed up according to your settings.';
      case 'FAILED':
        return 'This job encountered an error during encoding. Common causes include corrupted source files, insufficient disk space, or node crashes. You can retry the job or check the error details.';
      case 'CANCELLED':
        return "This job was manually cancelled and won't be encoded. The original file remains unchanged.";
      default:
        return 'Unknown job status.';
    }
  }

  protected formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / k ** i).toFixed(2)} ${sizes[i]}`;
  }

  protected formatDate(dateString: string): string {
    const date = new Date(dateString);
    return date.toLocaleString();
  }

  protected formatETA(etaSeconds: number | null | undefined): string {
    if (!etaSeconds || etaSeconds <= 0) return 'Calculating...';

    const hours = Math.floor(etaSeconds / 3600);
    const minutes = Math.floor((etaSeconds % 3600) / 60);
    const seconds = Math.floor(etaSeconds % 60);

    if (hours > 0) {
      return `${hours}h ${minutes}m remaining`;
    }
    if (minutes > 0) {
      return `${minutes}m ${seconds}s remaining`;
    }
    return `${seconds}s remaining`;
  }

  protected calculateEncodingSpeed(job: {
    startedAt?: string;
    currentSize: number;
    originalSize: number;
  }): string {
    if (!job.startedAt || job.currentSize <= 0) return '-';

    const startTime = new Date(job.startedAt).getTime();
    const now = Date.now();
    const elapsedSeconds = (now - startTime) / 1000;

    if (elapsedSeconds <= 0) return '-';

    const bytesProcessed = job.originalSize - job.currentSize;
    const bytesPerSecond = bytesProcessed / elapsedSeconds;

    return `${this.formatBytes(bytesPerSecond)}/s`;
  }

  protected getElapsedTime(startedAt?: string): string {
    if (!startedAt) return '-';

    const start = new Date(startedAt).getTime();
    const now = Date.now();
    const elapsedSeconds = Math.floor((now - start) / 1000);

    const hours = Math.floor(elapsedSeconds / 3600);
    const minutes = Math.floor((elapsedSeconds % 3600) / 60);
    const seconds = elapsedSeconds % 60;

    if (hours > 0) {
      return `${hours}h ${minutes}m ${seconds}s`;
    }
    if (minutes > 0) {
      return `${minutes}m ${seconds}s`;
    }
    return `${seconds}s`;
  }

  protected getCodecBadgeClass(codec: string | undefined): string {
    if (!codec) return 'codec-unknown';
    const codecLower = codec.toLowerCase();
    if (codecLower.includes('hevc') || codecLower.includes('h.265')) return 'codec-hevc';
    if (codecLower.includes('av1')) return 'codec-av1';
    if (codecLower.includes('h.264') || codecLower.includes('avc')) return 'codec-h264';
    if (codecLower.includes('vp9')) return 'codec-vp9';
    return 'codec-other';
  }
}
