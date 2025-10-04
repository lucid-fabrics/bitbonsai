import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  inject,
  type OnInit,
  signal,
} from '@angular/core';
import { Store } from '@ngrx/store';
import type { CreateLibraryDto, Library, UpdateLibraryDto } from './models/library.model';
import { ConfirmationDialogComponent } from '../../shared/components/confirmation-dialog/confirmation-dialog.modal';
import { LibraryCardComponent } from './components/library-card/library-card.component';
import { LibraryFormComponent } from './components/library-form/library-form.component';
import { LibrariesActions } from './+state/libraries.actions';
import { selectAllLibraries, selectLibrariesLoading, selectLibrariesError } from './+state/libraries.selectors';
import { NodesActions } from '../nodes/+state/nodes.actions';
import { NodesSelectors } from '../nodes/+state/nodes.selectors';

@Component({
  selector: 'app-libraries',
  standalone: true,
  imports: [CommonModule, LibraryCardComponent, LibraryFormComponent, ConfirmationDialogComponent],
  templateUrl: './libraries.page.html',
  styleUrls: ['./libraries.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LibrariesComponent implements OnInit {
  private readonly store = inject(Store);

  // NgRx State
  readonly libraries$ = this.store.select(selectAllLibraries);
  readonly nodes$ = this.store.select(NodesSelectors.selectAllNodes);
  readonly isLoading$ = this.store.select(selectLibrariesLoading);
  readonly error$ = this.store.select(selectLibrariesError);

  // Form state
  showForm = signal(false);
  selectedLibrary = signal<Library | undefined>(undefined);

  // Delete confirmation state
  showDeleteDialog = signal(false);
  libraryToDelete = signal<Library | undefined>(undefined);

  // Scan state
  scanningLibraryId = signal<string | null>(null);

  ngOnInit(): void {
    this.store.dispatch(LibrariesActions.loadLibraries());
    this.store.dispatch(NodesActions.loadNodes());
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
      this.store.dispatch(LibrariesActions.updateLibrary({
        id: selectedLib.id,
        library: data as UpdateLibraryDto
      }));
    } else {
      // Create new library
      this.store.dispatch(LibrariesActions.createLibrary({
        library: data as CreateLibraryDto
      }));
    }

    this.showForm.set(false);
    this.selectedLibrary.set(undefined);
  }

  onFormCancel(): void {
    this.showForm.set(false);
    this.selectedLibrary.set(undefined);
  }

  onDeleteLibrary(library: Library): void {
    this.libraryToDelete.set(library);
    this.showDeleteDialog.set(true);
  }

  getDeleteMessage(): string {
    const library = this.libraryToDelete();
    if (!library) return 'Are you sure?';
    return `Are you sure you want to delete "${library.name}"? This will permanently delete all associated jobs and cannot be undone.`;
  }

  onConfirmDelete(): void {
    const library = this.libraryToDelete();
    if (!library) return;

    this.store.dispatch(LibrariesActions.deleteLibrary({ id: library.id }));
    this.showDeleteDialog.set(false);
    this.libraryToDelete.set(undefined);
  }

  onCancelDelete(): void {
    this.showDeleteDialog.set(false);
    this.libraryToDelete.set(undefined);
  }

  onScanLibrary(library: Library): void {
    this.scanningLibraryId.set(library.id);
    this.store.dispatch(LibrariesActions.scanLibrary({ id: library.id }));
    // Reset scanning state after a delay (scan is async on backend)
    setTimeout(() => this.scanningLibraryId.set(null), 1000);
  }

  onToggleWatch(library: Library): void {
    this.store.dispatch(LibrariesActions.updateLibrary({
      id: library.id,
      library: { watchEnabled: !library.watchEnabled }
    }));
  }

  isScanning(libraryId: string): boolean {
    return this.scanningLibraryId() === libraryId;
  }
}
