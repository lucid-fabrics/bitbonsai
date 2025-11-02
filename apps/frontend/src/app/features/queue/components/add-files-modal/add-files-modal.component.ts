import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  EventEmitter,
  Input,
  inject,
  Output,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { BehaviorSubject, catchError, map, Observable, of, shareReplay } from 'rxjs';
import { LibrariesClient } from '../../../../core/clients/libraries.client';
import type {
  BulkJobCreationResult,
  CreateJobsFromScanDto,
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
export class AddFilesModalComponent {
  private readonly librariesApi = inject(LibrariesClient);
  private readonly destroyRef = inject(DestroyRef);

  @Input() isOpen = false;
  @Output() close = new EventEmitter<void>();
  @Output() jobsCreated = new EventEmitter<{ jobsCreated: number }>();

  // Expose BOs for template
  protected readonly BytesBo = BytesBo;

  // View mode state
  protected viewMode$ = new BehaviorSubject<ViewMode>('library-selection');

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
  }

  // Library selection methods
  protected selectLibrary(preview: ScanPreview): void {
    this.selectedLibrary$.next(preview);
    // Auto-select default policy
    if (preview.policyId) {
      this.selectedPolicyId$.next(preview.policyId);
    }

    // Select all files by default
    const allFilePaths = new Set(preview.needsEncoding.map((file) => file.filePath));
    this.selectedFiles$.next(allFilePaths);

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

    const allFilePaths = new Set(library.needsEncoding.map((file) => file.filePath));
    this.selectedFiles$.next(allFilePaths);
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
        next: (result: any) => {
          this.isCreatingJobs$.next(false);
          const bulkResult: BulkJobCreationResult = {
            jobsCreated: result.jobsCreated || 0,
            filesSkipped: result.filesSkipped || 0,
            skippedFiles: result.skippedFiles || [],
          };
          this.creationResult$.next(bulkResult);
          this.viewMode$.next('results');
          this.jobsCreated.emit({ jobsCreated: bulkResult.jobsCreated });
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
