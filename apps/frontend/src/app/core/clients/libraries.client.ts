import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { type Observable, timeout } from 'rxjs';
import type {
  BulkJobCreationResult,
  CreateAllJobsDto,
  CreateJobsFromScanDto,
  CreateLibraryDto,
  Library,
  ScanPreview,
  UpdateLibraryDto,
} from '../../features/libraries/models/library.model';

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

  /**
   * Get scan preview for a library (shows what files need encoding without creating jobs)
   */
  getScanPreview(id: string): Observable<ScanPreview> {
    return this.http.get<ScanPreview>(`${this.apiUrl}/${id}/scan/preview`);
  }

  /**
   * Get all "ready to queue" files across all libraries
   */
  getAllReadyFiles(): Observable<ScanPreview[]> {
    return this.http.get<ScanPreview[]>(`${this.apiUrl}/ready`);
  }

  /**
   * Create encoding jobs from scan preview results
   */
  createJobsFromScan(
    id: string,
    dto: CreateJobsFromScanDto
  ): Observable<{ jobsCreated: number; jobs: any[] }> {
    return this.http.post<{ jobsCreated: number; jobs: any[] }>(
      `${this.apiUrl}/${id}/scan/create-jobs`,
      dto
    );
  }

  /**
   * Create jobs for all files in library (simplified workflow)
   * Note: Uses 10 minute timeout for large libraries
   */
  createAllJobs(id: string, dto: CreateAllJobsDto): Observable<BulkJobCreationResult> {
    return this.http
      .post<BulkJobCreationResult>(`${this.apiUrl}/${id}/create-all-jobs`, dto)
      .pipe(timeout(600000)); // 10 minutes = 600000ms
  }
}
