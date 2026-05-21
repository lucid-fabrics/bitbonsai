import { Injectable, inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { of } from 'rxjs';
import { catchError, map, switchMap } from 'rxjs/operators';
import { LibrariesService } from '../services/libraries.service';
import { LibrariesActions } from './libraries.actions';

@Injectable()
export class LibrariesEffects {
  private readonly actions$ = inject(Actions);
  private readonly librariesService = inject(LibrariesService);

  loadLibraries$ = createEffect(() =>
    this.actions$.pipe(
      ofType(LibrariesActions.loadLibraries),
      switchMap(() =>
        this.librariesService.getLibraries().pipe(
          map((libraries) => LibrariesActions.loadLibrariesSuccess({ libraries })),
          catchError((error) => of(LibrariesActions.loadLibrariesFailure({ error: error.message })))
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
          catchError((error) => of(LibrariesActions.createLibraryFailure({ error: error.message })))
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
          catchError((error) => of(LibrariesActions.updateLibraryFailure({ error: error.message })))
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
          catchError((error) => of(LibrariesActions.deleteLibraryFailure({ error: error.message })))
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
          catchError((error) => of(LibrariesActions.scanLibraryFailure({ error: error.message })))
        )
      )
    )
  );
}
