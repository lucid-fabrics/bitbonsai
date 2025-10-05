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
import type { JobStatus, QueueFilters, QueueResponse } from './models/queue.model';
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
  protected readonly availableNodes$: Observable<string[]>;

  // State
  protected expandedJobId: string | null = null;
  protected showCancelDialog = false;
  protected selectedJobId: string | null = null;

  // Filter state
  protected selectedStatus: JobStatus | 'ALL' = 'ALL';
  protected selectedNode = '';
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

    // Extract available nodes from queue data
    this.availableNodes$ = this.queueData$.pipe(
      map((data) => {
        const jobs = data?.jobs || [];
        return [...new Set(jobs.map((job) => job.nodeName))].sort();
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
    if (this.selectedNode) {
      filters.nodeId = this.selectedNode;
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
    this.selectedNode = nodeId;
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
    return `status-${status.toLowerCase()}`;
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
}
