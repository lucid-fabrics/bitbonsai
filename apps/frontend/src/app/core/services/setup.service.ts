import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

/**
 * Setup status response from the API
 */
export interface SetupStatus {
  isSetupComplete: boolean;
}

/**
 * Initialize setup request payload
 */
export interface InitializeSetup {
  username?: string;
  password?: string;
  allowLocalNetworkWithoutAuth: boolean;
  nodeType?: string;
}

/**
 * Service for handling first-time setup operations.
 *
 * Responsibilities:
 * - Check if initial setup has been completed
 * - Initialize the application with first admin user
 * - Manage setup state
 */
@Injectable({
  providedIn: 'root',
})
export class SetupService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = `${environment.apiUrl}/setup`;

  /**
   * Check if the application setup has been completed.
   *
   * @returns Observable<SetupStatus> Setup status containing isSetupComplete flag
   */
  checkSetupStatus(): Observable<SetupStatus> {
    return this.http.get<SetupStatus>(`${this.apiUrl}/status`);
  }

  /**
   * Initialize the application with the first admin user and security settings.
   *
   * @param setupData Username, password, and security preferences
   * @returns Observable<void> Completes when setup is initialized
   */
  initializeSetup(setupData: InitializeSetup): Observable<void> {
    return this.http.post<void>(`${this.apiUrl}/initialize`, setupData);
  }
}
