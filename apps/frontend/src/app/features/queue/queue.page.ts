import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
  type OnInit,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { interval, startWith, switchMap } from 'rxjs';
import type { JobStatus, QueueFilters, QueueResponse } from './models/queue.model';
import { QueueClient } from './services/queue.client';

@Component({
  selector: 'app-queue',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './queue.page.html',
  styleUrls: ['./queue.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class QueueComponent implements OnInit {
  private readonly queueApi = inject(QueueClient);
  private readonly destroyRef = inject(DestroyRef);

  // State signals
  protected readonly queueData = signal<QueueResponse | null>(null);
  protected readonly loading = signal(true);
  protected readonly expandedJobId = signal<string | null>(null);
  protected readonly showCancelDialog = signal(false);
  protected readonly selectedJobId = signal<string | null>(null);

  // Filter state
  protected selectedStatus = signal<JobStatus | 'ALL'>('ALL');
  protected selectedNode = signal<string>('');
  protected searchQuery = signal<string>('');

  // Available statuses for filter
  protected readonly statuses: Array<JobStatus | 'ALL'> = [
    'ALL',
    'QUEUED',
    'ENCODING',
    'COMPLETED',
    'FAILED',
    'CANCELLED',
  ];

  // Get unique node names from current data
  protected get availableNodes(): string[] {
    const jobs = this.queueData()?.jobs || [];
    return [...new Set(jobs.map((job) => job.nodeName))].sort();
  }

  ngOnInit(): void {
    this.startPolling();
  }

  private startPolling(): void {
    interval(5000)
      .pipe(
        startWith(0),
        switchMap(() => this.queueApi.getQueue(this.buildFilters())),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe({
        next: (data) => {
          this.queueData.set(data);
          this.loading.set(false);
        },
        error: (error) => {
          console.error('Failed to fetch queue data:', error);
          this.loading.set(false);
        },
      });
  }

  private buildFilters(): QueueFilters {
    const filters: QueueFilters = {};
    if (this.selectedStatus() !== 'ALL') {
      filters.status = this.selectedStatus() as JobStatus;
    }
    if (this.selectedNode()) {
      filters.nodeId = this.selectedNode();
    }
    if (this.searchQuery()) {
      filters.search = this.searchQuery();
    }
    return filters;
  }

  protected onStatusFilterChange(status: JobStatus | 'ALL'): void {
    this.selectedStatus.set(status);
    this.refreshQueue();
  }

  protected onNodeFilterChange(nodeId: string): void {
    this.selectedNode.set(nodeId);
    this.refreshQueue();
  }

  protected onSearchChange(query: string): void {
    this.searchQuery.set(query);
    this.refreshQueue();
  }

  private refreshQueue(): void {
    this.loading.set(true);
    this.queueApi.getQueue(this.buildFilters()).subscribe({
      next: (data) => {
        this.queueData.set(data);
        this.loading.set(false);
      },
      error: (error) => {
        console.error('Failed to refresh queue:', error);
        this.loading.set(false);
      },
    });
  }

  protected toggleJobDetails(jobId: string): void {
    this.expandedJobId.set(this.expandedJobId() === jobId ? null : jobId);
  }

  protected openCancelDialog(jobId: string, event: Event): void {
    event.stopPropagation();
    this.selectedJobId.set(jobId);
    this.showCancelDialog.set(true);
  }

  protected closeCancelDialog(): void {
    this.showCancelDialog.set(false);
    this.selectedJobId.set(null);
  }

  protected confirmCancel(): void {
    const jobId = this.selectedJobId();
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
