import { Injectable } from '@angular/core';
import { Router } from '@angular/router';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly API_KEY_STORAGE_KEY = 'admin_api_key';

  constructor(private router: Router) {}

  setApiKey(apiKey: string): void {
    localStorage.setItem(this.API_KEY_STORAGE_KEY, apiKey);
  }

  getApiKey(): string | null {
    return localStorage.getItem(this.API_KEY_STORAGE_KEY);
  }

  isAuthenticated(): boolean {
    return !!this.getApiKey();
  }

  logout(): void {
    localStorage.removeItem(this.API_KEY_STORAGE_KEY);
    this.router.navigate(['/login']);
  }
}
