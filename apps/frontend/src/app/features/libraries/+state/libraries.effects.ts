import { Injectable, inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { of } from 'rxjs';
import { catchError, map, switchMap, tap } from 'rxjs/operators';
import { humanizeError } from '../../../core/services/error-humanizer';
import { ToastService } from '../../../core/services/toast.service';
import { LibrariesService } from '../services/libraries.service';
import { LibrariesActions } from './libraries.actions';

@Injectable()
export class LibrariesEffects {
  private readonly actions$ = inject(Actions);
  private readonly librariesService = inject(LibrariesService);
  private readonly toast = inject(ToastService);

  loadLibraries$ = createEffect(() =>
    this.actions$.pipe(
      ofType(LibrariesActions.loadLibraries),
      switchMap(() =>
        this.librariesService.getLibraries().pipe(
          map((libraries) => LibrariesActions.loadLibrariesSuccess({ libraries })),
          catchError((error) => of(
            LibrariesActions.loadLibrariesFailure({
              error: humanizeError(error, 'Could not load your libraries. Retrying automatically.'),
            })
          ))
        )
      )
    )
  );

  createLibrary$ = createEffect(() =>
    this.actions$.pipe(
      ofType(LibrariesActions.createLibrary),
      switchMap(({ library }) =>
        this.librariesService.createLibrary(library).pipe(
          map((library) => LibrariesActions.createLibrarySuccess({ library })),
          catchError((error) => of(
            LibrariesActions.createLibraryFailure({
              error: humanizeError(error, 'Could not add this library. Check that the folder path exists.'),
            })
          ))
        )
      )
    )
  );

  updateLibrary$ = createEffect(() =>
    this.actions$.pipe(
      ofType(LibrariesActions.updateLibrary),
      switchMap(({ id, library }) =>
        this.librariesService.updateLibrary(id, library).pipe(
          map((library) => LibrariesActions.updateLibrarySuccess({ library })),
          catchError((error) => of(
            LibrariesActions.updateLibraryFailure({
              error: humanizeError(error, 'Could not save your changes. Please try again.'),
            })
          ))
        )
      )
    )
  );

  deleteLibrary$ = createEffect(() =>
    this.actions$.pipe(
      ofType(LibrariesActions.deleteLibrary),
      switchMap(({ id }) =>
        this.librariesService.deleteLibrary(id).pipe(
          map(() => LibrariesActions.deleteLibrarySuccess({ id })),
          catchError((error) => of(
            LibrariesActions.deleteLibraryFailure({
              error: humanizeError(error, 'Could not remove this library. Please try again.'),
            })
          ))
        )
      )
    )
  );

  scanLibrary$ = createEffect(() =>
    this.actions$.pipe(
      ofType(LibrariesActions.scanLibrary),
      switchMap(({ id }) =>
        this.librariesService.scanLibrary(id).pipe(
          map((library) => LibrariesActions.scanLibrarySuccess({ id, library })),
          catchError((error) => of(
            LibrariesActions.scanLibraryFailure({
              error: humanizeError(error, 'Could not scan this library right now. Please try again.'),
            })
          ))
        )
      )
    )
  );

  successFeedback$ = createEffect(
    () =>
      this.actions$.pipe(
        ofType(
          LibrariesActions.createLibrarySuccess,
          LibrariesActions.updateLibrarySuccess,
          LibrariesActions.deleteLibrarySuccess
        ),
        tap((action) => {
          switch (action.type) {
            case LibrariesActions.createLibrarySuccess.type:
              this.toast.success('Library added');
              break;
            case LibrariesActions.updateLibrarySuccess.type:
              this.toast.success('Saved');
              break;
            case LibrariesActions.deleteLibrarySuccess.type:
              this.toast.success('Library removed. Your media files were not touched.');
              break;
          }
        })
      ),
    { dispatch: false }
  );
}
