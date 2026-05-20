import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { BehaviorSubject, of, throwError } from 'rxjs';
import { authInterceptor } from './auth.interceptor';
import { AuthService } from './auth.service';

const makeAuthService = (overrides: Partial<typeof mockAuthService> = {}) => ({
  getAccessToken: jest.fn().mockReturnValue('test-token'),
  refreshToken: jest.fn().mockReturnValue(of({ accessToken: 'new-token' })),
  clearTokens: jest.fn(),
  isRefreshing: false,
  refreshTokenSubject: new BehaviorSubject<string | null>(null),
  ...overrides,
});

let mockAuthService: ReturnType<typeof makeAuthService>;

describe('authInterceptor', () => {
  let http: HttpClient;
  let httpMock: HttpTestingController;
  let router: { navigate: jest.Mock };

  beforeEach(() => {
    mockAuthService = makeAuthService();
    router = { navigate: jest.fn() };

    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
        { provide: Router, useValue: router },
        { provide: AuthService, useValue: mockAuthService },
      ],
    });

    http = TestBed.inject(HttpClient);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('adds Authorization header to non-excluded requests when token exists', () => {
    http.get('/api/v1/jobs').subscribe();

    const req = httpMock.expectOne('/api/v1/jobs');
    expect(req.request.headers.get('Authorization')).toBe('Bearer test-token');
    req.flush({});
  });

  it('does NOT add Authorization header to /api/v1/auth/login', () => {
    http.post('/api/v1/auth/login', {}).subscribe();

    const req = httpMock.expectOne('/api/v1/auth/login');
    expect(req.request.headers.has('Authorization')).toBe(false);
    req.flush({});
  });

  it('does NOT add Authorization header to /api/v1/auth/refresh', () => {
    http.post('/api/v1/auth/refresh', {}).subscribe();

    const req = httpMock.expectOne('/api/v1/auth/refresh');
    expect(req.request.headers.has('Authorization')).toBe(false);
    req.flush({});
  });

  it('calls refreshToken() and retries with new token on 401', () => {
    const results: unknown[] = [];
    http.get('/api/v1/jobs').subscribe({ next: (r) => results.push(r) });

    const req = httpMock.expectOne('/api/v1/jobs');
    expect(req.request.headers.get('Authorization')).toBe('Bearer test-token');
    req.flush('Unauthorized', { status: 401, statusText: 'Unauthorized' });

    const retried = httpMock.expectOne('/api/v1/jobs');
    expect(retried.request.headers.get('Authorization')).toBe('Bearer new-token');
    retried.flush({ ok: true });

    expect(mockAuthService.refreshToken).toHaveBeenCalled();
    expect(results).toHaveLength(1);
  });

  it('does NOT retry on 401 from an excluded endpoint', () => {
    let caught: unknown;
    http.post('/api/v1/auth/login', {}).subscribe({ error: (e) => (caught = e) });

    httpMock
      .expectOne('/api/v1/auth/login')
      .flush('Unauthorized', { status: 401, statusText: 'Unauthorized' });

    httpMock.expectNone('/api/v1/auth/login');
    expect(mockAuthService.refreshToken).not.toHaveBeenCalled();
    expect((caught as { status: number }).status).toBe(401);
  });

  it('clears tokens and navigates to /login when refreshToken() fails', () => {
    mockAuthService.refreshToken.mockReturnValue(
      throwError(() => ({ status: 401, statusText: 'Unauthorized' }))
    );

    let caughtError: unknown;
    http.get('/api/v1/jobs').subscribe({ error: (e) => (caughtError = e) });

    httpMock
      .expectOne('/api/v1/jobs')
      .flush('Unauthorized', { status: 401, statusText: 'Unauthorized' });

    expect(mockAuthService.clearTokens).toHaveBeenCalled();
    expect(router.navigate).toHaveBeenCalledWith(['/login']);
    expect(caughtError).toBeDefined();
  });
});
