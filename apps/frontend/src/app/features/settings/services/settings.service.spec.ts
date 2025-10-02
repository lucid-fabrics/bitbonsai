import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { SettingsService } from './settings.service';
import { SettingsClient } from './settings.service';
import { SettingsBo } from '../bos/settings.service';

describe('SettingsService', () => {
  let service: SettingsService;
  let client: jasmine.SpyObj<SettingsClient>;

  beforeEach(() => {
    const clientSpy = jasmine.createSpyObj('SettingsClient', [
      'getAll',
      'getById',
      'create',
      'update',
      'delete',
    ]);

    TestBed.configureTestingModule({
      providers: [
        SettingsService,
        { provide: SettingsClient, useValue: clientSpy },
      ],
    });

    service = TestBed.inject(SettingsService);
    client = TestBed.inject(SettingsClient) as jasmine.SpyObj<SettingsClient>;
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('data retrieval', () => {
    it('should transform client responses to BOs', (done) => {
      const mockData = { id: '1', name: 'Test' };
      client.getAll.and.returnValue(of([mockData]));

      service.getAll().subscribe((result) => {
        expect(result[0]).toBeInstanceOf(SettingsBo);
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
