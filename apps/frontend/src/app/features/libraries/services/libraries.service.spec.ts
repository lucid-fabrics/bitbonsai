import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { LibrariesClient } from '../../../core/clients/libraries.client';
import type { CreateLibraryDto, Library, UpdateLibraryDto } from '../models/library.model';
import { MediaType } from '../models/library.model';
import { LibrariesService } from './libraries.service';

const makeLibrary = (overrides: Partial<Library> = {}): Library => ({
  id: '1',
  name: 'Movies',
  path: '/media/movies',
  mediaType: MediaType.MOVIE,
  enabled: true,
  watchEnabled: false,
  lastScanAt: null,
  totalFiles: 10,
  totalSizeBytes: '1024',
  node: { id: 'n1', name: 'Main', status: 'ONLINE' },
  defaultPolicyId: null,
  defaultPolicy: null,
  policies: [],
  _count: { jobs: 0 },
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
  ...overrides,
});

describe('LibrariesService', () => {
  let service: LibrariesService;
  let client: jest.Mocked<LibrariesClient>;

  beforeEach(() => {
    const clientMock: jest.Mocked<LibrariesClient> = {
      getLibraries: jest.fn(),
      getLibrary: jest.fn(),
      createLibrary: jest.fn(),
      updateLibrary: jest.fn(),
      deleteLibrary: jest.fn(),
      scanLibrary: jest.fn(),
      getScanPreview: jest.fn(),
      getAllReadyFiles: jest.fn(),
      createJobsFromScan: jest.fn(),
      createAllJobs: jest.fn(),
      getLibraryFiles: jest.fn(),
    } as unknown as jest.Mocked<LibrariesClient>;

    TestBed.configureTestingModule({
      providers: [LibrariesService, { provide: LibrariesClient, useValue: clientMock }],
    });

    service = TestBed.inject(LibrariesService);
    client = TestBed.inject(LibrariesClient) as jest.Mocked<LibrariesClient>;
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('getLibraries', () => {
    it('should delegate to client.getLibraries', () => {
      const libs = [makeLibrary()];
      client.getLibraries.mockReturnValue(of(libs));
      service.getLibraries().subscribe((result) => expect(result).toEqual(libs));
      expect(client.getLibraries).toHaveBeenCalledTimes(1);
    });

    it('should propagate errors from client', () => {
      client.getLibraries.mockReturnValue(throwError(() => new Error('Network error')));
      service.getLibraries().subscribe({
        next: () => fail('should have errored'),
        error: (err) => expect(err.message).toBe('Network error'),
      });
    });
  });

  describe('getLibrary', () => {
    it('should delegate to client.getLibrary with id', () => {
      const lib = makeLibrary({ id: '42' });
      client.getLibrary.mockReturnValue(of(lib));
      service.getLibrary('42').subscribe((result) => expect(result.id).toBe('42'));
      expect(client.getLibrary).toHaveBeenCalledWith('42');
    });
  });

  describe('createLibrary', () => {
    it('should delegate to client.createLibrary with dto', () => {
      const dto: CreateLibraryDto = {
        name: 'Anime',
        path: '/media/anime',
        mediaType: MediaType.ANIME,
      };
      const created = makeLibrary({ id: '2', ...dto });
      client.createLibrary.mockReturnValue(of(created));
      service.createLibrary(dto).subscribe((result) => expect(result.name).toBe('Anime'));
      expect(client.createLibrary).toHaveBeenCalledWith(dto);
    });
  });

  describe('updateLibrary', () => {
    it('should delegate to client.updateLibrary with id and updates', () => {
      const updates: UpdateLibraryDto = { name: 'Movies HD' };
      const updated = makeLibrary({ name: 'Movies HD' });
      client.updateLibrary.mockReturnValue(of(updated));
      service
        .updateLibrary('1', updates)
        .subscribe((result) => expect(result.name).toBe('Movies HD'));
      expect(client.updateLibrary).toHaveBeenCalledWith('1', updates);
    });
  });

  describe('deleteLibrary', () => {
    it('should delegate to client.deleteLibrary', () => {
      client.deleteLibrary.mockReturnValue(of(undefined));
      service.deleteLibrary('1').subscribe();
      expect(client.deleteLibrary).toHaveBeenCalledWith('1');
    });
  });

  describe('scanLibrary', () => {
    it('should delegate to client.scanLibrary', () => {
      const scanned = makeLibrary({ totalFiles: 50 });
      client.scanLibrary.mockReturnValue(of(scanned));
      service.scanLibrary('1').subscribe((result) => expect(result.totalFiles).toBe(50));
      expect(client.scanLibrary).toHaveBeenCalledWith('1');
    });
  });
});
