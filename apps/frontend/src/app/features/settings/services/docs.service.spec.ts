import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { DocsService } from './docs.service';

describe('DocsService', () => {
  let service: DocsService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [DocsService],
    });
    service = TestBed.inject(DocsService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('getDocument', () => {
    it('should return null for an unknown document name', () => {
      const result = service.getDocument('unknown-doc');
      expect(result).toBeNull();
    });

    it('should return null for empty string', () => {
      expect(service.getDocument('')).toBeNull();
    });

    it('should GET the rebalancing doc as text', () => {
      const markdown = '# Rebalancing\n\nContent here.';
      service.getDocument('rebalancing')!.subscribe((data) => {
        expect(data).toBe(markdown);
      });

      const req = httpMock.expectOne('/api/v1/docs/REBALANCING');
      expect(req.request.method).toBe('GET');
      expect(req.request.responseType).toBe('text');
      req.flush(markdown);
    });

    it('should propagate HTTP errors for known doc', () => {
      service.getDocument('rebalancing')!.subscribe({
        next: () => fail('should have errored'),
        error: (err) => expect(err.status).toBe(404),
      });

      httpMock
        .expectOne('/api/v1/docs/REBALANCING')
        .flush('Not Found', { status: 404, statusText: 'Not Found' });
    });

    it('should return an Observable (not null) for the rebalancing key', () => {
      const obs = service.getDocument('rebalancing');
      expect(obs).not.toBeNull();
      // Flush to avoid open request warning
      obs!.subscribe();
      httpMock.expectOne('/api/v1/docs/REBALANCING').flush('');
    });
  });
});
