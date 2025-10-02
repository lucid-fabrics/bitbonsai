import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';
import type { CreateLibraryDto, Library, UpdateLibraryDto } from '../models/library.model';

@Injectable({
  providedIn: 'root',
})
export class LibrariesClient {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = '/api/v1/libraries';

  /**
   * Get all libraries
   */
  getLibraries(): Observable<Library[]> {
    return this.http.get<Library[]>(this.apiUrl);
  }

  /**
   * Get a specific library by ID
   */
  getLibrary(id: string): Observable<Library> {
    return this.http.get<Library>(`${this.apiUrl}/${id}`);
  }

  /**
   * Create a new library
   */
  createLibrary(library: CreateLibraryDto): Observable<Library> {
    return this.http.post<Library>(this.apiUrl, library);
  }

  /**
   * Update an existing library
   */
  updateLibrary(id: string, updates: UpdateLibraryDto): Observable<Library> {
    return this.http.patch<Library>(`${this.apiUrl}/${id}`, updates);
  }

  /**
   * Delete a library
   */
  deleteLibrary(id: string): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/${id}`);
  }

  /**
   * Trigger a library scan
   */
  scanLibrary(id: string): Observable<Library> {
    return this.http.post<Library>(`${this.apiUrl}/${id}/scan`, {});
  }
}
