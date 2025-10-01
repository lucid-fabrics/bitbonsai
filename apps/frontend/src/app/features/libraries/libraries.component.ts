import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  inject,
  type OnInit,
  signal,
} from '@angular/core';
import type { CreateLibraryDto, Library, UpdateLibraryDto } from '../../core/models/library.model';
import type { Node } from '../../core/models/node.model';
import { LibrariesApiService } from '../../core/services/libraries-api.service';
import { NodesApiService } from '../../core/services/nodes-api.service';
import { ConfirmationDialogComponent } from '../../shared/components/confirmation-dialog/confirmation-dialog.component';
import { LibraryCardComponent } from './components/library-card/library-card.component';
import { LibraryFormComponent } from './components/library-form/library-form.component';

@Component({
  selector: 'app-libraries',
  standalone: true,
  imports: [CommonModule, LibraryCardComponent, LibraryFormComponent, ConfirmationDialogComponent],
  templateUrl: './libraries.component.html',
  styleUrls: ['./libraries.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LibrariesComponent implements OnInit {
  private readonly librariesApi = inject(LibrariesApiService);
  private readonly nodesApi = inject(NodesApiService);
  private readonly cdr = inject(ChangeDetectorRef);

  libraries = signal<Library[]>([]);
  nodes = signal<Node[]>([]);
  isLoading = signal(true);
  error = signal<string | null>(null);

  // Form state
  showForm = signal(false);
  selectedLibrary = signal<Library | undefined>(undefined);

  // Delete confirmation state
  showDeleteDialog = signal(false);
  libraryToDelete = signal<Library | undefined>(undefined);

  // Scan state
  scanningLibraryId = signal<string | null>(null);

  ngOnInit(): void {
    this.loadData();
  }

  private loadData(): void {
    this.isLoading.set(true);
    this.error.set(null);

    // Load both libraries and nodes in parallel
    Promise.all([
      this.librariesApi.getLibraries().toPromise(),
      this.nodesApi.getNodes().toPromise(),
    ])
      .then(([libraries, nodes]) => {
        this.libraries.set(libraries || []);
        this.nodes.set(nodes || []);
        this.isLoading.set(false);
        this.cdr.markForCheck();
      })
      .catch((err) => {
        this.error.set(err.message || 'Failed to load data');
        this.isLoading.set(false);
        this.cdr.markForCheck();
      });
  }

  onAddLibrary(): void {
    this.selectedLibrary.set(undefined);
    this.showForm.set(true);
  }

  onEditLibrary(library: Library): void {
    this.selectedLibrary.set(library);
    this.showForm.set(true);
  }

  onFormSubmit(data: CreateLibraryDto | UpdateLibraryDto): void {
    const selectedLib = this.selectedLibrary();

    if (selectedLib) {
      // Update existing library
      this.librariesApi
        .updateLibrary(selectedLib.id, data as UpdateLibraryDto)
        .toPromise()
        .then(() => {
          this.showForm.set(false);
          this.selectedLibrary.set(undefined);
          this.loadData();
        })
        .catch((err) => {
          this.error.set(err.message || 'Failed to update library');
          this.cdr.markForCheck();
        });
    } else {
      // Create new library
      this.librariesApi
        .createLibrary(data as CreateLibraryDto)
        .toPromise()
        .then(() => {
          this.showForm.set(false);
          this.loadData();
        })
        .catch((err) => {
          this.error.set(err.message || 'Failed to create library');
          this.cdr.markForCheck();
        });
    }
  }

  onFormCancel(): void {
    this.showForm.set(false);
    this.selectedLibrary.set(undefined);
  }

  onDeleteLibrary(library: Library): void {
    this.libraryToDelete.set(library);
    this.showDeleteDialog.set(true);
  }

  onConfirmDelete(): void {
    const library = this.libraryToDelete();
    if (!library) return;

    this.librariesApi
      .deleteLibrary(library.id)
      .toPromise()
      .then(() => {
        this.showDeleteDialog.set(false);
        this.libraryToDelete.set(undefined);
        this.loadData();
      })
      .catch((err) => {
        this.error.set(err.message || 'Failed to delete library');
        this.showDeleteDialog.set(false);
        this.libraryToDelete.set(undefined);
        this.cdr.markForCheck();
      });
  }

  onCancelDelete(): void {
    this.showDeleteDialog.set(false);
    this.libraryToDelete.set(undefined);
  }

  onScanLibrary(library: Library): void {
    this.scanningLibraryId.set(library.id);

    this.librariesApi
      .scanLibrary(library.id)
      .toPromise()
      .then(() => {
        this.scanningLibraryId.set(null);
        this.loadData();
      })
      .catch((err) => {
        this.error.set(err.message || 'Failed to scan library');
        this.scanningLibraryId.set(null);
        this.cdr.markForCheck();
      });
  }

  isScanning(libraryId: string): boolean {
    return this.scanningLibraryId() === libraryId;
  }

  get hasLibraries(): boolean {
    return this.libraries().length > 0;
  }

  get totalLibraries(): number {
    return this.libraries().length;
  }
}
