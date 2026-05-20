import { AsyncPipe, DecimalPipe, KeyValuePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, inject, type OnInit } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { CarouselImage, ImageCarouselComponent } from '@bitbonsai/shared-ui';
import { FontAwesomeModule } from '@fortawesome/angular-fontawesome';
import { faBolt, faFire, faLayerGroup } from '@fortawesome/pro-solid-svg-icons';
import { TranslocoModule } from '@ngneat/transloco';
import type { NodeCapacity } from '../../core/clients/distribution.client';
import { FileHealthStatus } from '../../features/libraries/models/library.model';
import { DiskSpaceWarningBannerComponent } from '../../shared/components/disk-space-warning-banner/disk-space-warning-banner.component';
import { RichTooltipDirective } from '../../shared/directives/rich-tooltip.directive';
import type { QueueJobBo } from './bos/queue-job.bo';
import { AddFilesModalComponent } from './components/add-files-modal/add-files-modal.component';
import { DecisionIssueCardComponent } from './components/decision-issue-card/decision-issue-card.component';
import { ErrorDetailsModalComponent } from './components/error-details-modal/error-details-modal.component';
import { JobHistoryModalComponent } from './components/job-history-modal/job-history-modal.component';
import type {
  HealthCheckIssue,
  HealthCheckSuggestedAction,
} from './models/health-check-issue.model';
import type { JobHistoryEvent } from './models/job-history-event.model';
import { JobEventType } from './models/job-history-event.model';
import { JobStatus } from './models/job-status.enum';
import type { QueueJob } from './models/queue-job.model';
import type { QueueResponse } from './models/queue-response.model';
import { CodecBadgeClassPipe } from './pipes/codec-badge-class.pipe';
import { StatusClassPipe } from './pipes/status-class.pipe';
import { QueueDataService } from './services/queue-data.service';
import { QueueDisplayService } from './services/queue-display.service';
import { QueueJobActionsService } from './services/queue-job-actions.service';

@Component({
  selector: 'app-queue',
  standalone: true,
  imports: [
    AsyncPipe,
    DecimalPipe,
    KeyValuePipe,
    FormsModule,
    FontAwesomeModule,
    TranslocoModule,
    DiskSpaceWarningBannerComponent,
    RichTooltipDirective,
    AddFilesModalComponent,
    ErrorDetailsModalComponent,
    JobHistoryModalComponent,
    ImageCarouselComponent,
    DecisionIssueCardComponent,
    // PERFORMANCE: Pure pipes for better change detection performance
    StatusClassPipe,
    CodecBadgeClassPipe,
  ],
  templateUrl: './queue.page.html',
  styleUrls: ['./queue.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class QueueComponent implements OnInit {
  protected readonly queueData = inject(QueueDataService);
  protected readonly display = inject(QueueDisplayService);
  private readonly jobActions = inject(QueueJobActionsService);
  private readonly destroyRef = inject(DestroyRef);

  // Template aliases for service observables
  protected get queueData$() {
    return this.queueData.queueData$;
  }
  protected get nodeCapacity$() {
    return this.queueData.nodeCapacity$;
  }
  protected get availableLibraries$() {
    return this.queueData.availableLibraries$;
  }
  protected get availableNodes$() {
    return this.queueData.availableNodes$;
  }
  protected get availableNodesWithRole$() {
    return this.queueData.availableNodesWithRole$;
  }
  protected get isLoading$() {
    return this.queueData.isLoading$;
  }
  protected get isMainNode$() {
    return this.queueData.isMainNode$;
  }

  // Expose Number for template
  protected readonly Number = Number;

  // FontAwesome icons for priority
  protected readonly icons = {
    fire: faFire,
    bolt: faBolt,
    layers: faLayerGroup,
  };

  // Expose Math for template
  protected readonly Math = Math;

  // Expose FileHealthStatus enum for template
  protected readonly FileHealthStatus = FileHealthStatus;

  // Expose JobStatus enum for template
  protected readonly JobStatus = JobStatus;

  // Expose JobEventType enum for template
  protected readonly JobEventType = JobEventType;

  // UI-only state (not delegatable)
  protected expandedJobId: string | null = null;
  protected openPriorityMenuId: string | null = null;
  protected showCancelDialog = false;
  protected showCancelAllDialog = false;
  protected showRetryAllDialog = false;
  protected showRetryFailedDialog = false;
  protected retryFailedSelectedError: string | null = null;
  protected showSkipCodecMatchDialog = false;
  protected showForceEncodeCodecMatchDialog = false;
  protected showClearJobsDialog = false;
  protected clearJobsStages: string[] = [];
  protected cancelDialogLoading = false;
  protected selectedJobId: string | null = null;
  protected showAddFilesModal = false;
  protected showErrorDetailsModal = false;
  protected errorModalData: {
    fileName: string;
    error: string;
    status: string;
    jobId: string;
  } | null = null;
  protected showJobHistoryModal = false;
  protected jobHistoryModalData: {
    fileName: string;
    jobId: string;
    history: JobHistoryEvent[];
  } | null = null;

  // Job history cache (jobId -> history events)
  // DEEP AUDIT P2: Limited to prevent unbounded memory growth
  protected jobHistoryCache = new Map<string, JobHistoryEvent[]>();
  private readonly JOB_HISTORY_CACHE_MAX_SIZE = 50;

  // Manual preview capture state
  protected capturingJobId: string | null = null;

  // Fullscreen carousel state
  protected showFullscreenCarousel = false;
  protected fullscreenCarouselImages: CarouselImage[] = [];
  protected fullscreenCarouselInitialIndex = 0;

  ngOnInit(): void {
    this.queueData.init(this.destroyRef);
  }

  // ============================================================================
  // FILTER / PAGINATION — delegate to QueueDataService
  // ============================================================================

  protected get selectedStatus(): JobStatus | 'ALL' {
    return this.queueData.selectedStatus;
  }
  protected set selectedStatus(v: JobStatus | 'ALL') {
    this.queueData.selectedStatus = v;
  }
  protected get selectedNodeId(): string {
    return this.queueData.selectedNodeId;
  }
  protected set selectedNodeId(v: string) {
    this.queueData.selectedNodeId = v;
  }
  protected get selectedLibraryId(): string {
    return this.queueData.selectedLibraryId;
  }
  protected set selectedLibraryId(v: string) {
    this.queueData.selectedLibraryId = v;
  }
  protected get searchQuery(): string {
    return this.queueData.searchQuery;
  }
  protected set searchQuery(v: string) {
    this.queueData.searchQuery = v;
  }
  protected get currentPage(): number {
    return this.queueData.currentPage;
  }
  protected get pageSize(): number {
    return this.queueData.pageSize;
  }
  protected get statuses(): Array<JobStatus | 'ALL'> {
    return this.queueData.statuses;
  }
  protected get advancedMode() {
    return this.queueData.advancedMode;
  }

  protected onStatusFilterChange(status: JobStatus | 'ALL'): void {
    this.queueData.onStatusFilterChange(status, this.destroyRef);
  }

  protected onNodeFilterChange(nodeId: string): void {
    this.queueData.onNodeFilterChange(nodeId);
  }

  protected onLibraryFilterChange(libraryId: string): void {
    this.queueData.onLibraryFilterChange(libraryId);
  }

  protected onSearchChange(query: string): void {
    this.queueData.onSearchChange(query);
  }

  // ============================================================================
  // DISPLAY DELEGATES — forward to QueueDisplayService
  // ============================================================================

  protected getStatusIcon(status: JobStatus): string {
    return this.display.getStatusIcon(status);
  }
  protected getStatusLabel(status: JobStatus | 'ALL'): string {
    return this.display.getStatusLabel(status);
  }
  protected getStatusExplanation(status: JobStatus): string {
    return this.display.getStatusExplanation(status);
  }
  protected formatBytes(bytes: number): string {
    return this.display.formatBytes(bytes);
  }
  protected wasHealedFreshStart(job: QueueJob): boolean {
    return this.display.wasHealedFreshStart(job);
  }
  protected wasHealedWithResume(job: QueueJob): boolean {
    return this.display.wasHealedWithResume(job);
  }
  protected getNodeStatusClass(node: NodeCapacity): string {
    return this.display.getNodeStatusClass(node);
  }
  protected getNodeStatusIcon(node: NodeCapacity): string {
    return this.display.getNodeStatusIcon(node);
  }
  protected getNodeStatusLabel(node: NodeCapacity): string {
    return this.display.getNodeStatusLabel(node);
  }
  protected getNodeTooltipContent(node: NodeCapacity): string {
    return this.display.getNodeTooltipContent(node);
  }
  protected formatETA(eta: number | null | undefined): string {
    return this.display.formatETA(eta);
  }
  protected formatTimestamp(ts: string | null | undefined): string {
    return this.display.formatTimestamp(ts);
  }
  protected formatRelativeTime(ts: string | null | undefined): string {
    return this.display.formatRelativeTime(ts);
  }
  protected getElapsedTime(startedAt?: string): string {
    return this.display.getElapsedTime(startedAt);
  }
  protected getEncodingDuration(startedAt?: string, completedAt?: string): string {
    return this.display.getEncodingDuration(startedAt, completedAt);
  }
  protected getEstimatedCompression(job: { sourceCodec?: string; targetCodec?: string }): number {
    return this.display.getEstimatedCompression(job);
  }
  protected getEstimatedSize(job: {
    originalSize: number;
    sourceCodec?: string;
    targetCodec?: string;
  }): number {
    return this.display.getEstimatedSize(job);
  }
  protected calculateExpectedSavings(job: QueueJob): string {
    return this.display.calculateExpectedSavings(job);
  }
  protected calculateExpectedSize(job: QueueJob): string {
    return this.display.calculateExpectedSize(job);
  }
  protected isJobStuck(job: QueueJob): boolean {
    return this.display.isJobStuck(job);
  }
  protected getStuckJobMessage(job: QueueJob, advanced = false): string {
    return this.display.getStuckJobMessage(job, advanced);
  }
  protected hasRecoveryHistory(job: QueueJob): boolean {
    return this.display.hasRecoveryHistory(job);
  }
  protected getRecoveryTooltip(job: QueueJob): string {
    return this.display.getRecoveryTooltip(job);
  }
  protected isApproachingBlacklist(job: QueueJob): boolean {
    return this.display.isApproachingBlacklist(job);
  }
  protected getShortFailureReason(error: string | null | undefined): string {
    return this.display.getShortFailureReason(error);
  }
  protected getStorageAccessType(
    job: { transferRequired?: boolean; nodeId?: string },
    nodes: import('../nodes/models/node.model').Node[]
  ): 'local' | 'nfs' | 'copied' {
    return this.display.getStorageAccessType(job, nodes);
  }
  protected formatAbsoluteDateTime(ts: string | null | undefined): string {
    return this.display.formatAbsoluteDateTime(ts);
  }
  protected calculateEncodingSpeed(job: {
    startedAt?: string;
    currentSize: number;
    originalSize: number;
  }): string {
    return this.display.calculateEncodingSpeed(job);
  }
  protected calculateEstimatedTime(totalSizeBytes: number): { hours: number; minutes: number } {
    return this.display.calculateEstimatedTime(totalSizeBytes);
  }
  protected getAvgEncodingSpeed(): number {
    return this.display.getAvgEncodingSpeed();
  }
  protected getUniqueFailureReasons(
    data: QueueResponse
  ): Array<{ error: string; count: number; category: string }> {
    return this.display.getUniqueFailureReasons(data);
  }
  protected getFilteredFailedJobs(
    data: QueueResponse,
    errorFilter: string | null
  ): QueueResponse['jobs'] {
    return this.display.getFilteredFailedJobs(data, errorFilter);
  }
  protected getCancelledJobs(data: QueueResponse): QueueResponse['jobs'] {
    return this.display.getCancelledJobs(data);
  }
  protected getFailedJobs(data: QueueResponse): QueueResponse['jobs'] {
    return this.display.getFailedJobs(data);
  }
  protected calculateTotalSize(jobs: QueueResponse['jobs']): number {
    return this.display.calculateTotalSize(jobs);
  }
  protected parseDecisionIssues(
    json: string | null | undefined
  ): import('./models/health-check-issue.model').HealthCheckIssue[] {
    return this.display.parseDecisionIssues(json);
  }
  protected parsePreviewImages(
    paths: string | null | undefined,
    jobId: string
  ): import('@bitbonsai/shared-ui').CarouselImage[] {
    return this.display.parsePreviewImages(paths, jobId);
  }

  protected clearAllFilters(): void {
    this.queueData.clearAllFilters();
  }

  protected refreshQueue(showLoading = false): void {
    this.queueData.refreshQueue(showLoading);
  }

  protected onPageSizeChange(newSize: number): void {
    this.queueData.onPageSizeChange(newSize);
  }

  protected goToPage(page: number): void {
    this.queueData.goToPage(page);
  }

  protected nextPage(): void {
    this.queueData.goToPage(this.queueData.currentPage + 1);
  }

  protected previousPage(): void {
    this.queueData.goToPage(this.queueData.currentPage - 1);
  }

  // ============================================================================
  // JOB DETAIL EXPANSION & HISTORY CACHE
  // ============================================================================

  protected toggleJobDetails(jobId: string): void {
    this.expandedJobId = this.expandedJobId === jobId ? null : jobId;

    if (this.expandedJobId && !this.jobHistoryCache.has(jobId)) {
      this.jobActions
        .loadJobHistory(jobId)
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe((history) => {
          this.maintainCacheSize();
          this.jobHistoryCache.set(jobId, history);
        });
    }
  }

  /**
   * DEEP AUDIT P2: Maintain cache size to prevent unbounded memory growth
   */
  private maintainCacheSize(): void {
    if (this.jobHistoryCache.size >= this.JOB_HISTORY_CACHE_MAX_SIZE) {
      const firstKey = this.jobHistoryCache.keys().next().value;
      if (firstKey) this.jobHistoryCache.delete(firstKey);
    }
  }

  // ============================================================================
  // CANCEL DIALOG
  // ============================================================================

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

    this.cancelDialogLoading = true;
    this.jobActions
      .cancelJob(jobId, false)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.cancelDialogLoading = false;
          this.closeCancelDialog();
          this.refreshQueue();
        },
        complete: () => {
          this.cancelDialogLoading = false;
          this.closeCancelDialog();
        },
      });
  }

  protected confirmCancelAndBlacklist(): void {
    const jobId = this.selectedJobId;
    if (!jobId) return;

    this.cancelDialogLoading = true;
    this.jobActions
      .cancelJob(jobId, true)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.cancelDialogLoading = false;
          this.closeCancelDialog();
          this.refreshQueue();
        },
        complete: () => {
          this.cancelDialogLoading = false;
          this.closeCancelDialog();
        },
      });
  }

  // ============================================================================
  // JOB ACTIONS
  // ============================================================================

  protected retryJob(jobId: string, event: Event): void {
    event.stopPropagation();
    this.jobActions
      .retryJob(jobId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.refreshQueue());
  }

  protected unblockJob(jobId: string, event: Event): void {
    event.stopPropagation();
    this.jobActions
      .unblockJob(jobId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.refreshQueue(false));
  }

  protected recheckJob(jobId: string, event: Event): void {
    event.stopPropagation();
    this.jobActions
      .recheckJob(jobId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.refreshQueue());
  }

  protected detectAndRequeue(jobId: string, event: Event): void {
    event.stopPropagation();
    this.jobActions
      .detectAndRequeue(jobId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.refreshQueue());
  }

  protected deleteJob(job: QueueJobBo, event: Event): void {
    event.stopPropagation();
    this.jobActions
      .deleteJob(job)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.refreshQueue());
  }

  protected togglePriorityMenu(jobId: string): void {
    this.openPriorityMenuId = this.openPriorityMenuId === jobId ? null : jobId;
  }

  protected setPriority(jobId: string, priority: number, event: Event): void {
    event.stopPropagation();
    this.openPriorityMenuId = null;
    this.jobActions
      .setPriority(jobId, priority)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.refreshQueue());
  }

  protected pauseJob(jobId: string, event: Event): void {
    event.stopPropagation();
    this.jobActions
      .pauseJob(jobId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.refreshQueue());
  }

  protected resumeJob(jobId: string, event: Event): void {
    event.stopPropagation();
    this.jobActions
      .resumeJob(jobId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.refreshQueue());
  }

  protected captureCurrentFrame(jobId: string, event: Event): void {
    event.stopPropagation();
    this.capturingJobId = jobId;
    this.jobActions
      .captureCurrentFrame(jobId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.capturingJobId = null;
          this.refreshQueue();
        },
        complete: () => {
          this.capturingJobId = null;
        },
      });
  }

  protected forceStartJob(jobId: string, event: Event): void {
    event.stopPropagation();
    this.jobActions
      .forceStartJob(jobId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.refreshQueue());
  }

  protected keepOriginal(job: QueueJob, event: Event): void {
    event.stopPropagation();
    this.jobActions
      .keepOriginal(job)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.refreshQueue());
  }

  protected deleteOriginal(job: QueueJob, event: Event): void {
    event.stopPropagation();
    this.jobActions
      .deleteOriginal(job)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.refreshQueue());
  }

  protected restoreOriginal(job: QueueJob, event: Event): void {
    event.stopPropagation();
    this.jobActions
      .restoreOriginal(job)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.refreshQueue());
  }

  // ============================================================================
  // BULK ACTION DIALOGS
  // ============================================================================

  protected openCancelAllDialog(): void {
    this.showCancelAllDialog = true;
  }
  protected closeCancelAllDialog(): void {
    this.showCancelAllDialog = false;
  }

  protected confirmCancelAll(): void {
    this.jobActions
      .cancelAllQueued()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.closeCancelAllDialog();
          this.refreshQueue();
        },
        complete: () => this.closeCancelAllDialog(),
      });
  }

  protected openSkipCodecMatchDialog(): void {
    this.showSkipCodecMatchDialog = true;
  }
  protected closeSkipCodecMatchDialog(): void {
    this.showSkipCodecMatchDialog = false;
  }

  protected confirmSkipCodecMatch(): void {
    this.jobActions
      .skipAllCodecMatch()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.closeSkipCodecMatchDialog();
          this.refreshQueue();
        },
        complete: () => this.closeSkipCodecMatchDialog(),
      });
  }

  protected openForceEncodeCodecMatchDialog(): void {
    this.showForceEncodeCodecMatchDialog = true;
  }
  protected closeForceEncodeCodecMatchDialog(): void {
    this.showForceEncodeCodecMatchDialog = false;
  }

  protected confirmForceEncodeCodecMatch(): void {
    this.jobActions
      .forceEncodeAllCodecMatch()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.closeForceEncodeCodecMatchDialog();
          this.refreshQueue();
        },
        complete: () => this.closeForceEncodeCodecMatchDialog(),
      });
  }

  protected openRetryAllDialog(): void {
    this.showRetryAllDialog = true;
  }
  protected closeRetryAllDialog(): void {
    this.showRetryAllDialog = false;
  }

  protected confirmRetryAll(): void {
    this.jobActions
      .retryAllCancelled()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.closeRetryAllDialog();
          this.refreshQueue();
        },
        complete: () => this.closeRetryAllDialog(),
      });
  }

  protected openRetryFailedDialog(): void {
    this.retryFailedSelectedError = null;
    this.showRetryFailedDialog = true;
  }

  protected closeRetryFailedDialog(): void {
    this.showRetryFailedDialog = false;
    this.retryFailedSelectedError = null;
  }

  protected confirmRetryFailed(): void {
    this.jobActions
      .retryAllFailed(this.retryFailedSelectedError || undefined)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.closeRetryFailedDialog();
          this.refreshQueue();
        },
        complete: () => this.closeRetryFailedDialog(),
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
    this.jobActions
      .clearJobs(this.clearJobsStages.length > 0 ? this.clearJobsStages : undefined)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.closeClearJobsDialog();
          this.refreshQueue();
        },
        complete: () => this.closeClearJobsDialog(),
      });
  }

  protected rebalanceJobs(): void {
    this.jobActions
      .rebalanceJobs()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.refreshQueue());
  }

  // ============================================================================
  // MODALS
  // ============================================================================

  protected openAddFilesModal(): void {
    this.showAddFilesModal = true;
  }
  protected closeAddFilesModal(): void {
    this.showAddFilesModal = false;
  }

  protected handleJobsCreated(): void {
    this.closeAddFilesModal();
    this.refreshQueue(true);
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

  protected openJobHistoryModal(job: QueueJobBo, event: Event): void {
    event.stopPropagation();

    if (!this.jobHistoryCache.has(job.id)) {
      this.jobActions
        .loadJobHistory(job.id)
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe((history) => {
          this.maintainCacheSize();
          this.jobHistoryCache.set(job.id, history);
          this.jobHistoryModalData = { fileName: job.fileName, jobId: job.id, history };
          this.showJobHistoryModal = true;
        });
    } else {
      this.jobHistoryModalData = {
        fileName: job.fileName,
        jobId: job.id,
        history: this.jobHistoryCache.get(job.id) || [],
      };
      this.showJobHistoryModal = true;
    }
  }

  protected closeJobHistoryModal(): void {
    this.showJobHistoryModal = false;
    this.jobHistoryModalData = null;
  }

  // ============================================================================
  // DECISION ACTIONS
  // ============================================================================

  protected async onDecisionActionSelected(event: {
    issue: HealthCheckIssue;
    action: HealthCheckSuggestedAction;
  }): Promise<void> {
    const jobId = this.expandedJobId;
    if (!jobId) return;
    await this.jobActions.resolveDecision(jobId, event);
    this.refreshQueue();
  }

  // ============================================================================
  // DELEGATION
  // ============================================================================

  protected openDelegationDialog(job: QueueJobBo, event: Event): void {
    event.stopPropagation();
    this.jobActions
      .openDelegationDialog(job)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((delegated) => {
        if (delegated) this.refreshQueue();
      });
  }

  // ============================================================================
  // CAROUSEL
  // ============================================================================

  protected openFullscreenCarousel(
    jobId: string,
    paths: string | null | undefined,
    initialIndex = 0
  ): void {
    this.fullscreenCarouselImages = this.display.parsePreviewImages(paths, jobId);
    this.fullscreenCarouselInitialIndex = initialIndex;
    this.showFullscreenCarousel = true;
  }

  protected closeFullscreenCarousel(): void {
    this.showFullscreenCarousel = false;
    this.fullscreenCarouselImages = [];
    this.fullscreenCarouselInitialIndex = 0;
  }
}
