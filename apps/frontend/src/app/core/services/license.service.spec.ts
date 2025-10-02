import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { LicenseService } from './license.service';
import { LicenseClient } from '../clients/license.service';
import { LicenseBo } from '../business-objects/license.service';

describe('LicenseService', () => {
  let service: LicenseService;
  let client: jasmine.SpyObj<LicenseClient>;

  beforeEach(() => {
    const clientSpy = jasmine.createSpyObj('LicenseClient', [
      'getAll',
      'getById',
      'create',
      'update',
      'delete',
    ]);

    TestBed.configureTestingModule({
      providers: [
        LicenseService,
        { provide: LicenseClient, useValue: clientSpy },
      ],
    });

    service = TestBed.inject(LicenseService);
    client = TestBed.inject(LicenseClient) as jasmine.SpyObj<LicenseClient>;
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('data retrieval', () => {
    it('should transform client responses to BOs', (done) => {
      const mockData = { id: '1', name: 'Test' };
      client.getAll.and.returnValue(of([mockData]));

      service.getAll().subscribe((result) => {
        expect(result[0]).toBeInstanceOf(LicenseBo);
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
