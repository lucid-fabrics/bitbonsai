import type { Library } from '../models/library.model';
import { MediaType } from '../models/library.model';
import { LibrariesActions } from './libraries.actions';
import { initialState, librariesReducer } from './libraries.reducer';

const makeLibrary = (overrides: Partial<Library> = {}): Library => ({
  id: '1',
  name: 'Movies',
  path: '/media/movies',
  mediaType: MediaType.MOVIE,
  enabled: true,
  watchEnabled: false,
  lastScanAt: null,
  totalFiles: 0,
  totalSizeBytes: '0',
  node: { id: 'n1', name: 'Main', status: 'ONLINE' },
  defaultPolicyId: null,
  defaultPolicy: null,
  policies: [],
  _count: { jobs: 0 },
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
  ...overrides,
});

describe('librariesReducer', () => {
  it('should return the initial state for unknown action', () => {
    const state = librariesReducer(undefined, { type: '@@INIT' } as never);
    expect(state).toEqual(initialState);
  });

  describe('loadLibraries', () => {
    it('should set isLoading=true and clear error', () => {
      const state = librariesReducer(
        { ...initialState, error: 'old error' },
        LibrariesActions.loadLibraries()
      );
      expect(state.isLoading).toBe(true);
      expect(state.error).toBeNull();
    });

    it('should store libraries and clear loading on success', () => {
      const libraries = [makeLibrary({ id: '1' }), makeLibrary({ id: '2', name: 'TV' })];
      const state = librariesReducer(
        { ...initialState, isLoading: true },
        LibrariesActions.loadLibrariesSuccess({ libraries })
      );
      expect(state.libraries).toEqual(libraries);
      expect(state.isLoading).toBe(false);
    });

    it('should store error and clear loading on failure', () => {
      const state = librariesReducer(
        { ...initialState, isLoading: true },
        LibrariesActions.loadLibrariesFailure({ error: 'Network error' })
      );
      expect(state.error).toBe('Network error');
      expect(state.isLoading).toBe(false);
    });
  });

  describe('createLibrary', () => {
    it('should set isLoading=true on createLibrary', () => {
      const state = librariesReducer(
        initialState,
        LibrariesActions.createLibrary({
          library: { name: 'New', path: '/new', mediaType: MediaType.OTHER },
        })
      );
      expect(state.isLoading).toBe(true);
    });

    it('should append new library on success', () => {
      const existing = makeLibrary({ id: '1' });
      const newLib = makeLibrary({ id: '2', name: 'Anime' });
      const state = librariesReducer(
        { ...initialState, libraries: [existing] },
        LibrariesActions.createLibrarySuccess({ library: newLib })
      );
      expect(state.libraries).toHaveLength(2);
      expect(state.libraries[1]).toEqual(newLib);
      expect(state.isLoading).toBe(false);
    });

    it('should set error on createLibrary failure', () => {
      const state = librariesReducer(
        { ...initialState, isLoading: true },
        LibrariesActions.createLibraryFailure({ error: 'Conflict' })
      );
      expect(state.error).toBe('Conflict');
      expect(state.isLoading).toBe(false);
    });
  });

  describe('updateLibrary', () => {
    it('should replace updated library in list on success', () => {
      const lib1 = makeLibrary({ id: '1', name: 'Movies' });
      const lib2 = makeLibrary({ id: '2', name: 'TV' });
      const updated = makeLibrary({ id: '1', name: 'Movies HD' });
      const state = librariesReducer(
        { ...initialState, libraries: [lib1, lib2] },
        LibrariesActions.updateLibrarySuccess({ library: updated })
      );
      expect(state.libraries[0].name).toBe('Movies HD');
      expect(state.libraries[1].name).toBe('TV');
      expect(state.isLoading).toBe(false);
    });

    it('should leave list unchanged for unknown id on updateSuccess', () => {
      const lib = makeLibrary({ id: '1' });
      const ghost = makeLibrary({ id: '999', name: 'Ghost' });
      const state = librariesReducer(
        { ...initialState, libraries: [lib] },
        LibrariesActions.updateLibrarySuccess({ library: ghost })
      );
      expect(state.libraries).toHaveLength(1);
      expect(state.libraries[0].id).toBe('1');
    });
  });

  describe('deleteLibrary', () => {
    it('should remove library from list on success', () => {
      const lib1 = makeLibrary({ id: '1' });
      const lib2 = makeLibrary({ id: '2', name: 'TV' });
      const state = librariesReducer(
        { ...initialState, libraries: [lib1, lib2] },
        LibrariesActions.deleteLibrarySuccess({ id: '1' })
      );
      expect(state.libraries).toHaveLength(1);
      expect(state.libraries[0].id).toBe('2');
      expect(state.isLoading).toBe(false);
    });

    it('should set error on deleteLibrary failure', () => {
      const state = librariesReducer(
        { ...initialState, isLoading: true },
        LibrariesActions.deleteLibraryFailure({ error: 'Not found' })
      );
      expect(state.error).toBe('Not found');
    });
  });

  describe('scanLibrary', () => {
    it('should replace scanned library on success', () => {
      const lib = makeLibrary({ id: '1', totalFiles: 0 });
      const scanned = makeLibrary({ id: '1', totalFiles: 42 });
      const state = librariesReducer(
        { ...initialState, libraries: [lib] },
        LibrariesActions.scanLibrarySuccess({ id: '1', library: scanned })
      );
      expect(state.libraries[0].totalFiles).toBe(42);
      expect(state.isLoading).toBe(false);
    });

    it('should set error on scan failure', () => {
      const state = librariesReducer(
        { ...initialState, isLoading: true },
        LibrariesActions.scanLibraryFailure({ error: 'Scan failed' })
      );
      expect(state.error).toBe('Scan failed');
    });
  });
});
