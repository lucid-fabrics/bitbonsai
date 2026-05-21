import type { Library } from '../models/library.model';
import { MediaType } from '../models/library.model';
import type { LibrariesState } from './libraries.reducer';
import {
  selectAllLibraries,
  selectLibrariesError,
  selectLibrariesLoading,
  selectLibraryById,
  selectTotalLibraries,
} from './libraries.selectors';

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

const buildState = (partial: Partial<LibrariesState> = {}): { libraries: LibrariesState } => ({
  libraries: {
    libraries: [],
    isLoading: false,
    error: null,
    ...partial,
  },
});

describe('libraries selectors', () => {
  describe('selectAllLibraries', () => {
    it('should return the libraries array', () => {
      const libs = [makeLibrary()];
      expect(selectAllLibraries(buildState({ libraries: libs }))).toEqual(libs);
    });

    it('should return empty array when state is empty', () => {
      expect(selectAllLibraries(buildState())).toEqual([]);
    });
  });

  describe('selectLibrariesLoading', () => {
    it('should return true when loading', () => {
      expect(selectLibrariesLoading(buildState({ isLoading: true }))).toBe(true);
    });

    it('should return false when not loading', () => {
      expect(selectLibrariesLoading(buildState({ isLoading: false }))).toBe(false);
    });
  });

  describe('selectLibrariesError', () => {
    it('should return error message when present', () => {
      expect(selectLibrariesError(buildState({ error: 'Oops' }))).toBe('Oops');
    });

    it('should return null when no error', () => {
      expect(selectLibrariesError(buildState())).toBeNull();
    });
  });

  describe('selectLibraryById', () => {
    it('should find library by id', () => {
      const lib = makeLibrary({ id: '42', name: 'Anime' });
      const state = buildState({ libraries: [makeLibrary(), lib] });
      expect(selectLibraryById('42')(state)?.name).toBe('Anime');
    });

    it('should return undefined for unknown id', () => {
      const state = buildState({ libraries: [makeLibrary({ id: '1' })] });
      expect(selectLibraryById('999')(state)).toBeUndefined();
    });
  });

  describe('selectTotalLibraries', () => {
    it('should return the count of libraries', () => {
      const state = buildState({
        libraries: [makeLibrary({ id: '1' }), makeLibrary({ id: '2' })],
      });
      expect(selectTotalLibraries(state)).toBe(2);
    });

    it('should return 0 for empty library list', () => {
      expect(selectTotalLibraries(buildState())).toBe(0);
    });
  });
});
