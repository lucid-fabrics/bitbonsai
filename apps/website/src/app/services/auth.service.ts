import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Observable, tap } from 'rxjs';
import { environment } from '../../environments/environment';

export enum AdminRole {
  SUPER_ADMIN = 'SUPER_ADMIN',
  ADMIN = 'ADMIN',
}

export interface AdminUser {
  id: string;
  email: string;
  name: string;
  role: AdminRole;
  isActive: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface LoginDto {
  email: string;
  password: string;
}

export interface CreateAdminDto {
  email: string;
  password: string;
  name: string;
  role?: AdminRole;
}

export interface LoginResponse {
  accessToken: string;
  user: AdminUser;
}

@Injectable({
  providedIn: 'root',
})
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly authUrl = `${environment.licenseApiUrl}/auth`;

  currentUser = signal<AdminUser | null>(null);
  isAuthenticated = signal(false);

  constructor() {
    this.loadTokenFromStorage();
  }

  login(dto: LoginDto): Observable<LoginResponse> {
    return this.http.post<LoginResponse>(`${this.authUrl}/login`, dto).pipe(
      tap((response) => {
        this.setToken(response.accessToken);
        this.currentUser.set(response.user);
        this.isAuthenticated.set(true);
      })
    );
  }

  logout(): void {
    this.clearToken();
    this.currentUser.set(null);
    this.isAuthenticated.set(false);
    this.router.navigate(['/admin/login']);
  }

  createAdmin(dto: CreateAdminDto): Observable<AdminUser> {
    return this.http.post<AdminUser>(`${this.authUrl}/admin`, dto);
  }

  getMe(): Observable<AdminUser> {
    return this.http.get<AdminUser>(`${this.authUrl}/me`).pipe(
      tap((user) => {
        this.currentUser.set(user);
        this.isAuthenticated.set(true);
      })
    );
  }

  getAllAdmins(): Observable<AdminUser[]> {
    return this.http.get<AdminUser[]>(`${this.authUrl}/admins`);
  }

  toggleAdminStatus(id: string): Observable<AdminUser> {
    return this.http.patch<AdminUser>(`${this.authUrl}/admins/${id}/toggle`, {});
  }

  getToken(): string | null {
    return localStorage.getItem('auth_token');
  }

  private setToken(token: string): void {
    localStorage.setItem('auth_token', token);
  }

  private clearToken(): void {
    localStorage.removeItem('auth_token');
  }

  private loadTokenFromStorage(): void {
    const token = this.getToken();
    if (token) {
      this.getMe().subscribe({
        next: () => {
          /* token validated */
        },
        error: () => {
          this.clearToken();
        },
      });
    }
  }
}
