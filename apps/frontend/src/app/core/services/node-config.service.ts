import { Injectable } from '@angular/core';

/**
 * Node Configuration Service
 *
 * Stores the current node's configuration including the main node URL
 * for LINKED nodes. This is used by the API interceptor to route requests
 * to the correct backend.
 */
@Injectable({
  providedIn: 'root',
})
export class NodeConfigService {
  private mainApiUrl: string | null = null;

  /**
   * Set the main API URL (for LINKED nodes)
   */
  setMainApiUrl(url: string | null): void {
    this.mainApiUrl = url;
  }

  /**
   * Get the main API URL
   * Returns null for MAIN nodes or if not yet loaded
   */
  getMainApiUrl(): string | null {
    return this.mainApiUrl;
  }

  /**
   * Check if configuration has been loaded
   */
  isConfigured(): boolean {
    return this.mainApiUrl !== null;
  }
}
