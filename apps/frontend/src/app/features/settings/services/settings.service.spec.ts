import { HttpClient, provideHttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { SettingsService } from './settings.service';

describe('SettingsService', () => {
  let service: SettingsService;
  let httpClient: jest.Mocked<HttpClient>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [SettingsService, provideHttpClient()],
    });

    service = TestBed.inject(SettingsService);
    httpClient = TestBed.inject(HttpClient) as jest.Mocked<HttpClient>;
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('data retrieval', () => {
    it('should get environment info', (done) => {
      const mockData = { version: '1.0.0', nodeEnv: 'test' } as never;
      jest.spyOn(httpClient, 'get').mockReturnValue(of(mockData));

      service.getEnvironmentInfo().subscribe((result) => {
        expect(result).toBeDefined();
        expect(httpClient.get).toHaveBeenCalled();
        done();
      });
    });

    it('should handle errors from HTTP client', (done) => {
      const error = new Error('HTTP error');
      jest.spyOn(httpClient, 'get').mockReturnValue(throwError(() => error));

      service.getEnvironmentInfo().subscribe({
        error: (err) => {
          expect(err).toBe(error);
          done();
        },
      });
    });
  });
});
