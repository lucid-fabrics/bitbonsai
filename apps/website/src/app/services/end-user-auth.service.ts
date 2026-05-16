import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, tap } from 'rxjs';
import { environment } from '../../environments/environment';

const TOKEN_KEY = 'bb_end_user_token';

export interface EndUser {
  id: string;
  email: string;
  name?: string;
}

export interface EndUserAuthResponse {
  accessToken: string;
  user: EndUser;
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
      { headers: { Authorization: `Bearer ${this.getToken()}` } }
    );
  }

  googleLogin(): void {
    window.location.href = `${this.baseUrl}/oauth/google`;
  }

  githubLogin(): void {
    window.location.href = `${this.baseUrl}/oauth/github`;
  }

  handleOAuthFragment(): void {
    const fragment = window.location.hash;
    if (fragment.startsWith('#token=')) {
      const token = fragment.slice('#token='.length);
      this.storeToken(token);
      // Clean up the fragment from the URL
      history.replaceState(null, '', window.location.pathname + window.location.search);
    }
  }

  isLoggedIn(): boolean {
    return this.getToken() !== null;
  }

  getToken(): string | null {
    return localStorage.getItem(TOKEN_KEY);
  }

  logout(): void {
    localStorage.removeItem(TOKEN_KEY);
  }

  private storeToken(token: string): void {
    localStorage.setItem(TOKEN_KEY, token);
  }
}
