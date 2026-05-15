import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type {
  CreateLibraryDto,
  Library,
  UpdateLibraryDto,
} from '../../features/libraries/models/library.model';
import { LibrariesClient } from './libraries.client';

describe('LibrariesClient', () => {
  let client: LibrariesClient;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [LibrariesClient],
    });
    client = TestBed.inject(LibrariesClient);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should be created', () => {
    expect(client).toBeTruthy();
  });

  describe('getLibraries', () => {
    it('should fetch all libraries', () => {
      const mockLibraries: Library[] = [
        {
          id: '1',
          name: 'Movies',
          path: '/media/movies',
          policyId: 'policy-1',
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
        },
        {
          id: '2',
          name: 'TV Shows',
          path: '/media/tv',
          policyId: 'policy-2',
          createdAt: '2024-01-02T00:00:00Z',
          updatedAt: '2024-01-02T00:00:00Z',
        },
      ];

      client.getLibraries().subscribe((data) => {
        expect(data).toEqual(mockLibraries);
        expect(data.length).toBe(2);
        expect(data[0].name).toBe('Movies');
        expect(data[1].name).toBe('TV Shows');
      });

      const req = httpMock.expectOne('/api/v1/libraries');
      expect(req.request.method).toBe('GET');
      req.flush(mockLibraries);
    });

    it('should handle errors when fetching libraries', () => {
      client.getLibraries().subscribe({
        next: () => fail('should have failed'),
        error: (error) => {
          expect(error.status).toBe(500);
        },
      });

      const req = httpMock.expectOne('/api/v1/libraries');
      req.flush('Error', { status: 500, statusText: 'Server Error' });
    });
  });

  describe('getLibrary', () => {
    it('should fetch a specific library by ID', () => {
      const mockLibrary: Library = {
        id: '1',
        name: 'Movies',
        path: '/media/movies',
        policyId: 'policy-1',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      };

      client.getLibrary('1').subscribe((data) => {
        expect(data).toEqual(mockLibrary);
        expect(data.id).toBe('1');
        expect(data.name).toBe('Movies');
      });

      const req = httpMock.expectOne('/api/v1/libraries/1');
      expect(req.request.method).toBe('GET');
      req.flush(mockLibrary);
    });

    it('should handle 404 when library not found', () => {
      client.getLibrary('999').subscribe({
        next: () => fail('should have failed'),
        error: (error) => {
          expect(error.status).toBe(404);
        },
      });

      const req = httpMock.expectOne('/api/v1/libraries/999');
      req.flush('Not Found', { status: 404, statusText: 'Not Found' });
    });
  });

  describe('createLibrary', () => {
    it('should create a new library', () => {
      const createDto: CreateLibraryDto = {
        name: 'Anime',
        path: '/media/anime',
        policyId: 'policy-3',
      };

      const mockResponse: Library = {
        id: '3',
        ...createDto,
        createdAt: '2024-01-03T00:00:00Z',
        updatedAt: '2024-01-03T00:00:00Z',
      };

      client.createLibrary(createDto).subscribe((data) => {
        expect(data).toEqual(mockResponse);
        expect(data.id).toBe('3');
        expect(data.name).toBe('Anime');
      });

      const req = httpMock.expectOne('/api/v1/libraries');
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual(createDto);
      req.flush(mockResponse);
    });

    it('should handle validation errors when creating library', () => {
      const invalidDto: CreateLibraryDto = {
        name: '',
        path: '',
        policyId: '',
      };

      client.createLibrary(invalidDto).subscribe({
        next: () => fail('should have failed'),
        error: (error) => {
          expect(error.status).toBe(400);
        },
      });

      const req = httpMock.expectOne('/api/v1/libraries');
      req.flush('Validation Error', { status: 400, statusText: 'Bad Request' });
    });
  });

  describe('updateLibrary', () => {
    it('should update an existing library', () => {
      const updateDto: UpdateLibraryDto = {
        name: 'Movies HD',
      };

      const mockResponse: Library = {
        id: '1',
        name: 'Movies HD',
        path: '/media/movies',
        policyId: 'policy-1',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-04T00:00:00Z',
      };

      client.updateLibrary('1', updateDto).subscribe((data) => {
        expect(data).toEqual(mockResponse);
        expect(data.name).toBe('Movies HD');
        expect(data.updatedAt).toBe('2024-01-04T00:00:00Z');
      });

      const req = httpMock.expectOne('/api/v1/libraries/1');
      expect(req.request.method).toBe('PATCH');
      expect(req.request.body).toEqual(updateDto);
      req.flush(mockResponse);
    });

    it('should handle errors when updating library', () => {
      const updateDto: UpdateLibraryDto = { name: 'New Name' };

      client.updateLibrary('999', updateDto).subscribe({
        next: () => fail('should have failed'),
        error: (error) => {
          expect(error.status).toBe(404);
        },
      });

      const req = httpMock.expectOne('/api/v1/libraries/999');
      req.flush('Not Found', { status: 404, statusText: 'Not Found' });
    });
  });

  describe('deleteLibrary', () => {
    it('should delete a library', () => {
      client.deleteLibrary('1').subscribe((response) => {
        expect(response).toBeUndefined();
      });

      const req = httpMock.expectOne('/api/v1/libraries/1');
      expect(req.request.method).toBe('DELETE');
      req.flush(null);
    });

    it('should handle errors when deleting library', () => {
      client.deleteLibrary('999').subscribe({
        next: () => fail('should have failed'),
        error: (error) => {
          expect(error.status).toBe(404);
        },
      });

      const req = httpMock.expectOne('/api/v1/libraries/999');
      req.flush('Not Found', { status: 404, statusText: 'Not Found' });
    });
  });

  describe('scanLibrary', () => {
    it('should trigger a library scan', () => {
      const mockResponse: Library = {
        id: '1',
        name: 'Movies',
        path: '/media/movies',
        policyId: 'policy-1',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-05T00:00:00Z',
      };

      client.scanLibrary('1').subscribe((data) => {
        expect(data).toEqual(mockResponse);
        expect(data.id).toBe('1');
      });

      const req = httpMock.expectOne('/api/v1/libraries/1/scan');
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({});
      req.flush(mockResponse);
    });

    it('should handle errors when scanning library', () => {
      client.scanLibrary('999').subscribe({
        next: () => fail('should have failed'),
        error: (error) => {
          expect(error.status).toBe(404);
        },
      });

      const req = httpMock.expectOne('/api/v1/libraries/999/scan');
      req.flush('Not Found', { status: 404, statusText: 'Not Found' });
    });
  });
});
