import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { MediaStatsService } from './media-stats.service';
import { MediaStatsClient } from '../clients/media-stats.service';
import { MediaStatsBo } from '../business-objects/media-stats.service';

describe('MediaStatsService', () => {
  let service: MediaStatsService;
  let client: jasmine.SpyObj<MediaStatsClient>;

  beforeEach(() => {
    const clientSpy = jasmine.createSpyObj('MediaStatsClient', [
      'getAll',
      'getById',
      'create',
      'update',
      'delete',
    ]);

    TestBed.configureTestingModule({
      providers: [
        MediaStatsService,
        { provide: MediaStatsClient, useValue: clientSpy },
      ],
    });

    service = TestBed.inject(MediaStatsService);
    client = TestBed.inject(MediaStatsClient) as jasmine.SpyObj<MediaStatsClient>;
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('data retrieval', () => {
    it('should transform client responses to BOs', (done) => {
      const mockData = { id: '1', name: 'Test' };
      client.getAll.and.returnValue(of([mockData]));

      service.getAll().subscribe((result) => {
        expect(result[0]).toBeInstanceOf(MediaStatsBo);
        expect(client.getAll).toHaveBeenCalled();
        done();
      });
    });

    it('should handle errors from client', (done) => {
      const error = new Error('Client error');
      client.getAll.and.returnValue(throwError(() => error));

      service.getAll().subscribe({
        error: (err) => {
          expect(err).toBe(error);
          done();
        },
      });
    });
  });

  // TODO: Add more specific tests based on service methods
});
