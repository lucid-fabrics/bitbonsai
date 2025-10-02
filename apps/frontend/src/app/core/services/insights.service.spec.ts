import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { InsightsService } from './insights.service';
import { InsightsClient } from '../clients/insights.service';
import { InsightsBo } from '../business-objects/insights.service';

describe('InsightsService', () => {
  let service: InsightsService;
  let client: jasmine.SpyObj<InsightsClient>;

  beforeEach(() => {
    const clientSpy = jasmine.createSpyObj('InsightsClient', [
      'getAll',
      'getById',
      'create',
      'update',
      'delete',
    ]);

    TestBed.configureTestingModule({
      providers: [
        InsightsService,
        { provide: InsightsClient, useValue: clientSpy },
      ],
    });

    service = TestBed.inject(InsightsService);
    client = TestBed.inject(InsightsClient) as jasmine.SpyObj<InsightsClient>;
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('data retrieval', () => {
    it('should transform client responses to BOs', (done) => {
      const mockData = { id: '1', name: 'Test' };
      client.getAll.and.returnValue(of([mockData]));

      service.getAll().subscribe((result) => {
        expect(result[0]).toBeInstanceOf(InsightsBo);
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
