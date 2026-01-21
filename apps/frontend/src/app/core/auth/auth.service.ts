import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { BehaviorSubject, Observable, Subject, tap } from 'rxjs';
import { AuthResponse, LoginCredentials, RefreshTokenRequest } from './models/auth-response.model';

/**
 * Authentication Service
 *
 * Manages user authentication state, JWT tokens, and authentication operations.
 *
 * Features:
 * - Login/logout operations
 * - Token storage and retrieval
 * - Authentication state management
 * - Token refresh functionality
 */
@Injectable({
  providedIn: 'root',
})
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly API_URL = '/api/v1/auth';

  // Storage keys
  private readonly ACCESS_TOKEN_KEY = 'access_token';
  private readonly REFRESH_TOKEN_KEY = 'refresh_token';
  private readonly USER_ID_KEY = 'user_id';
  private readonly USERNAME_KEY = 'username';
  private readonly ROLE_KEY = 'role';

  /**
   * Observable that emits the current authentication state
   */
  private readonly isAuthenticatedSubject = new BehaviorSubject<boolean>(this.hasValidTokens());
  public readonly isAuthenticated$ = this.isAuthenticatedSubject.asObservable();

  // DEEP AUDIT P1-2: Token refresh state management (moved from module-level interceptor)
  // This prevents memory leaks across login/logout cycles
  private _isRefreshing = false;
  private readonly _refreshTokenSubject = new BehaviorSubject<string | null>(null);
  private readonly _logoutSubject = new Subject<void>();

  /** Observable that emits when logout occurs - interceptor should reset state */
  public readonly logout$ = this._logoutSubject.asObservable();

  /** Current refresh state - true if a token refresh is in progress */
  get isRefreshing(): boolean {
    return this._isRefreshing;
  }

  set isRefreshing(value: boolean) {
    this._isRefreshing = value;
  }

  /** Subject that emits new tokens when refresh completes */
  get refreshTokenSubject(): BehaviorSubject<string | null> {
    return this._refreshTokenSubject;
  }

  /** Reset refresh state - called on logout to prevent stale state */
  resetRefreshState(): void {
    this._isRefreshing = false;
    this._refreshTokenSubject.next(null);
  }

  /**
   * Check if user has valid tokens in storage
   */
  private hasValidTokens(): boolean {
    return !!(this.getAccessToken() && this.getRefreshToken());
  }

  /**
   * Login with username and password
   *
   * @param username User's username
   * @param password User's password
   * @returns Observable of authentication response
   */
  login(username: string, password: string): Observable<AuthResponse> {
    const credentials: LoginCredentials = { username, password };
    return this.http
      .post<AuthResponse>(`${this.API_URL}/login`, credentials)
      .pipe(tap((response) => this.handleAuthSuccess(response)));
  }

  /**
   * Logout current user
   *
   * Clears all authentication tokens and user data from storage
   * and updates authentication state.
   *
   * DEEP AUDIT P1-2: Also resets refresh state to prevent memory leaks
   */
  logout(): void {
    this.clearTokens();
    this.resetRefreshState(); // P1-2 FIX: Clear stale refresh state
    this._logoutSubject.next(); // Notify interceptor of logout
    this.isAuthenticatedSubject.next(false);
  }

  /**
   * Refresh access token using refresh token
   *
   * @returns Observable of refresh token response
   */
  refreshToken(): Observable<{ accessToken: string }> {
    const refreshToken = this.getRefreshToken();
    if (!refreshToken) {
      throw new Error('No refresh token available');
    }

    const payload: RefreshTokenRequest = { refresh_token: refreshToken };
    return this.http.post<{ accessToken: string }>(`${this.API_URL}/refresh`, payload).pipe(
      tap((response) => {
        this.setAccessToken(response.accessToken);
      })
    );
  }

  /**
   * Get stored access token
   */
  getAccessToken(): string | null {
    return localStorage.getItem(this.ACCESS_TOKEN_KEY);
  }

  /**
   * Get stored refresh token
   */
  getRefreshToken(): string | null {
    return localStorage.getItem(this.REFRESH_TOKEN_KEY);
  }

  /**
   * Get stored user ID
   */
  getUserId(): string | null {
    return localStorage.getItem(this.USER_ID_KEY);
  }

  /**
   * Get stored username
   */
  getUsername(): string | null {
    return localStorage.getItem(this.USERNAME_KEY);
  }

  /**
   * Get stored user role
   */
  getRole(): string | null {
    return localStorage.getItem(this.ROLE_KEY);
  }

  /**
   * Check if user is currently authenticated
   *
   * @returns True if user has valid tokens, false otherwise
   */
  isAuthenticated(): boolean {
    return this.hasValidTokens();
  }

  /**
   * Set access token in storage
   */
  setAccessToken(token: string): void {
    localStorage.setItem(this.ACCESS_TOKEN_KEY, token);
  }

  /**
   * Clear all authentication tokens and user data
   */
  clearTokens(): void {
    localStorage.removeItem(this.ACCESS_TOKEN_KEY);
    localStorage.removeItem(this.REFRESH_TOKEN_KEY);
    localStorage.removeItem(this.USER_ID_KEY);
    localStorage.removeItem(this.USERNAME_KEY);
    localStorage.removeItem(this.ROLE_KEY);
  }

  /**
   * Handle successful authentication response
   *
   * Stores tokens and user data, updates authentication state
   */
  private handleAuthSuccess(response: AuthResponse): void {
    localStorage.setItem(this.ACCESS_TOKEN_KEY, response.access_token);
    localStorage.setItem(this.REFRESH_TOKEN_KEY, response.refresh_token);
    localStorage.setItem(this.USER_ID_KEY, response.userId);
    localStorage.setItem(this.USERNAME_KEY, response.username);
    localStorage.setItem(this.ROLE_KEY, response.role);
    this.isAuthenticatedSubject.next(true);
  }
}
