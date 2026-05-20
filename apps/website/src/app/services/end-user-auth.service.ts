import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, tap } from 'rxjs';
import { environment } from '../../environments/environment';

const TOKEN_KEY = 'bb_end_user_token';

export interface EndUser {
  id: string;
  email: string;
  name?: string;
  hasStripeSubscription: boolean;
}

export interface EndUserAuthResponse {
  accessToken: string;
  user: EndUser;
}

export interface LinkedDevice {
  id: string;
  productId: string;
  machineId: string;
  machineName: string | null;
  createdAt: string;
  lastSeenAt: string;
  revokedAt: string | null;
}

@Injectable({
  providedIn: 'root',
})
export class EndUserAuthService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.licenseApiUrl}/end-users`;
  private readonly deviceUrl = `${environment.licenseApiUrl}/device`;

  register(email: string, password: string, name?: string): Observable<EndUserAuthResponse> {
    return this.http
      .post<EndUserAuthResponse>(`${this.baseUrl}/register`, { email, password, name })
      .pipe(tap((res) => this.storeToken(res.accessToken)));
  }

  login(email: string, password: string): Observable<EndUserAuthResponse> {
    return this.http
      .post<EndUserAuthResponse>(`${this.baseUrl}/login`, { email, password })
      .pipe(tap((res) => this.storeToken(res.accessToken)));
  }

  authorizeDevice(userCode: string): Observable<{ message: string }> {
    return this.http.post<{ message: string }>(
      `${this.deviceUrl}/authorize`,
      { userCode },
      this.authHeaders()
    );
  }

  googleLogin(next?: 'account' | 'device'): void {
    const url = new URL(`${this.baseUrl}/oauth/google`);
    if (next) url.searchParams.set('next', next);
    window.location.href = url.toString();
  }

  githubLogin(next?: 'account' | 'device'): void {
    const url = new URL(`${this.baseUrl}/oauth/github`);
    if (next) url.searchParams.set('next', next);
    window.location.href = url.toString();
  }

  handleOAuthFragment(): void {
    const fragment = window.location.hash;
    if (!fragment.startsWith('#token=')) return;

    const token = fragment.slice('#token='.length);
    // Basic JWT structure check: three base64url segments separated by dots
    if (!/^[\w-]+\.[\w-]+\.[\w-]+$/.test(token)) return;

    this.storeToken(token);
    history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  isLoggedIn(): boolean {
    return this.getToken() !== null;
  }

  getToken(): string | null {
    return localStorage.getItem(TOKEN_KEY);
  }

  getMe(): Observable<EndUser> {
    return this.http.get<EndUser>(`${this.baseUrl}/me`, this.authHeaders());
  }

  listDevices(): Observable<LinkedDevice[]> {
    return this.http.get<LinkedDevice[]>(`${this.baseUrl}/devices`, this.authHeaders());
  }

  revokeDevice(deviceId: string): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/devices/${deviceId}`, this.authHeaders());
  }

  resendVerificationByEmail(email: string): Observable<{ message: string }> {
    return this.http.post<{ message: string }>(`${this.baseUrl}/resend-verification-public`, {
      email,
    });
  }

  getStripePortalUrl(returnUrl?: string): Observable<{ url: string }> {
    return this.http.post<{ url: string }>(
      `${this.baseUrl}/portal`,
      { returnUrl: returnUrl ?? window.location.href },
      this.authHeaders()
    );
  }

  logout(): void {
    localStorage.removeItem(TOKEN_KEY);
  }

  private storeToken(token: string): void {
    localStorage.setItem(TOKEN_KEY, token);
  }

  private authHeaders(): { headers: { Authorization: string } } {
    const token = this.getToken();
    if (!token) throw new Error('Not authenticated');
    return { headers: { Authorization: `Bearer ${token}` } };
  }
}
