import { createReducer, on } from '@ngrx/store';
import { Library } from '../models/library.model';
import { LibrariesActions } from './libraries.actions';

export interface LibrariesState {
  libraries: Library[];
  isLoading: boolean;
  error: string | null;
}

export const initialState: LibrariesState = {
  libraries: [],
  isLoading: false,
  error: null
};

export const librariesReducer = createReducer(
  initialState,

  // Load Libraries
  on(LibrariesActions.loadLibraries, (state) => ({
    ...state,
    isLoading: true,
    error: null
  })),
  on(LibrariesActions.loadLibrariesSuccess, (state, { libraries }) => ({
    ...state,
    libraries,
    isLoading: false
  })),
  on(LibrariesActions.loadLibrariesFailure, (state, { error }) => ({
    ...state,
    error,
    isLoading: false
  })),

  // Create Library
  on(LibrariesActions.createLibrary, (state) => ({
    ...state,
    isLoading: true,
    error: null
  })),
  on(LibrariesActions.createLibrarySuccess, (state, { library }) => ({
    ...state,
    libraries: [...state.libraries, library],
    isLoading: false
  })),
  on(LibrariesActions.createLibraryFailure, (state, { error }) => ({
    ...state,
    error,
    isLoading: false
  })),

  // Update Library
  on(LibrariesActions.updateLibrary, (state) => ({
    ...state,
    isLoading: true,
    error: null
  })),
  on(LibrariesActions.updateLibrarySuccess, (state, { library }) => ({
    ...state,
    libraries: state.libraries.map(l => l.id === library.id ? library : l),
    isLoading: false
  })),
  on(LibrariesActions.updateLibraryFailure, (state, { error }) => ({
    ...state,
    error,
    isLoading: false
  })),

  // Delete Library
  on(LibrariesActions.deleteLibrary, (state) => ({
    ...state,
    isLoading: true,
    error: null
  })),
  on(LibrariesActions.deleteLibrarySuccess, (state, { id }) => ({
    ...state,
    libraries: state.libraries.filter(l => l.id !== id),
    isLoading: false
  })),
  on(LibrariesActions.deleteLibraryFailure, (state, { error }) => ({
    ...state,
    error,
    isLoading: false
  })),

  // Scan Library
  on(LibrariesActions.scanLibrary, (state) => ({
    ...state,
    isLoading: true,
    error: null
  })),
  on(LibrariesActions.scanLibrarySuccess, (state, { id }) => ({
    ...state,
    isLoading: false
  })),
  on(LibrariesActions.scanLibraryFailure, (state, { error }) => ({
    ...state,
    error,
    isLoading: false
  }))
);
