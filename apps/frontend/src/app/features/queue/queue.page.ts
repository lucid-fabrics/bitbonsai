import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, inject, type OnInit } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { FontAwesomeModule } from '@fortawesome/angular-fontawesome';
import { faBolt, faFire, faLayerGroup } from '@fortawesome/pro-solid-svg-icons';
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
import { ToastService } from '../../core/services/toast.service';
import { FileHealthStatus } from '../../features/libraries/models/library.model';
import { RichTooltipDirective } from '../../shared/directives/rich-tooltip.directive';
import { AddFilesModalComponent } from './components/add-files-modal/add-files-modal.component';
import { ErrorDetailsModalComponent } from './components/error-details-modal/error-details-modal.component';
import { JobStatus } from './models/job-status.enum';
import type { QueueFilters } from './models/queue-filters.model';
import type { QueueJob } from './models/queue-job.model';
import type { QueueResponse } from './models/queue-response.model';

@Component({
  selector: 'app-queue',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    FontAwesomeModule,
    RichTooltipDirective,
    AddFilesModalComponent,
    ErrorDetailsModalComponent,
  ],
  templateUrl: './queue.page.html',
  styleUrls: ['./queue.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class QueueComponent implements OnInit {
  private readonly queueApi = inject(QueueClient);
  private readonly toastService = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  // Expose Number for template
  protected readonly Number = Number;

  // FontAwesome icons for priority
  protected readonly icons = {
    fire: faFire,
    bolt: faBolt,
    layers: faLayerGroup,
  };

  // Observables for reactive state
  private readonly refreshTrigger$ = new BehaviorSubject<{ showLoading: boolean }>({
    showLoading: true,
  });
  private readonly loadingSubject$ = new BehaviorSubject<boolean>(true);
  protected readonly queueData$: Observable<QueueResponse | null>;
  protected readonly isLoading$: Observable<boolean>;
  protected readonly availableNodes$: Observable<Map<string, string>>;
  protected readonly availableLibraries$: Observable<
    Map<string, { name: string; nodeName: string }>
  >;

  // State
  protected expandedJobId: string | null = null;
  protected openPriorityMenuId: string | null = null;
  protected showCancelDialog = false;
  protected showCancelAllDialog = false;
  protected showRetryAllDialog = false;
  protected showClearJobsDialog = false;
  protected clearJobsStages: string[] = [];
  protected selectedJobId: string | null = null;
  protected showAddFilesModal = false;
  protected showErrorDetailsModal = false;
  protected errorModalData: {
    fileName: string;
    error: string;
    status: string;
    jobId: string;
  } | null = null;

  // Expose Math for template
  protected readonly Math = Math;

  // Expose FileHealthStatus enum for template
  protected readonly FileHealthStatus = FileHealthStatus;

  // Expose JobStatus enum for template
  protected readonly JobStatus = JobStatus;

  // Filter state
  protected selectedStatus: JobStatus | 'ALL' = 'ALL';
  protected selectedNodeId = '';
  protected selectedLibraryId = '';
  protected searchQuery = '';

  // Available statuses for filter (exclude transient statuses that jobs pass through quickly)
  protected readonly statuses: Array<JobStatus | 'ALL'> = [
    'ALL',
    JobStatus.QUEUED,
    JobStatus.ENCODING,
    JobStatus.PAUSED,
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

            // Client-side filter: when ENCODING is selected, show both ENCODING and PAUSED
            if (data && this.selectedStatus === JobStatus.ENCODING) {
              const filteredJobs = data.jobs.filter(
                (job) => job.status === JobStatus.ENCODING || job.status === JobStatus.PAUSED
              );
              return { ...data, jobs: filteredJobs };
            }

            return data;
          }),
          catchError(() => {
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

    // Extract available libraries from queue data (Map of libraryId -> { name, nodeName })
    this.availableLibraries$ = this.queueData$.pipe(
      map((data) => {
        const jobs = data?.jobs || [];
        const libraryMap = new Map<string, { name: string; nodeName: string }>();
        for (const job of jobs) {
          if (job.libraryId && job.libraryName && job.nodeName) {
            libraryMap.set(job.libraryId, {
              name: job.libraryName,
              nodeName: job.nodeName,
            });
          }
        }
        return libraryMap;
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
      if (params['libraryId']) {
        this.selectedLibraryId = params['libraryId'];
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
    // When filtering by ENCODING, we want to show both ENCODING and PAUSED jobs
    // So we don't send a status filter - we'll filter client-side instead
    if (this.selectedStatus !== 'ALL' && this.selectedStatus !== JobStatus.ENCODING) {
      filters.status = this.selectedStatus as JobStatus;
    }
    if (this.selectedNodeId) {
      filters.nodeId = this.selectedNodeId;
    }
    if (this.selectedLibraryId) {
      filters.libraryId = this.selectedLibraryId;
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

  protected onLibraryFilterChange(libraryId: string): void {
    this.selectedLibraryId = libraryId;
    this.updateQueryParams();
    this.refreshQueue(true); // Show loading for user action
  }

  protected onSearchChange(query: string): void {
    this.searchQuery = query;
    this.updateQueryParams();
    this.refreshQueue(true); // Show loading for user action
  }

  protected updateQueryParams(): void {
    const queryParams: any = {};

    if (this.selectedStatus !== 'ALL') {
      queryParams.status = this.selectedStatus;
    }
    if (this.selectedNodeId) {
      queryParams.nodeId = this.selectedNodeId;
    }
    if (this.selectedLibraryId) {
      queryParams.libraryId = this.selectedLibraryId;
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

  protected refreshQueue(showLoading = false): void {
    this.refreshTrigger$.next({ showLoading });
  }

  protected clearAllFilters(): void {
    this.selectedStatus = 'ALL';
    this.selectedNodeId = '';
    this.selectedLibraryId = '';
    this.searchQuery = '';
    this.updateQueryParams();
    this.refreshQueue(true);
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
          this.toastService.success('Job cancelled');
          this.closeCancelDialog();
          this.refreshQueue();
        },
        error: () => {
          this.toastService.error('Failed to cancel job');
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
          this.toastService.success('Job cancelled and blacklisted');
          this.closeCancelDialog();
          this.refreshQueue();
        },
        error: () => {
          this.toastService.error('Failed to cancel job');
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
          this.toastService.success('Job moved back to queue');
          this.refreshQueue();
        },
        error: () => {
          this.toastService.error('Failed to retry job');
        },
      });
  }

  protected togglePriorityMenu(jobId: string): void {
    this.openPriorityMenuId = this.openPriorityMenuId === jobId ? null : jobId;
  }

  protected setPriority(jobId: string, priority: number, event: Event): void {
    event.stopPropagation();
    this.openPriorityMenuId = null; // Close menu after selection
    this.queueApi
      .updateJobPriority(jobId, priority)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          const priorityNames = ['Normal', 'High', 'Top Priority'];
          this.toastService.success(`Priority set to ${priorityNames[priority]}`);
          this.refreshQueue();
        },
        error: (err) => {
          const errorMessage = err?.error?.message || 'Failed to update priority';
          this.toastService.error(errorMessage);
        },
      });
  }

  protected pauseJob(jobId: string, event: Event): void {
    event.stopPropagation();
    this.queueApi
      .pauseJob(jobId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.toastService.info('Job paused');
          this.refreshQueue();
        },
        error: () => {
          this.toastService.error('Failed to pause job');
        },
      });
  }

  protected resumeJob(jobId: string, event: Event): void {
    event.stopPropagation();
    this.queueApi
      .resumeJob(jobId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.toastService.info('Job resumed');
          this.refreshQueue();
        },
        error: () => {
          this.toastService.error('Failed to resume job');
        },
      });
  }

  protected forceStartJob(jobId: string, event: Event): void {
    event.stopPropagation();
    this.queueApi
      .forceStartJob(jobId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.toastService.success('Job prioritized and will start encoding within seconds');
          this.refreshQueue();
        },
        error: () => {
          this.toastService.error('Failed to force-start job');
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
          const count = result.cancelledCount;
          this.toastService.success(count === 1 ? '1 job cancelled' : `${count} jobs cancelled`);
          this.closeCancelAllDialog();
          this.refreshQueue();
        },
        error: () => {
          this.toastService.error('Failed to cancel jobs');
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
          const count = result.retriedCount;
          this.toastService.success(
            count === 1 ? '1 job moved back to queue' : `${count} jobs moved back to queue`
          );
          this.closeRetryAllDialog();
          this.refreshQueue();
        },
        error: () => {
          this.toastService.error('Failed to retry jobs');
          this.closeRetryAllDialog();
        },
      });
  }

  protected openClearJobsDialog(stages?: string[]): void {
    this.clearJobsStages = stages || [];
    this.showClearJobsDialog = true;
  }

  protected closeClearJobsDialog(): void {
    this.showClearJobsDialog = false;
    this.clearJobsStages = [];
  }

  protected confirmClearJobs(): void {
    this.queueApi
      .clearJobs(this.clearJobsStages.length > 0 ? this.clearJobsStages : undefined)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          const count = result.deleted;
          this.toastService.success(count === 1 ? '1 job deleted' : `${count} jobs deleted`);
          this.closeClearJobsDialog();
          this.refreshQueue();
        },
        error: () => {
          this.toastService.error('Failed to clear jobs');
          this.closeClearJobsDialog();
        },
      });
  }

  protected openAddFilesModal(): void {
    this.showAddFilesModal = true;
  }

  protected closeAddFilesModal(): void {
    this.showAddFilesModal = false;
  }

  protected handleJobsCreated(): void {
    this.closeAddFilesModal();
    this.refreshQueue(true); // Refresh with loading indicator
  }

  protected openErrorDetailsModal(job: QueueJob): void {
    this.errorModalData = {
      fileName: job.fileName,
      error: job.error || 'No error details available',
      status: job.status,
      jobId: job.id,
    };
    this.showErrorDetailsModal = true;
  }

  protected closeErrorDetailsModal(): void {
    this.showErrorDetailsModal = false;
    this.errorModalData = null;
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
      case JobStatus.PAUSED:
        return 'fa-pause-circle';
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

  protected getStatusLabel(status: JobStatus | 'ALL'): string {
    if (status === 'ALL') return 'All Jobs';

    const labels: Record<JobStatus, string> = {
      [JobStatus.DETECTED]: 'Detected',
      [JobStatus.HEALTH_CHECK]: 'Health Check',
      [JobStatus.QUEUED]: 'Queued',
      [JobStatus.ENCODING]: 'Encoding',
      [JobStatus.PAUSED]: 'Paused',
      [JobStatus.VERIFYING]: 'Verifying',
      [JobStatus.COMPLETED]: 'Completed',
      [JobStatus.FAILED]: 'Failed',
      [JobStatus.CANCELLED]: 'Cancelled',
    };

    return labels[status] || status;
  }

  protected getStatusExplanation(status: JobStatus): string {
    switch (status) {
      case JobStatus.QUEUED:
        return 'This job is waiting in the queue for an available encoding node. It will start automatically when a node becomes free.';
      case JobStatus.ENCODING:
        return 'This job is currently being encoded by a node. Progress is shown as a percentage. Encoding time depends on file size, quality settings, and node hardware.';
      case JobStatus.PAUSED:
        return 'This job has been paused and encoding has stopped. You can resume it at any time to continue from where it left off.';
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

  /**
   * Format timestamp to human-readable format
   */
  protected formatTimestamp(timestamp: string | null | undefined): string {
    if (!timestamp) return 'N/A';

    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);

    // If less than 1 hour ago, show relative time
    if (diffMins < 60) {
      if (diffMins < 1) return 'Just now';
      if (diffMins === 1) return '1 minute ago';
      return `${diffMins} minutes ago`;
    }

    // Otherwise show formatted date
    const options: Intl.DateTimeFormatOptions = {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    };
    return date.toLocaleDateString('en-US', options);
  }

  /**
   * Calculate expected final file size based on estimated compression
   */
  protected calculateExpectedSize(job: QueueJob): string {
    const compressionPercent = this.getEstimatedCompression(job);
    const expectedSize = job.originalSize * (1 - compressionPercent / 100);
    return this.formatBytes(expectedSize);
  }

  /**
   * Calculate and format expected savings with color coding
   */
  protected calculateExpectedSavings(job: QueueJob): string {
    const compressionPercent = this.getEstimatedCompression(job);
    const savedBytes = job.originalSize * (compressionPercent / 100);
    return `~${this.formatBytes(savedBytes)} (${compressionPercent}%)`;
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
   * Detect if a job appears to be stuck
   * A job is considered stuck if:
   * - It's in ENCODING status
   * - Progress is 0% or hasn't changed
   * - It's been running for more than 5 minutes
   */
  protected isJobStuck(job: QueueJob): boolean {
    if (job.status !== JobStatus.ENCODING || !job.startedAt) {
      return false;
    }

    const startTime = new Date(job.startedAt).getTime();
    const now = Date.now();
    const elapsedMinutes = (now - startTime) / (1000 * 60);

    // Job is stuck if it's been encoding for 5+ minutes with 0% progress
    return elapsedMinutes >= 5 && job.progress === 0;
  }

  /**
   * Get stuck job warning message
   */
  protected getStuckJobMessage(job: QueueJob): string {
    if (!job.startedAt) return 'Job may be stuck';

    const elapsedTime = this.getElapsedTime(job.startedAt);
    return `Job appears stuck - no progress after ${elapsedTime}. The encoding process may have crashed or frozen. Check the error details or retry the job.`;
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
