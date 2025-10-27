import { Dialog } from '@angular/cdk/dialog';
import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, inject, type OnInit } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Store } from '@ngrx/store';
import {
  ConfirmationDialogComponent,
  type ConfirmationDialogData,
} from '../../shared/components/confirmation-dialog/confirmation-dialog.component';
import { NodesActions } from '../nodes/+state/nodes.actions';
import { NodesSelectors } from '../nodes/+state/nodes.selectors';
import { LibrariesActions } from './+state/libraries.actions';
import {
  selectAllLibraries,
  selectLibrariesError,
  selectLibrariesLoading,
} from './+state/libraries.selectors';
import { LibraryCardComponent } from './components/library-card/library-card.component';
import { LibraryFormComponent } from './components/library-form/library-form.component';
import type { CreateLibraryDto, Library, UpdateLibraryDto } from './models/library.model';

@Component({
  selector: 'app-libraries',
  standalone: true,
  imports: [CommonModule, LibraryCardComponent, LibraryFormComponent],
  templateUrl: './libraries.page.html',
  styleUrls: ['./libraries.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LibrariesComponent implements OnInit {
  private readonly store = inject(Store);
  private readonly dialog = inject(Dialog);
  private readonly destroyRef = inject(DestroyRef);

  // NgRx State
  readonly libraries$ = this.store.select(selectAllLibraries);
  readonly nodes$ = this.store.select(NodesSelectors.selectAllNodes);
  readonly isLoading$ = this.store.select(selectLibrariesLoading);
  readonly error$ = this.store.select(selectLibrariesError);

  // Form state
  showForm = false;
  selectedLibrary: Library | undefined = undefined;

  // Scan state
  scanningLibraryId: string | null = null;

  ngOnInit(): void {
    this.store.dispatch(LibrariesActions.loadLibraries());
    this.store.dispatch(NodesActions.loadNodes());
  }

  onAddLibrary(): void {
    this.selectedLibrary = undefined;
    this.showForm = true;
  }

  onEditLibrary(library: Library): void {
    this.selectedLibrary = library;
    this.showForm = true;
  }

  onFormSubmit(data: CreateLibraryDto | UpdateLibraryDto): void {
    const selectedLib = this.selectedLibrary;

    if (selectedLib) {
      // Update existing library
      this.store.dispatch(
        LibrariesActions.updateLibrary({
          id: selectedLib.id,
          library: data as UpdateLibraryDto,
        })
      );
    } else {
      // Create new library
      this.store.dispatch(
        LibrariesActions.createLibrary({
          library: data as CreateLibraryDto,
        })
      );
    }

    this.showForm = false;
    this.selectedLibrary = undefined;
  }

  onFormCancel(): void {
    this.showForm = false;
    this.selectedLibrary = undefined;
  }

  onDeleteLibrary(library: Library): void {
    const dialogData: ConfirmationDialogData = {
      title: 'Delete Library?',
      itemName: library.name,
      itemType: 'library',
      willHappen: [
        'Remove the library from BitBonsai',
        'Cancel any pending encoding jobs for this library',
        'Stop file watching for this directory',
        'Delete all associated job history and metadata',
      ],
      wontHappen: [
        'Delete your actual media files',
        'Remove files from your hard drive',
        'Affect other libraries or their settings',
      ],
      irreversible: true,
      confirmButtonText: 'Delete Library',
      cancelButtonText: 'Keep Library',
    };

    const dialogRef = this.dialog.open(ConfirmationDialogComponent, {
      data: dialogData,
      disableClose: false,
    });

    dialogRef.closed.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((result) => {
      if (result === true) {
        this.store.dispatch(LibrariesActions.deleteLibrary({ id: library.id }));
      }
    });
  }

  onScanLibrary(library: Library): void {
    this.scanningLibraryId = library.id;
    this.store.dispatch(LibrariesActions.scanLibrary({ id: library.id }));
    // Reset scanning state after a delay (scan is async on backend)
    setTimeout(() => {
      this.scanningLibraryId = null;
    }, 1000);
  }

  onToggleWatch(library: Library): void {
    this.store.dispatch(
      LibrariesActions.updateLibrary({
        id: library.id,
        library: { watchEnabled: !library.watchEnabled },
      })
    );
  }

  isScanning(libraryId: string): boolean {
    return this.scanningLibraryId === libraryId;
  }
}
