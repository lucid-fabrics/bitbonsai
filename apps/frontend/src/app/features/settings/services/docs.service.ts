import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';

@Injectable({
  providedIn: 'root',
})
export class DocsService {
  private readonly http = inject(HttpClient);

  private readonly docUrls: Record<string, string> = {
    rebalancing: '/api/v1/docs/REBALANCING',
  };

  /**
   * Fetch a documentation file by name as raw markdown text
   *
   * @param docName - Document identifier (e.g., 'rebalancing')
   * @returns Observable of markdown string, or null if docName is unknown
   */
  getDocument(docName: string): Observable<string> | null {
    const url = this.docUrls[docName];
    if (!url) {
      return null;
    }
    return this.http.get(url, { responseType: 'text' });
  }
}
