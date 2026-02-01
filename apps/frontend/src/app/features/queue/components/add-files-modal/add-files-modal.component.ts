import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  EventEmitter,
  Input,
  inject,
  OnDestroy,
  Output,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import {
  BehaviorSubject,
  catchError,
  interval,
  map,
  Observable,
  of,
  Subject,
  shareReplay,
  switchMap,
  takeUntil,
} from 'rxjs';
import type { CacheMetadata } from '../../../../core/clients/libraries.client';
import { LibrariesClient } from '../../../../core/clients/libraries.client';
import type {
  BulkJobCreationResult,
  CreateJobsFromScanDto,
  CreateJobsFromScanResult,
  ScanPreview,
  VideoFile,
} from '../../../libraries/models/library.model';
import { BytesBo } from '../../../nodes/bos/bytes.bo';

type ViewMode = 'library-selection' | 'file-selection' | 'creating-jobs' | 'results';

@Component({
  selector: 'app-add-files-modal',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './add-files-modal.component.html',
  styleUrls: ['./add-files-modal.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AddFilesModalComponent implements OnDestroy {
  private readonly librariesApi = inject(LibrariesClient);
  private readonly destroyRef = inject(DestroyRef);
  private readonly destroy$ = new Subject<void>();

  @Input() isOpen = false;
  @Output() close = new EventEmitter<void>();
  @Output() jobsCreated = new EventEmitter<{ jobsCreated: number }>();

  // Expose BOs for template
  protected readonly BytesBo = BytesBo;

  // View mode state
  protected viewMode$ = new BehaviorSubject<ViewMode>('library-selection');

  // Cache state
  protected cacheMetadata$ = new BehaviorSubject<CacheMetadata | null>(null);
  protected cacheAgeDisplay$ = new BehaviorSubject<string>('Loading...');
  protected isRefreshing$ = new BehaviorSubject<boolean>(false);

  // Library selection state
  protected readonly libraryPreviews$: Observable<ScanPreview[]>;
  protected readonly isLoadingLibraries$ = new BehaviorSubject<boolean>(true);
  protected readonly librariesError$ = new BehaviorSubject<string | null>(null);

  // File selection state
  protected selectedLibrary$ = new BehaviorSubject<ScanPreview | null>(null);
  protected selectedPolicyId$ = new BehaviorSubject<string | null>(null);
  protected selectedFiles$ = new BehaviorSubject<Set<string>>(new Set());
  protected isLoadingFiles$ = new BehaviorSubject<boolean>(false);

  // Job creation state
  protected isCreatingJobs$ = new BehaviorSubject<boolean>(false);
  protected creationResult$ = new BehaviorSubject<BulkJobCreationResult | null>(null);
  protected creationError$ = new BehaviorSubject<string | null>(null);

  constructor() {
    // Fetch all ready-to-queue files across all libraries
    this.libraryPreviews$ = this.librariesApi.getAllReadyFiles().pipe(
      map((previews) => {
        this.isLoadingLibraries$.next(false);
        // Filter to only libraries with files that need encoding
        return previews.filter((preview) => preview.needsEncodingCount > 0);
      }),
      catchError((error) => {
        this.isLoadingLibraries$.next(false);
        this.librariesError$.next(error?.message || 'Failed to load libraries. Please try again.');
        return of([]);
      }),
      shareReplay(1) // Cache the result and share among all subscribers
    );

    // Load cache metadata on init
    this.loadCacheMetadata();

    // Update cache age display every second
    interval(1000)
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => {
        this.updateCacheAgeDisplay();
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private loadCacheMetadata(): void {
    this.librariesApi
      .getReadyFilesCacheMetadata()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (metadata) => {
          this.cacheMetadata$.next(metadata);
          this.updateCacheAgeDisplay();
        },
        error: () => {
          this.cacheMetadata$.next(null);
        },
      });
  }

  private updateCacheAgeDisplay(): void {
    const metadata = this.cacheMetadata$.value;
    if (!metadata) {
      this.cacheAgeDisplay$.next('Unknown');
      return;
    }

    const ageSeconds = metadata.cacheAgeSeconds;

    // If cache has never been populated (age = 0)
    if (ageSeconds === 0) {
      this.cacheAgeDisplay$.next('Not cached');
      return;
    }

    if (ageSeconds < 5) {
      this.cacheAgeDisplay$.next('Fresh');
    } else if (ageSeconds < 60) {
      this.cacheAgeDisplay$.next(`${ageSeconds}s ago`);
    } else {
      const minutes = Math.floor(ageSeconds / 60);
      const seconds = ageSeconds % 60;
      this.cacheAgeDisplay$.next(`${minutes}m ${seconds}s ago`);
    }
  }

  protected refreshCache(): void {
    if (this.isRefreshing$.value) return;

    this.isRefreshing$.next(true);

    this.librariesApi
      .refreshReadyFilesCache()
      .pipe(
        switchMap(() => this.librariesApi.getAllReadyFiles()),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe({
        next: (_previews) => {
          this.isRefreshing$.next(false);
          // Update library previews by re-emitting the stream
          this.isLoadingLibraries$.next(false);
          // Reload cache metadata
          this.loadCacheMetadata();
          // Force reload of library previews
          window.location.reload();
        },
        error: (error) => {
          this.isRefreshing$.next(false);
          this.librariesError$.next(error?.message || 'Failed to refresh cache. Please try again.');
        },
      });
  }

  // Library selection methods
  protected selectLibrary(preview: ScanPreview): void {
    this.selectedLibrary$.next(preview);
    // Auto-select default policy
    if (preview.policyId) {
      this.selectedPolicyId$.next(preview.policyId);
    }

    // Select only files that can be added to queue (exclude already encoded, in progress, etc.)
    const selectableFilePaths = new Set(
      preview.needsEncoding.filter((file) => file.canAddToQueue).map((file) => file.filePath)
    );
    this.selectedFiles$.next(selectableFilePaths);

    // Switch to file selection view
    this.viewMode$.next('file-selection');
  }

  protected backToLibrarySelection(): void {
    this.selectedLibrary$.next(null);
    this.selectedPolicyId$.next(null);
    this.selectedFiles$.next(new Set());
    this.viewMode$.next('library-selection');
  }

  // File selection methods
  protected toggleFileSelection(filePath: string): void {
    const currentSelection = this.selectedFiles$.value;
    const newSelection = new Set(currentSelection);

    if (newSelection.has(filePath)) {
      newSelection.delete(filePath);
    } else {
      newSelection.add(filePath);
    }

    this.selectedFiles$.next(newSelection);
  }

  protected isFileSelected(filePath: string): boolean {
    return this.selectedFiles$.value.has(filePath);
  }

  protected selectAllFiles(): void {
    const library = this.selectedLibrary$.value;
    if (!library) return;

    // Only select files that can be added to queue
    const selectableFilePaths = new Set(
      library.needsEncoding.filter((file) => file.canAddToQueue).map((file) => file.filePath)
    );
    this.selectedFiles$.next(selectableFilePaths);
  }

  protected deselectAllFiles(): void {
    this.selectedFiles$.next(new Set());
  }

  protected getSelectedFileCount(): number {
    return this.selectedFiles$.value.size;
  }

  protected getTotalFileCount(): number {
    return this.selectedLibrary$.value?.needsEncoding.length || 0;
  }

  protected canAddToQueue(): boolean {
    return (
      this.selectedLibrary$.value !== null &&
      this.selectedPolicyId$.value !== null &&
      this.getSelectedFileCount() > 0
    );
  }

  // Job creation methods
  protected addToQueue(): void {
    const library = this.selectedLibrary$.value;
    const policyId = this.selectedPolicyId$.value;
    const selectedFiles = Array.from(this.selectedFiles$.value);

    if (!library || !policyId || selectedFiles.length === 0) {
      return;
    }

    this.isCreatingJobs$.next(true);
    this.viewMode$.next('creating-jobs');
    this.creationError$.next(null);

    const dto: CreateJobsFromScanDto = {
      policyId,
      filePaths: selectedFiles,
    };

    this.librariesApi
      .createJobsFromScan(library.libraryId, dto)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result: CreateJobsFromScanResult) => {
          this.isCreatingJobs$.next(false);
          const bulkResult: BulkJobCreationResult = {
            jobsCreated: result.jobsCreated,
            filesSkipped: 0,
            skippedFiles: [],
          };
          this.creationResult$.next(bulkResult);
          this.viewMode$.next('results');
          this.jobsCreated.emit({ jobsCreated: result.jobsCreated });
        },
        error: (error) => {
          this.isCreatingJobs$.next(false);
          this.creationError$.next(error?.message || 'Failed to create jobs. Please try again.');
          this.viewMode$.next('file-selection');
        },
      });
  }

  // Modal controls
  protected closeModal(): void {
    if (!this.isCreatingJobs$.value) {
      this.resetModal();
      this.close.emit();
    }
  }

  protected resetModal(): void {
    this.viewMode$.next('library-selection');
    this.selectedLibrary$.next(null);
    this.selectedPolicyId$.next(null);
    this.selectedFiles$.next(new Set());
    this.isCreatingJobs$.next(false);
    this.creationResult$.next(null);
    this.creationError$.next(null);
    // Don't reset isLoadingLibraries - shareReplay will use cached data
  }

  protected viewQueue(): void {
    this.closeModal();
  }

  // Helper methods for file details
  protected getFileCodecBadgeClass(file: VideoFile): string {
    const codec = file.codec.toLowerCase();
    if (codec.includes('hevc') || codec.includes('h.265')) return 'codec-hevc';
    if (codec.includes('av1')) return 'codec-av1';
    if (codec.includes('h.264') || codec.includes('avc')) return 'codec-h264';
    if (codec.includes('vp9')) return 'codec-vp9';
    return 'codec-other';
  }
}
