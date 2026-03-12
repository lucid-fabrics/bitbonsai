import { AsyncPipe, NgClass } from '@angular/common';
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
import { TranslocoModule } from '@ngneat/transloco';
import { BehaviorSubject, catchError, of } from 'rxjs';
import { LibrariesClient } from '../../../../core/clients/libraries.client';
import { BytesBo } from '../../../nodes/bos/bytes.bo';
import { DurationBo } from '../../../queue/bos/duration.bo';
import type { LibraryFile, LibraryFiles } from '../../models/library.model';

@Component({
  selector: 'app-library-files-modal',
  standalone: true,
  imports: [AsyncPipe, NgClass, TranslocoModule],
  templateUrl: './library-files-modal.component.html',
  styleUrls: ['./library-files-modal.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LibraryFilesModalComponent {
  private readonly librariesApi = inject(LibrariesClient);
  private readonly destroyRef = inject(DestroyRef);

  @Input() isOpen = false;
  @Input() set libraryId(id: string | null) {
    if (id) {
      this.loadLibraryFiles(id);
    }
  }
  @Output() close = new EventEmitter<void>();

  // Expose BOs for template
  protected readonly BytesBo = BytesBo;
  protected readonly DurationBo = DurationBo;

  // State
  protected libraryFiles$ = new BehaviorSubject<LibraryFiles | null>(null);
  protected isLoading$ = new BehaviorSubject<boolean>(false);
  protected error$ = new BehaviorSubject<string | null>(null);
  protected searchTerm$ = new BehaviorSubject<string>('');
  protected sortBy$ = new BehaviorSubject<'name' | 'size' | 'codec' | 'resolution'>('name');
  protected sortDirection$ = new BehaviorSubject<'asc' | 'desc'>('asc');

  // Load library files
  private loadLibraryFiles(libraryId: string): void {
    this.isLoading$.next(true);
    this.error$.next(null);

    this.librariesApi
      .getLibraryFiles(libraryId)
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        catchError((error) => {
          this.isLoading$.next(false);
          this.error$.next(error?.message || 'Failed to load library files. Please try again.');
          return of(null);
        })
      )
      .subscribe((files) => {
        if (files) {
          this.libraryFiles$.next(files);
          this.isLoading$.next(false);
        }
      });
  }

  // Get filtered and sorted files
  protected getFilteredFiles(): LibraryFile[] {
    const files = this.libraryFiles$.value?.files || [];
    const searchTerm = this.searchTerm$.value.toLowerCase();
    const sortBy = this.sortBy$.value;
    const sortDirection = this.sortDirection$.value;

    // Filter by search term
    let filtered = files;
    if (searchTerm) {
      filtered = files.filter((file) => file.fileName.toLowerCase().includes(searchTerm));
    }

    // Sort
    const sorted = [...filtered].sort((a, b) => {
      let comparison = 0;

      switch (sortBy) {
        case 'name':
          comparison = a.fileName.localeCompare(b.fileName);
          break;
        case 'size':
          comparison = a.sizeBytes - b.sizeBytes;
          break;
        case 'codec':
          comparison = a.codec.localeCompare(b.codec);
          break;
        case 'resolution':
          comparison = a.resolution.localeCompare(b.resolution);
          break;
      }

      return sortDirection === 'asc' ? comparison : -comparison;
    });

    return sorted;
  }

  // Sorting
  protected setSortBy(field: 'name' | 'size' | 'codec' | 'resolution'): void {
    const currentSortBy = this.sortBy$.value;
    const currentDirection = this.sortDirection$.value;

    if (currentSortBy === field) {
      // Toggle direction
      this.sortDirection$.next(currentDirection === 'asc' ? 'desc' : 'asc');
    } else {
      // New field, default to ascending
      this.sortBy$.next(field);
      this.sortDirection$.next('asc');
    }
  }

  protected getSortIcon(field: 'name' | 'size' | 'codec' | 'resolution'): string {
    if (this.sortBy$.value !== field) return 'fa-sort';
    return this.sortDirection$.value === 'asc' ? 'fa-sort-up' : 'fa-sort-down';
  }

  // Search
  protected onSearchChange(event: Event): void {
    const target = event.target as HTMLInputElement;
    this.searchTerm$.next(target.value);
  }

  protected clearSearch(): void {
    this.searchTerm$.next('');
  }

  // Modal controls
  protected closeModal(): void {
    if (!this.isLoading$.value) {
      this.resetModal();
      this.close.emit();
    }
  }

  private resetModal(): void {
    this.libraryFiles$.next(null);
    this.isLoading$.next(false);
    this.error$.next(null);
    this.searchTerm$.next('');
    this.sortBy$.next('name');
    this.sortDirection$.next('asc');
  }

  // Helper methods for file details
  protected getFileCodecBadgeClass(codec: string): string {
    const codecLower = codec.toLowerCase();
    if (codecLower.includes('hevc') || codecLower.includes('h.265')) return 'codec-hevc';
    if (codecLower.includes('av1')) return 'codec-av1';
    if (codecLower.includes('h.264') || codecLower.includes('avc')) return 'codec-h264';
    if (codecLower.includes('vp9')) return 'codec-vp9';
    return 'codec-other';
  }

  protected getHealthStatusClass(status: string): string {
    switch (status) {
      case 'HEALTHY':
        return 'health-healthy';
      case 'WARNING':
        return 'health-warning';
      case 'CORRUPTED':
        return 'health-corrupted';
      default:
        return 'health-unknown';
    }
  }

  protected getHealthStatusIcon(status: string): string {
    switch (status) {
      case 'HEALTHY':
        return 'fa-check-circle';
      case 'WARNING':
        return 'fa-exclamation-triangle';
      case 'CORRUPTED':
        return 'fa-times-circle';
      default:
        return 'fa-question-circle';
    }
  }
}
