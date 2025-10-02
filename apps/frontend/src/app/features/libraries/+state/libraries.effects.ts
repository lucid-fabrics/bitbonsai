import { Injectable, inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { of } from 'rxjs';
import { catchError, map, switchMap } from 'rxjs/operators';
import { LibrariesClient } from '../services/libraries.client';
import { LibrariesActions } from './libraries.actions';

@Injectable()
export class LibrariesEffects {
  private readonly actions$ = inject(Actions);
  private readonly librariesClient = inject(LibrariesClient);

  loadLibraries$ = createEffect(() =>
    this.actions$.pipe(
      ofType(LibrariesActions.loadLibraries),
      switchMap(() =>
        this.librariesClient.getLibraries().pipe(
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
        this.librariesClient.createLibrary(library).pipe(
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
        this.librariesClient.updateLibrary(id, library).pipe(
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
        this.librariesClient.deleteLibrary(id).pipe(
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
        this.librariesClient.scanLibrary(id).pipe(
          map(() => LibrariesActions.scanLibrarySuccess({ id })),
          catchError((error) => of(LibrariesActions.scanLibraryFailure({ error: error.message })))
        )
      )
    )
  );
}
