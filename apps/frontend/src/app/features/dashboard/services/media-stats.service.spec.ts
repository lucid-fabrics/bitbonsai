import { provideHttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { MediaStatsClient } from './media-stats.client';
import { MediaStatsService } from './media-stats.service';

describe('MediaStatsService', () => {
  let service: MediaStatsService;
  let client: jest.Mocked<MediaStatsClient>;

  beforeEach(() => {
    const clientMock = {
      getMediaStats: jest.fn(),
      triggerScan: jest.fn(),
    } as unknown as jest.Mocked<MediaStatsClient>;

    TestBed.configureTestingModule({
      providers: [
        MediaStatsService,
        { provide: MediaStatsClient, useValue: clientMock },
        provideHttpClient(),
      ],
    });

    service = TestBed.inject(MediaStatsService);
    client = TestBed.inject(MediaStatsClient) as jest.Mocked<MediaStatsClient>;
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('data retrieval', () => {
    it('should transform client responses to BOs', (done) => {
      const mockData = {
        total_size_gb: 100,
        total_files: 10,
        average_bitrate_mbps: 5.5,
        codec_distribution: { hevc: 5, h264: 3, av1: 1, other: 1 },
        folders: [],
        scan_timestamp: new Date().toISOString(),
      };
      client.getMediaStats.mockReturnValue(of(mockData));

      service.getMediaStats().subscribe((result) => {
        expect(result).toBeDefined();
        expect(client.getMediaStats).toHaveBeenCalled();
        done();
      });
    });

    it('should handle errors from client', (done) => {
      const error = new Error('Client error');
      client.getMediaStats.mockReturnValue(throwError(() => error));

      service.getMediaStats().subscribe({
        error: (err) => {
          expect(err).toBe(error);
          done();
        },
      });
    });
  });

  // TODO: Add more specific tests based on service methods
});
