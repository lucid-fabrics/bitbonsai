import { NgClass } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  EventEmitter,
  Input,
  inject,
  Output,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { TranslocoModule } from '@ngneat/transloco';
import { catchError, of } from 'rxjs';
import { LibrariesClient } from '../../../../core/clients/libraries.client';
import { BytesBo } from '../../../nodes/bos/bytes.bo';
import { DurationBo } from '../../../queue/bos/duration.bo';
import type { LibraryFile, LibraryFiles } from '../../models/library.model';

@Component({
  selector: 'app-library-files-modal',
  standalone: true,
  imports: [NgClass, TranslocoModule],
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
  protected readonly libraryFiles = signal<LibraryFiles | null>(null);
  protected readonly isLoading = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly searchTerm = signal('');
  protected readonly sortBy = signal<'name' | 'size' | 'codec' | 'resolution'>('name');
  protected readonly sortDirection = signal<'asc' | 'desc'>('asc');

  // Derived: filtered and sorted files
  protected readonly filteredFiles = computed<LibraryFile[]>(() => {
    const files = this.libraryFiles()?.files ?? [];
    const term = this.searchTerm().toLowerCase();
    const sortBy = this.sortBy();
    const dir = this.sortDirection();

    const filtered = term ? files.filter((f) => f.fileName.toLowerCase().includes(term)) : files;

    return [...filtered].sort((a, b) => {
      let cmp = 0;
      switch (sortBy) {
        case 'name':
          cmp = a.fileName.localeCompare(b.fileName);
          break;
        case 'size':
          cmp = a.sizeBytes - b.sizeBytes;
          break;
        case 'codec':
          cmp = a.codec.localeCompare(b.codec);
          break;
        case 'resolution':
          cmp = a.resolution.localeCompare(b.resolution);
          break;
      }
      return dir === 'asc' ? cmp : -cmp;
    });
  });

  // Load library files
  private loadLibraryFiles(libraryId: string): void {
    this.isLoading.set(true);
    this.error.set(null);

    this.librariesApi
      .getLibraryFiles(libraryId)
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        catchError((err) => {
          this.isLoading.set(false);
          this.error.set(err?.message || 'Failed to load library files. Please try again.');
          return of(null);
        })
      )
      .subscribe((files) => {
        if (files) {
          this.libraryFiles.set(files);
          this.isLoading.set(false);
        }
      });
  }

  // Sorting
  protected setSortBy(field: 'name' | 'size' | 'codec' | 'resolution'): void {
    if (this.sortBy() === field) {
      this.sortDirection.update((dir) => (dir === 'asc' ? 'desc' : 'asc'));
    } else {
      this.sortBy.set(field);
      this.sortDirection.set('asc');
    }
  }

  protected getSortIcon(field: 'name' | 'size' | 'codec' | 'resolution'): string {
    if (this.sortBy() !== field) return 'fa-sort';
    return this.sortDirection() === 'asc' ? 'fa-sort-up' : 'fa-sort-down';
  }

  // Search
  protected onSearchChange(event: Event): void {
    this.searchTerm.set((event.target as HTMLInputElement).value);
  }

  protected clearSearch(): void {
    this.searchTerm.set('');
  }

  // Modal controls
  protected closeModal(): void {
    if (!this.isLoading()) {
      this.resetModal();
      this.close.emit();
    }
  }

  private resetModal(): void {
    this.libraryFiles.set(null);
    this.isLoading.set(false);
    this.error.set(null);
    this.searchTerm.set('');
    this.sortBy.set('name');
    this.sortDirection.set('asc');
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
