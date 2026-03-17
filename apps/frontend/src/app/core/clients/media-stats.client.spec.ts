import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { FolderFilesModel } from '../../features/dashboard/models/file-info.model';
import type { MediaStatsModel } from '../../features/dashboard/models/media-stats.model';
import { MediaStatsClient } from './media-stats.client';

describe('MediaStatsClient', () => {
  let client: MediaStatsClient;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [MediaStatsClient],
    });
    client = TestBed.inject(MediaStatsClient);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should be created', () => {
    expect(client).toBeTruthy();
  });

  describe('getMediaStats', () => {
    it('should fetch media stats from the API', () => {
      const mockStats: MediaStatsModel = {
        totalFiles: 1000,
        totalSize: 10737418240, // 10 GB
        h264Count: 500,
        h265Count: 400,
        otherCodecCount: 100,
        potentialSavings: 2147483648, // 2 GB
        folders: [
          {
            name: 'Movies',
            h264Count: 250,
            h265Count: 200,
            otherCodecCount: 50,
            totalSize: 5368709120, // 5 GB
          },
        ],
      };

      client.getMediaStats().subscribe((data) => {
        expect(data).toEqual(mockStats);
        expect(data.totalFiles).toBe(1000);
        expect(data.h264Count).toBe(500);
        expect(data.folders.length).toBe(1);
        expect(data.folders[0].name).toBe('Movies');
      });

      const req = httpMock.expectOne('/api/v1/media-stats');
      expect(req.request.method).toBe('GET');
      req.flush(mockStats);
    });

    it('should handle errors when fetching media stats', () => {
      client.getMediaStats().subscribe({
        next: () => fail('should have failed'),
        error: (error) => {
          expect(error.status).toBe(500);
        },
      });

      const req = httpMock.expectOne('/api/v1/media-stats');
      req.flush('Error', { status: 500, statusText: 'Server Error' });
    });
  });

  describe('triggerScan', () => {
    it('should trigger a media scan', () => {
      client.triggerScan().subscribe((response) => {
        expect(response).toBeUndefined();
      });

      const req = httpMock.expectOne('/api/v1/media-stats/scan');
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({});
      req.flush(null);
    });

    it('should handle errors when triggering scan', () => {
      client.triggerScan().subscribe({
        next: () => fail('should have failed'),
        error: (error) => {
          expect(error.status).toBe(403);
        },
      });

      const req = httpMock.expectOne('/api/v1/media-stats/scan');
      req.flush('Forbidden', { status: 403, statusText: 'Forbidden' });
    });
  });

  describe('getFolderFiles', () => {
    it('should fetch folder files without codec filter', () => {
      const mockResponse: FolderFilesModel = {
        folderName: 'Movies',
        files: [
          {
            fileName: 'movie1.mp4',
            filePath: '/media/Movies/movie1.mp4',
            fileSize: 1073741824, // 1 GB
            codec: 'h264',
            resolution: '1920x1080',
            bitrate: 5000000,
          },
        ],
      };

      client.getFolderFiles('Movies').subscribe((data) => {
        expect(data).toEqual(mockResponse);
        expect(data.folderName).toBe('Movies');
        expect(data.files.length).toBe(1);
        expect(data.files[0].fileName).toBe('movie1.mp4');
        expect(data.files[0].codec).toBe('h264');
      });

      const req = httpMock.expectOne('/api/v1/media-stats/folders/Movies/files');
      expect(req.request.method).toBe('GET');
      expect(req.request.params.has('codec')).toBe(false);
      req.flush(mockResponse);
    });

    it('should fetch folder files with codec filter', () => {
      const mockResponse: FolderFilesModel = {
        folderName: 'Movies',
        files: [
          {
            fileName: 'movie1.mp4',
            filePath: '/media/Movies/movie1.mp4',
            fileSize: 1073741824,
            codec: 'h264',
            resolution: '1920x1080',
            bitrate: 5000000,
          },
        ],
      };

      client.getFolderFiles('Movies', 'h264').subscribe((data) => {
        expect(data).toEqual(mockResponse);
        expect(data.files.every((f) => f.codec === 'h264')).toBe(true);
      });

      const req = httpMock.expectOne('/api/v1/media-stats/folders/Movies/files?codec=h264');
      expect(req.request.method).toBe('GET');
      expect(req.request.params.get('codec')).toBe('h264');
      req.flush(mockResponse);
    });

    it('should handle errors when fetching folder files', () => {
      client.getFolderFiles('Movies').subscribe({
        next: () => fail('should have failed'),
        error: (error) => {
          expect(error.status).toBe(404);
        },
      });

      const req = httpMock.expectOne('/api/v1/media-stats/folders/Movies/files');
      req.flush('Not Found', { status: 404, statusText: 'Not Found' });
    });

    it('should properly encode folder name with special characters', () => {
      client.getFolderFiles('Movies & TV').subscribe();

      const req = httpMock.expectOne('/api/v1/media-stats/folders/Movies & TV/files');
      expect(req.request.method).toBe('GET');
      req.flush({ folderName: 'Movies & TV', files: [] });
    });
  });
});
