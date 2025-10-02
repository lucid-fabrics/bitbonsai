import { createFeatureSelector, createSelector } from '@ngrx/store';
import { LibrariesState } from './libraries.reducer';

export const selectLibrariesState = createFeatureSelector<LibrariesState>('libraries');

export const selectAllLibraries = createSelector(
  selectLibrariesState,
  (state) => state.libraries
);

export const selectLibrariesLoading = createSelector(
  selectLibrariesState,
  (state) => state.isLoading
);

export const selectLibrariesError = createSelector(
  selectLibrariesState,
  (state) => state.error
);

export const selectLibraryById = (id: string) => createSelector(
  selectAllLibraries,
  (libraries) => libraries.find(library => library.id === id)
);

export const selectTotalLibraries = createSelector(
  selectAllLibraries,
  (libraries) => libraries.length
);
