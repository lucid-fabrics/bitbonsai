import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { AuthService } from './auth.service';
import type { AuthResponse } from './models/auth-response.model';

const MOCK_AUTH_RESPONSE: AuthResponse = {
  access_token: 'access-token-123',
  refresh_token: 'refresh-token-456',
  userId: 'user-1',
  username: 'testuser',
  role: 'admin',
};

describe('AuthService', () => {
  let service: AuthService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [AuthService],
    });
    service = TestBed.inject(AuthService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
    localStorage.clear();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('login', () => {
    it('should POST credentials and store tokens on success', () => {
      service.login('testuser', 'password').subscribe((res) => {
        expect(res).toEqual(MOCK_AUTH_RESPONSE);
      });

      const req = httpMock.expectOne('/api/v1/auth/login');
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({ username: 'testuser', password: 'password' });
      req.flush(MOCK_AUTH_RESPONSE);

      expect(localStorage.getItem('access_token')).toBe('access-token-123');
      expect(localStorage.getItem('refresh_token')).toBe('refresh-token-456');
      expect(localStorage.getItem('user_id')).toBe('user-1');
      expect(localStorage.getItem('username')).toBe('testuser');
      expect(localStorage.getItem('role')).toBe('admin');
    });

    it('should emit true on isAuthenticated$ after successful login', () => {
      const states: boolean[] = [];
      service.isAuthenticated$.subscribe((v) => states.push(v));

      service.login('testuser', 'password').subscribe();
      httpMock.expectOne('/api/v1/auth/login').flush(MOCK_AUTH_RESPONSE);

      expect(states).toContain(true);
    });

    it('should propagate HTTP errors on invalid credentials', () => {
      service.login('bad', 'creds').subscribe({
        next: () => fail('should have failed'),
        error: (err) => expect(err.status).toBe(401),
      });

      httpMock
        .expectOne('/api/v1/auth/login')
        .flush('Unauthorized', { status: 401, statusText: 'Unauthorized' });
    });
  });

  describe('logout', () => {
    it('should clear tokens and emit on logout$', () => {
      localStorage.setItem('access_token', 'tok');
      localStorage.setItem('refresh_token', 'rtok');

      let logoutEmitted = false;
      service.logout$.subscribe(() => (logoutEmitted = true));

      service.logout();

      expect(localStorage.getItem('access_token')).toBeNull();
      expect(localStorage.getItem('refresh_token')).toBeNull();
      expect(logoutEmitted).toBe(true);
    });

    it('should emit false on isAuthenticated$ after logout', () => {
      localStorage.setItem('access_token', 'tok');
      localStorage.setItem('refresh_token', 'rtok');

      const states: boolean[] = [];
      service.isAuthenticated$.subscribe((v) => states.push(v));

      service.logout();

      expect(states[states.length - 1]).toBe(false);
    });
  });

  describe('refreshToken', () => {
    it('should POST refresh token and store new access token', () => {
      localStorage.setItem('refresh_token', 'old-refresh');

      service.refreshToken().subscribe((res) => {
        expect(res.accessToken).toBe('new-access-token');
      });

      const req = httpMock.expectOne('/api/v1/auth/refresh');
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({ refresh_token: 'old-refresh' });
      req.flush({ accessToken: 'new-access-token' });

      expect(localStorage.getItem('access_token')).toBe('new-access-token');
    });

    it('should throw when no refresh token is stored', () => {
      expect(() => service.refreshToken()).toThrow('No refresh token available');
    });

    it('should propagate HTTP errors', () => {
      localStorage.setItem('refresh_token', 'expired-refresh');

      service.refreshToken().subscribe({
        next: () => fail('should have failed'),
        error: (err) => expect(err.status).toBe(401),
      });

      httpMock
        .expectOne('/api/v1/auth/refresh')
        .flush('Unauthorized', { status: 401, statusText: 'Unauthorized' });
    });
  });

  describe('isAuthenticated', () => {
    it('should return true when both tokens exist', () => {
      localStorage.setItem('access_token', 'tok');
      localStorage.setItem('refresh_token', 'rtok');
      expect(service.isAuthenticated()).toBe(true);
    });

    it('should return false when access token is missing', () => {
      localStorage.setItem('refresh_token', 'rtok');
      expect(service.isAuthenticated()).toBe(false);
    });

    it('should return false when storage is empty', () => {
      expect(service.isAuthenticated()).toBe(false);
    });
  });

  describe('clearTokens', () => {
    it('should remove all auth items from localStorage', () => {
      localStorage.setItem('access_token', 'a');
      localStorage.setItem('refresh_token', 'b');
      localStorage.setItem('user_id', 'c');
      localStorage.setItem('username', 'd');
      localStorage.setItem('role', 'e');

      service.clearTokens();

      expect(localStorage.getItem('access_token')).toBeNull();
      expect(localStorage.getItem('refresh_token')).toBeNull();
      expect(localStorage.getItem('user_id')).toBeNull();
      expect(localStorage.getItem('username')).toBeNull();
      expect(localStorage.getItem('role')).toBeNull();
    });
  });

  describe('token getters', () => {
    beforeEach(() => {
      localStorage.setItem('access_token', 'access-tok');
      localStorage.setItem('refresh_token', 'refresh-tok');
      localStorage.setItem('user_id', 'uid-42');
      localStorage.setItem('username', 'alice');
      localStorage.setItem('role', 'user');
    });

    it('getAccessToken should return stored value', () => {
      expect(service.getAccessToken()).toBe('access-tok');
    });

    it('getRefreshToken should return stored value', () => {
      expect(service.getRefreshToken()).toBe('refresh-tok');
    });

    it('getUserId should return stored value', () => {
      expect(service.getUserId()).toBe('uid-42');
    });

    it('getUsername should return stored value', () => {
      expect(service.getUsername()).toBe('alice');
    });

    it('getRole should return stored value', () => {
      expect(service.getRole()).toBe('user');
    });

    it('getters return null when storage is empty', () => {
      localStorage.clear();
      expect(service.getAccessToken()).toBeNull();
      expect(service.getRefreshToken()).toBeNull();
      expect(service.getUserId()).toBeNull();
      expect(service.getUsername()).toBeNull();
      expect(service.getRole()).toBeNull();
    });
  });

  describe('setAccessToken', () => {
    it('should write to localStorage', () => {
      service.setAccessToken('brand-new-token');
      expect(localStorage.getItem('access_token')).toBe('brand-new-token');
    });
  });
});
