import { HttpClient, provideHttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { LicenseService } from './license.service';

describe('LicenseService', () => {
  let service: LicenseService;
  let httpClient: jest.Mocked<HttpClient>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [LicenseService, provideHttpClient()],
    });

    service = TestBed.inject(LicenseService);
    httpClient = TestBed.inject(HttpClient) as jest.Mocked<HttpClient>;
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('data retrieval', () => {
    it('should get current license', (done) => {
      const mockData = { key: 'test-key', status: 'active', expiresAt: '2025-12-31' } as never;
      jest.spyOn(httpClient, 'get').mockReturnValue(of(mockData));

      service.getCurrentLicense().subscribe((result) => {
        expect(result).toBeDefined();
        expect(httpClient.get).toHaveBeenCalled();
        done();
      });
    });

    it('should handle errors from HTTP client', (done) => {
      const error = new Error('HTTP error');
      jest.spyOn(httpClient, 'get').mockReturnValue(throwError(() => error));

      service.getCurrentLicense().subscribe({
        error: (err) => {
          expect(err).toBe(error);
          done();
        },
      });
    });
  });
});
