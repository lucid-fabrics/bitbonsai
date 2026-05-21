import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { CloudAccountService, CloudAuthStatus, DeviceFlowResponse } from './cloud-account.service';

const BASE = '/api/v1/cloud-auth';

describe('CloudAccountService', () => {
  let service: CloudAccountService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [CloudAccountService],
    });
    service = TestBed.inject(CloudAccountService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('startDeviceFlow', () => {
    const mockResponse: DeviceFlowResponse = {
      userCode: 'ABCD-1234',
      verificationUri: 'https://example.com/activate',
      verificationUriComplete: 'https://example.com/activate?code=ABCD-1234',
      expiresIn: 900,
      interval: 5,
      deviceCode: 'device-code-xyz',
    };

    it('should POST to /start with machineName', () => {
      service.startDeviceFlow('my-machine').subscribe((res) => {
        expect(res).toEqual(mockResponse);
        expect(res.userCode).toBe('ABCD-1234');
      });

      const req = httpMock.expectOne(`${BASE}/start`);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({ machineName: 'my-machine' });
      req.flush(mockResponse);
    });

    it('should POST to /start without machineName', () => {
      service.startDeviceFlow().subscribe();

      const req = httpMock.expectOne(`${BASE}/start`);
      expect(req.request.body).toEqual({ machineName: undefined });
      req.flush(mockResponse);
    });

    it('should propagate HTTP errors', () => {
      service.startDeviceFlow().subscribe({
        next: () => fail('should have failed'),
        error: (err) => expect(err.status).toBe(500),
      });

      httpMock
        .expectOne(`${BASE}/start`)
        .flush('error', { status: 500, statusText: 'Server Error' });
    });
  });

  describe('getStatus', () => {
    const mockStatus: CloudAuthStatus = {
      linked: true,
      email: 'user@example.com',
      tier: 'SUPPORTER',
      maxNodes: 5,
      maxConcurrentJobs: 3,
      validatedAt: null,
      gracePeriodExpiresAt: null,
      gracePeriodExpired: false,
    };

    it('should GET /status and return cloud auth status', () => {
      service.getStatus().subscribe((res) => {
        expect(res).toEqual(mockStatus);
        expect(res.linked).toBe(true);
        expect(res.email).toBe('user@example.com');
        expect(res.tier).toBe('SUPPORTER');
      });

      const req = httpMock.expectOne(`${BASE}/status`);
      expect(req.request.method).toBe('GET');
      req.flush(mockStatus);
    });

    it('should propagate HTTP errors', () => {
      service.getStatus().subscribe({
        next: () => fail('should have failed'),
        error: (err) => expect(err.status).toBe(401),
      });

      httpMock
        .expectOne(`${BASE}/status`)
        .flush('Unauthorized', { status: 401, statusText: 'Unauthorized' });
    });
  });

  describe('logout', () => {
    it('should POST to /logout', () => {
      let completed = false;
      service.logout().subscribe({ complete: () => (completed = true) });

      const req = httpMock.expectOne(`${BASE}/logout`);
      expect(req.request.method).toBe('POST');
      req.flush(null);

      expect(completed).toBe(true);
    });

    it('should propagate HTTP errors', () => {
      service.logout().subscribe({
        next: () => fail('should have failed'),
        error: (err) => expect(err.status).toBe(403),
      });

      httpMock
        .expectOne(`${BASE}/logout`)
        .flush('Forbidden', { status: 403, statusText: 'Forbidden' });
    });
  });

  describe('validateNow', () => {
    it('should POST to /validate and return boolean result', () => {
      service.validateNow().subscribe((res) => {
        expect(res).toBe(true);
      });

      const req = httpMock.expectOne(`${BASE}/validate`);
      expect(req.request.method).toBe('POST');
      req.flush(true);
    });

    it('should propagate HTTP errors', () => {
      service.validateNow().subscribe({
        next: () => fail('should have failed'),
        error: (err) => expect(err.status).toBe(502),
      });

      httpMock
        .expectOne(`${BASE}/validate`)
        .flush('Bad Gateway', { status: 502, statusText: 'Bad Gateway' });
    });
  });
});
