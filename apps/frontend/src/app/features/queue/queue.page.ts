import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, inject, type OnInit } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import {
  BehaviorSubject,
  catchError,
  exhaustMap,
  interval,
  map,
  type Observable,
  of,
  shareReplay,
  startWith,
} from 'rxjs';
import { QueueClient } from '../../core/clients/queue.client';
import { FileHealthStatus } from '../../features/libraries/models/library.model';
import { RichTooltipDirective } from '../../shared/directives/rich-tooltip.directive';
import { AddFilesModalComponent } from './components/add-files-modal/add-files-modal.component';
import { JobStatus } from './models/job-status.enum';
import type { QueueFilters } from './models/queue-filters.model';
import type { QueueJob } from './models/queue-job.model';
import type { QueueResponse } from './models/queue-response.model';

@Component({
  selector: 'app-queue',
  standalone: true,
  imports: [CommonModule, FormsModule, RichTooltipDirective, AddFilesModalComponent],
  templateUrl: './queue.page.html',
  styleUrls: ['./queue.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class QueueComponent implements OnInit {
  private readonly queueApi = inject(QueueClient);
  private readonly destroyRef = inject(DestroyRef);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  // Expose Number for template
  protected readonly Number = Number;

  // Observables for reactive state
  private readonly refreshTrigger$ = new BehaviorSubject<{ showLoading: boolean }>({
    showLoading: true,
  });
  private readonly loadingSubject$ = new BehaviorSubject<boolean>(true);
  protected readonly queueData$: Observable<QueueResponse | null>;
  protected readonly isLoading$: Observable<boolean>;
  protected readonly availableNodes$: Observable<Map<string, string>>;

  // State
  protected expandedJobId: string | null = null;
  protected showCancelDialog = false;
  protected showCancelAllDialog = false;
  protected showRetryAllDialog = false;
  protected selectedJobId: string | null = null;
  protected showAddFilesModal = false;

  // Expose Math for template
  protected readonly Math = Math;

  // Expose FileHealthStatus enum for template
  protected readonly FileHealthStatus = FileHealthStatus;

  // Filter state
  protected selectedStatus: JobStatus | 'ALL' = 'ALL';
  protected selectedNodeId = '';
  protected searchQuery = '';

  // Available statuses for filter
  protected readonly statuses: Array<JobStatus | 'ALL'> = [
    'ALL',
    JobStatus.DETECTED,
    JobStatus.HEALTH_CHECK,
    JobStatus.QUEUED,
    JobStatus.ENCODING,
    JobStatus.VERIFYING,
    JobStatus.COMPLETED,
    JobStatus.FAILED,
    JobStatus.CANCELLED,
  ];

  constructor() {
    // Create observable stream for queue data
    this.queueData$ = this.refreshTrigger$.pipe(
      exhaustMap(({ showLoading }) => {
        // Only show loading for user-initiated actions, not polling
        if (showLoading) {
          this.loadingSubject$.next(true);
        }

        // Fetch jobs from queue API
        return this.queueApi.getQueue(this.buildFilters()).pipe(
          map((data) => {
            // Always clear loading when data arrives
            this.loadingSubject$.next(false);
            return data;
          }),
          catchError((error) => {
            console.error('Failed to fetch queue data:', error);
            // Always clear loading on error
            this.loadingSubject$.next(false);
            return of(null);
          })
        );
      }),
      shareReplay({ bufferSize: 1, refCount: true })
    );

    // Use the loading subject as the loading observable
    this.isLoading$ = this.loadingSubject$.asObservable();

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
    // Restore filter state from query params
    this.route.queryParams.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      if (params['status']) {
        const status = params['status'];
        // Validate the status is a valid filter option
        if (this.statuses.includes(status as any)) {
          this.selectedStatus = status as JobStatus | 'ALL';
        }
      }
      if (params['nodeId']) {
        this.selectedNodeId = params['nodeId'];
      }
      if (params['search']) {
        this.searchQuery = params['search'];
      }
    });

    this.startPolling();
  }

  private startPolling(): void {
    interval(5000)
      .pipe(startWith(0), takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        // Silent refresh for polling - don't show loading spinner
        this.refreshTrigger$.next({ showLoading: false });
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
    this.updateQueryParams();
    this.refreshQueue(true); // Show loading for user action
  }

  protected onNodeFilterChange(nodeId: string): void {
    this.selectedNodeId = nodeId;
    this.updateQueryParams();
    this.refreshQueue(true); // Show loading for user action
  }

  protected onSearchChange(query: string): void {
    this.searchQuery = query;
    this.updateQueryParams();
    this.refreshQueue(true); // Show loading for user action
  }

  private updateQueryParams(): void {
    const queryParams: any = {};

    if (this.selectedStatus !== 'ALL') {
      queryParams.status = this.selectedStatus;
    }
    if (this.selectedNodeId) {
      queryParams.nodeId = this.selectedNodeId;
    }
    if (this.searchQuery) {
      queryParams.search = this.searchQuery;
    }

    this.router.navigate([], {
      relativeTo: this.route,
      queryParams,
      queryParamsHandling: 'merge',
      replaceUrl: true, // Don't add to browser history
    });
  }

  private refreshQueue(showLoading = false): void {
    this.refreshTrigger$.next({ showLoading });
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

  protected confirmCancelAndRetry(): void {
    const jobId = this.selectedJobId;
    if (!jobId) return;

    this.queueApi
      .cancelJob(jobId, false) // blacklist = false
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
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

  protected confirmCancelAndBlacklist(): void {
    const jobId = this.selectedJobId;
    if (!jobId) return;

    this.queueApi
      .cancelJob(jobId, true) // blacklist = true
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
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
    this.queueApi
      .retryJob(jobId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.refreshQueue();
        },
        error: (error) => {
          console.error('Failed to retry job:', error);
        },
      });
  }

  protected openCancelAllDialog(): void {
    this.showCancelAllDialog = true;
  }

  protected closeCancelAllDialog(): void {
    this.showCancelAllDialog = false;
  }

  protected confirmCancelAll(): void {
    this.queueApi
      .cancelAllQueued()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          console.log(`Cancelled ${result.cancelledCount} jobs`);
          this.closeCancelAllDialog();
          this.refreshQueue();
        },
        error: (error) => {
          console.error('Failed to cancel all jobs:', error);
          this.closeCancelAllDialog();
        },
      });
  }

  protected openRetryAllDialog(): void {
    this.showRetryAllDialog = true;
  }

  protected closeRetryAllDialog(): void {
    this.showRetryAllDialog = false;
  }

  protected confirmRetryAll(): void {
    this.queueApi
      .retryAllCancelled()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          console.log(
            `Retried ${result.retriedCount} jobs (${this.formatBytes(Number(result.totalSizeBytes))} total)`
          );
          this.closeRetryAllDialog();
          this.refreshQueue();
        },
        error: (error) => {
          console.error('Failed to retry all cancelled jobs:', error);
          this.closeRetryAllDialog();
        },
      });
  }

  protected openAddFilesModal(): void {
    this.showAddFilesModal = true;
  }

  protected closeAddFilesModal(): void {
    this.showAddFilesModal = false;
  }

  protected handleJobsCreated(result: { jobsCreated: number }): void {
    console.log(`Created ${result.jobsCreated} job(s)`);
    this.closeAddFilesModal();
    this.refreshQueue(true); // Refresh with loading indicator
  }

  protected getStatusClass(status: JobStatus): string {
    return status ? `status-${status.toLowerCase()}` : 'status-unknown';
  }

  protected getStatusIcon(status: JobStatus): string {
    switch (status) {
      case JobStatus.QUEUED:
        return 'fa-clock';
      case JobStatus.ENCODING:
        return 'fa-spinner fa-spin';
      case JobStatus.COMPLETED:
        return 'fa-check-circle';
      case JobStatus.FAILED:
        return 'fa-exclamation-circle';
      case JobStatus.CANCELLED:
        return 'fa-ban';
      default:
        return 'fa-question-circle';
    }
  }

  protected getStatusExplanation(status: JobStatus): string {
    switch (status) {
      case JobStatus.QUEUED:
        return 'This job is waiting in the queue for an available encoding node. It will start automatically when a node becomes free.';
      case JobStatus.ENCODING:
        return 'This job is currently being encoded by a node. Progress is shown as a percentage. Encoding time depends on file size, quality settings, and node hardware.';
      case JobStatus.COMPLETED:
        return 'This job has finished encoding successfully. The file has been optimized and space savings are shown. The original file has been replaced or backed up according to your settings.';
      case JobStatus.FAILED:
        return 'This job encountered an error during encoding. Common causes include corrupted source files, insufficient disk space, or node crashes. You can retry the job or check the error details.';
      case JobStatus.CANCELLED:
        return "This job was manually cancelled and won't be encoded. The original file remains unchanged.";
      default:
        return 'Unknown job status.';
    }
  }

  protected getHealthStatusIcon(status: FileHealthStatus): string {
    switch (status) {
      case FileHealthStatus.HEALTHY:
        return 'fas fa-check-circle';
      case FileHealthStatus.WARNING:
        return 'fas fa-exclamation-triangle';
      case FileHealthStatus.CORRUPTED:
        return 'fas fa-times-circle';
      case FileHealthStatus.UNKNOWN:
      default:
        return 'fas fa-question-circle';
    }
  }

  protected getHealthStatusTitle(status: FileHealthStatus): string {
    switch (status) {
      case FileHealthStatus.HEALTHY:
        return 'File is Healthy';
      case FileHealthStatus.WARNING:
        return 'File has Warnings';
      case FileHealthStatus.CORRUPTED:
        return 'File is Corrupted';
      case FileHealthStatus.UNKNOWN:
      default:
        return 'Health Status Unknown';
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

  protected getCancelledJobs(data: QueueResponse): QueueResponse['jobs'] {
    return data.jobs.filter((job) => job.status === 'CANCELLED');
  }

  protected calculateTotalSize(jobs: QueueResponse['jobs']): number {
    return jobs.reduce((sum, job) => sum + Number(job.originalSize), 0);
  }

  protected calculateEstimatedTime(totalSizeBytes: number): { hours: number; minutes: number } {
    const avgEncodingSpeed = 50 * 1024 * 1024; // 50 MB/s
    const estimatedSeconds = totalSizeBytes / avgEncodingSpeed;
    const hours = Math.floor(estimatedSeconds / 3600);
    const minutes = Math.floor((estimatedSeconds % 3600) / 60);
    return { hours, minutes };
  }

  protected getAvgEncodingSpeed(): number {
    return 50 * 1024 * 1024; // 50 MB/s
  }

  /**
   * Estimate final size based on codec conversion
   * Returns estimated size in bytes
   */
  protected getEstimatedSize(job: {
    originalSize: number;
    sourceCodec?: string;
    targetCodec?: string;
  }): number {
    const compressionRatio = this.getCompressionRatio(job.sourceCodec, job.targetCodec);
    return Math.round(job.originalSize * (1 - compressionRatio));
  }

  /**
   * Get estimated compression percentage
   * Returns percentage as number (e.g., 50 for 50%)
   */
  protected getEstimatedCompression(job: { sourceCodec?: string; targetCodec?: string }): number {
    return Math.round(this.getCompressionRatio(job.sourceCodec, job.targetCodec) * 100);
  }

  /**
   * Calculate compression ratio based on codec conversion
   * Returns ratio (e.g., 0.5 for 50% compression)
   */
  private getCompressionRatio(sourceCodec?: string, targetCodec?: string): number {
    if (!sourceCodec || !targetCodec) {
      return 0.4; // Default 40% compression
    }

    const source = sourceCodec.toLowerCase();
    const target = targetCodec.toLowerCase();

    // H.264 to HEVC: 40-50% savings (typical)
    if (source.includes('h.264') || source.includes('avc')) {
      if (target.includes('hevc') || target.includes('h.265')) {
        return 0.45;
      }
      if (target.includes('av1')) {
        return 0.5;
      }
    }

    // HEVC to AV1: 20-30% additional savings
    if (source.includes('hevc') || source.includes('h.265')) {
      if (target.includes('av1')) {
        return 0.25;
      }
    }

    // VP9 conversions
    if (source.includes('vp9')) {
      if (target.includes('av1')) {
        return 0.2;
      }
      if (target.includes('hevc')) {
        return 0.15;
      }
    }

    // Same codec or unknown: minimal compression
    if (source === target) {
      return 0.05;
    }

    // Default conservative estimate
    return 0.4;
  }
}
